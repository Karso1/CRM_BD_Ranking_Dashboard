#!/usr/bin/env python3
"""Build canonical UP Business daily dashboard data from backend Excel exports."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd


FRED_SERIES_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
PUBLIC_BUCKET = "UPay"
EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xls"}
DAILY_COLUMNS = [
    "date", "bd", "agent", "category", "total_amount", "consumption",
    "open_card_virtual", "open_card_physical", "recharge_amount",
    "shared_consumption", "transaction_count", "recharge_count",
]
TARGET_COLUMNS = ["month", "bd", "target", "card_target"]


@dataclass(frozen=True)
class Client:
    name: str
    category: str
    bd: str
    mode: str
    configured: bool = True


def clean(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    text = unicodedata.normalize("NFKC", str(value)).strip()
    return re.sub(r"\s+", " ", re.sub(r"\.0$", "", text))


def key(value: object) -> str:
    return clean(value).casefold()


def number_series(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series.astype(str).str.replace(",", "", regex=False), errors="coerce").fillna(0.0)


def date_series(series: pd.Series) -> pd.Series:
    text = series.fillna("").astype(str).str.strip()
    iso = text.str.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")
    output = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    if iso.any():
        output.loc[iso] = pd.to_datetime(text.loc[iso], errors="coerce", yearfirst=True)
    if (~iso).any():
        output.loc[~iso] = pd.to_datetime(text.loc[~iso], errors="coerce", dayfirst=True)
    return output


def excel_files(folder: Path) -> list[Path]:
    return sorted(
        path for path in folder.rglob("*")
        if path.is_file() and path.suffix.lower() in EXCEL_SUFFIXES
        and not path.name.startswith(("~$", "."))
    )


def read_matching_sheet(
    path: Path,
    required: Iterable[str],
    wanted: Iterable[str] | None = None,
) -> tuple[pd.DataFrame, str]:
    required_set = set(required)
    with pd.ExcelFile(path) as book:
        for sheet in book.sheet_names:
            header = pd.read_excel(book, sheet_name=sheet, nrows=0)
            header.columns = [clean(column) for column in header.columns]
            if required_set.issubset(set(header.columns)):
                usecols = None if wanted is None else lambda name: clean(name) in set(wanted)
                frame = pd.read_excel(book, sheet_name=sheet, dtype=str, usecols=usecols)
                frame.columns = [clean(column) for column in frame.columns]
                return frame.dropna(how="all"), sheet
    raise ValueError(f"{path.name} 中没有找到所需字段：{', '.join(required_set)}")


def choose(frame: pd.DataFrame, *names: str, required: bool = True) -> pd.Series:
    for name in names:
        if name in frame.columns:
            return frame[name]
    if required:
        raise ValueError(f"缺少字段：{' / '.join(names)}")
    return pd.Series("", index=frame.index, dtype=object)


def load_configuration(path: Path) -> tuple[dict[str, Client], pd.DataFrame, list[str]]:
    frame, _ = read_matching_sheet(
        path,
        ["client", "Categories", "BD", "合作模式", "月份", "充值/消费量目标", "开卡目标"],
    )
    allowed = [clean(value) for value in frame.iloc[:, 9].tolist() if clean(value)]
    allowed_by_key = {key(name): name for name in allowed}
    if not allowed:
        raise ValueError("BD代理关系.xlsx 的 J 列没有公开 BD 名单。")

    mapping: dict[str, Client] = {}
    conflicts: list[str] = []
    for _, row in frame.iterrows():
        raw_name = clean(row.get("client"))
        if not raw_name:
            continue
        raw_bd = clean(row.get("BD"))
        owner = allowed_by_key.get(key(raw_bd), PUBLIC_BUCKET)
        category = "API" if key(row.get("Categories")) == "api" else "代理商"
        mode = "shared" if clean(row.get("合作模式")) == "1" else "recharge"
        client = Client(raw_name, category, owner, mode)
        normalized = key(raw_name)
        if normalized in mapping and mapping[normalized] != client:
            conflicts.append(raw_name)
        else:
            mapping[normalized] = client
    if conflicts:
        raise ValueError(f"配置表存在冲突的重复客户：{', '.join(sorted(set(conflicts))[:12])}")

    recipients = allowed + [PUBLIC_BUCKET]
    target_rows: list[dict[str, object]] = []
    seen_months: set[str] = set()
    for _, row in frame.iterrows():
        month_digits = re.sub(r"\D", "", clean(row.get("月份")))
        if not re.fullmatch(r"\d{6}", month_digits) or month_digits in seen_months:
            continue
        seen_months.add(month_digits)
        month = f"{month_digits[:4]}-{month_digits[4:]}"
        volume = float(number_series(pd.Series([row.get("充值/消费量目标")])).iloc[0])
        cards = float(number_series(pd.Series([row.get("开卡目标")])).iloc[0])
        volume_share = round(volume / len(recipients), 2)
        card_share = round(cards / len(recipients), 2)
        for index, bd in enumerate(recipients):
            last = index == len(recipients) - 1
            target_rows.append({
                "month": month,
                "bd": bd,
                "target": round(volume - volume_share * (len(recipients) - 1), 2) if last else volume_share,
                "card_target": round(cards - card_share * (len(recipients) - 1), 2) if last else card_share,
            })
    return mapping, pd.DataFrame(target_rows, columns=TARGET_COLUMNS), allowed


def resolve(raw_name: object, mapping: dict[str, Client]) -> Client:
    normalized = key(raw_name)
    if not normalized or normalized in {"upay", "unassigned", "others"}:
        return Client(PUBLIC_BUCKET, "代理商", PUBLIC_BUCKET, "recharge", False)
    return mapping.get(normalized, Client(PUBLIC_BUCKET, "代理商", PUBLIC_BUCKET, "recharge", False))


def fetch_fred_rates(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    query = urllib.parse.urlencode({
        "id": "DEXHKUS",
        "cosd": (start - timedelta(days=10)).date().isoformat(),
        "coed": end.date().isoformat(),
    })
    request = urllib.request.Request(
        f"{FRED_SERIES_URL}?{query}",
        headers={"User-Agent": "UPay-UPB-Pipeline/1.0", "Accept": "text/csv"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read().decode("utf-8-sig")
    frame = pd.read_csv(io.StringIO(payload), dtype=str)
    if not {"observation_date", "DEXHKUS"}.issubset(frame.columns):
        raise ValueError("FRED 返回的汇率字段不正确。")
    frame = frame.rename(columns={"observation_date": "rate_date", "DEXHKUS": "hkd_per_usd"})
    frame["rate_date"] = pd.to_datetime(frame["rate_date"], errors="coerce")
    frame["hkd_per_usd"] = pd.to_numeric(frame["hkd_per_usd"], errors="coerce")
    frame = frame.dropna().sort_values("rate_date").drop_duplicates("rate_date", keep="last")
    frame["source"] = "Federal Reserve H.10 via FRED DEXHKUS"
    return frame


def load_fx_rates(cache_path: Path, required_dates: pd.Series) -> tuple[pd.DataFrame, dict[pd.Timestamp, tuple[float, pd.Timestamp, str]]]:
    dates = pd.to_datetime(required_dates, errors="coerce").dropna().dt.normalize()
    if dates.empty:
        return pd.DataFrame(columns=["rate_date", "hkd_per_usd", "source"]), {}
    cached = pd.DataFrame(columns=["rate_date", "hkd_per_usd", "source"])
    if cache_path.exists():
        cached = pd.read_csv(cache_path)
        cached["rate_date"] = pd.to_datetime(cached["rate_date"], errors="coerce")
        cached["hkd_per_usd"] = pd.to_numeric(cached["hkd_per_usd"], errors="coerce")
        cached = cached.dropna(subset=["rate_date", "hkd_per_usd"])
    try:
        fresh = fetch_fred_rates(dates.min(), dates.max())
        rates = pd.concat([cached, fresh], ignore_index=True)
    except (OSError, ValueError, urllib.error.URLError) as error:
        if cached.empty:
            raise ValueError(f"无法下载官方汇率且本地没有缓存：{error}") from error
        print(f"提示：官方汇率暂时无法更新，使用本地缓存（{error}）。", file=sys.stderr)
        rates = cached
    rates["rate_date"] = pd.to_datetime(rates["rate_date"], errors="coerce")
    rates["hkd_per_usd"] = pd.to_numeric(rates["hkd_per_usd"], errors="coerce")
    rates = rates.dropna(subset=["rate_date", "hkd_per_usd"]).sort_values("rate_date").drop_duplicates("rate_date", keep="last")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    to_save = rates.copy()
    to_save["rate_date"] = to_save["rate_date"].dt.strftime("%Y-%m-%d")
    to_save.to_csv(cache_path, index=False, encoding="utf-8-sig")

    calendar = pd.DataFrame({"transaction_date": sorted(dates.unique())})
    calendar["transaction_date"] = pd.to_datetime(calendar["transaction_date"]).astype("datetime64[ns]")
    rates["rate_date"] = pd.to_datetime(rates["rate_date"]).astype("datetime64[ns]")
    matched = pd.merge_asof(
        calendar.sort_values("transaction_date"),
        rates.rename(columns={"rate_date": "matched_rate_date"}).sort_values("matched_rate_date"),
        left_on="transaction_date", right_on="matched_rate_date", direction="backward",
    )
    if matched.hkd_per_usd.isna().any():
        missing = matched.loc[matched.hkd_per_usd.isna(), "transaction_date"].dt.strftime("%Y-%m-%d").tolist()
        raise ValueError(f"以下交易日期没有可用的历史汇率：{', '.join(missing[:8])}")
    lookup = {
        row.transaction_date: (float(row.hkd_per_usd), row.matched_rate_date, clean(row.source))
        for row in matched.itertuples(index=False)
    }
    return matched, lookup


def source_record(path: Path, sheet: str, raw: int, accepted: int, dates: pd.Series, kind: str, duplicates: int = 0) -> dict[str, object]:
    valid = pd.to_datetime(dates, errors="coerce").dropna()
    return {
        "source_type": kind,
        "source_file": str(path),
        "sheet": sheet,
        "raw_rows": raw,
        "accepted_rows": accepted,
        "duplicate_rows_removed": duplicates,
        "first_date": valid.min().strftime("%Y-%m-%d") if not valid.empty else "",
        "last_date": valid.max().strftime("%Y-%m-%d") if not valid.empty else "",
    }


def load_card_data(root: Path, mapping: dict[str, Client], coverage: list[dict[str, object]], unmapped: list[dict[str, object]]) -> tuple[pd.DataFrame, dict[str, Client], list[dict[str, object]]]:
    metrics: list[pd.DataFrame] = []
    card_map: dict[str, Client] = {}
    conflicts: list[dict[str, object]] = []

    def add_card(identifier: object, client: Client, source: Path) -> None:
        card_key = clean(identifier)
        if not card_key:
            return
        current = card_map.get(card_key)
        if current and current != client:
            conflicts.append({"card_id": card_key, "first_agent": current.name, "later_agent": client.name, "source_file": str(source)})
            return
        card_map[card_key] = client

    wanted = ["订单号", "所属代理商", "历史代理商", "实/虚卡", "卡ID", "卡唯一ID", "开卡费", "申请时间", "卡状态", "开卡成功时间"]
    for path in excel_files(root / "开卡"):
        frame, sheet = read_matching_sheet(path, ["订单号", "历史代理商", "实/虚卡", "开卡费", "卡状态"], wanted)
        raw = len(frame)
        raw_client = choose(frame, "历史代理商", "所属代理商")
        resolved = raw_client.map(lambda value: resolve(value, mapping))
        for idx, client in resolved.items():
            # Transaction exports use 卡ID (the user-card ID). 卡唯一ID is a
            # different backend identifier and must not overwrite that map.
            add_card(frame.at[idx, "卡ID"] if "卡ID" in frame else "", client, path)
            if not client.configured and key(raw_client.at[idx]) not in {"", "upay"}:
                unmapped.append({"source_type": "card", "raw_client": clean(raw_client.at[idx]), "source_file": str(path), "value": 1})
        date = date_series(choose(frame, "开卡成功时间", required=False)).combine_first(date_series(choose(frame, "申请时间"))).dt.normalize()
        kind = choose(frame, "实/虚卡").map(lambda value: "virtual" if "虚拟" in clean(value) else ("physical" if "实体" in clean(value) else ""))
        fee = number_series(choose(frame, "开卡费"))
        status = choose(frame, "卡状态").map(clean)
        order_id = choose(frame, "订单号").map(clean)
        accepted = pd.DataFrame({
            "date": date,
            "order_id": order_id,
            "bd": [client.bd for client in resolved],
            "agent": [client.name for client in resolved],
            "category": [client.category for client in resolved],
            "kind": kind,
            "fee": fee,
            "status": status,
        })
        accepted = accepted[accepted.date.notna() & accepted.kind.ne("") & accepted.status.eq("开卡成功") & accepted.fee.gt(0)]
        before = len(accepted)
        accepted = accepted.sort_values("date").drop_duplicates("order_id", keep="last")
        coverage.append(source_record(path, sheet, raw, len(accepted), date, "open_card", before - len(accepted)))
        if not accepted.empty:
            pivot = accepted.assign(count=1).pivot_table(
                index=["date", "bd", "agent", "category"], columns="kind", values="count", aggfunc="sum", fill_value=0,
            ).reset_index().rename_axis(None, axis=1)
            pivot["open_card_virtual"] = pivot.get("virtual", 0)
            pivot["open_card_physical"] = pivot.get("physical", 0)
            metrics.append(pivot[["date", "bd", "agent", "category", "open_card_virtual", "open_card_physical"]])

    wanted_manual = ["所属代理商", "历史代理商", "用户卡片ID", "渠道卡ID", "申请日期"]
    for path in excel_files(root / "手动开卡"):
        frame, sheet = read_matching_sheet(path, ["历史代理商", "用户卡片ID", "渠道卡ID"], wanted_manual)
        raw_client = choose(frame, "历史代理商", "所属代理商")
        resolved = raw_client.map(lambda value: resolve(value, mapping))
        for idx, client in resolved.items():
            # Manual-card attribution is explicitly keyed by 用户卡片ID. Some
            # historical 渠道卡ID values are reused and are not a safe key.
            add_card(frame.at[idx, "用户卡片ID"], client, path)
            if not client.configured and key(raw_client.at[idx]) not in {"", "upay"}:
                unmapped.append({"source_type": "manual_card", "raw_client": clean(raw_client.at[idx]), "source_file": str(path), "value": 1})
        dates = date_series(choose(frame, "申请日期", required=False)).dt.normalize()
        coverage.append(source_record(path, sheet, len(frame), len(frame), dates, "manual_card_mapping"))

    if not metrics:
        return pd.DataFrame(columns=["date", "bd", "agent", "category", "open_card_virtual", "open_card_physical"]), card_map, conflicts
    combined = pd.concat(metrics, ignore_index=True).groupby(["date", "bd", "agent", "category"], as_index=False).sum(numeric_only=True)
    return combined, card_map, conflicts


def load_recharges(root: Path, mapping: dict[str, Client], coverage: list[dict[str, object]], unmapped: list[dict[str, object]]) -> tuple[pd.DataFrame, pd.DataFrame]:
    frames: list[pd.DataFrame] = []
    wanted = ["订单号", "历史代理商", "所属代理商", "充值金额", "创建时间", "状态"]
    for path in excel_files(root / "充值数据"):
        try:
            frame, sheet = read_matching_sheet(path, ["订单号", "历史代理商", "充值金额", "创建时间", "状态"], wanted)
        except ValueError:
            continue
        raw = len(frame)
        dates = date_series(choose(frame, "创建时间"))
        status = choose(frame, "状态").map(clean)
        selected = frame[status.str.contains("成功", na=False) & dates.notna()].copy()
        selected["date"] = dates.loc[selected.index].dt.normalize()
        selected["order_id"] = choose(selected, "订单号").map(clean)
        selected["raw_client"] = choose(selected, "历史代理商", "所属代理商").map(clean)
        selected["amount"] = number_series(choose(selected, "充值金额"))
        selected["source_file"] = str(path)
        selected["source_mtime"] = path.stat().st_mtime
        selected["sheet"] = sheet
        coverage.append(source_record(path, sheet, raw, len(selected), dates, "recharge"))
        frames.append(selected[["date", "order_id", "raw_client", "amount", "source_file", "source_mtime"]])
    if not frames:
        raise ValueError("没有识别到成功的充值订单。")
    all_rows = pd.concat(frames, ignore_index=True)
    before = len(all_rows)
    all_rows = all_rows.sort_values(["source_mtime", "date"]).drop_duplicates("order_id", keep="last")
    duplicates = before - len(all_rows)
    clients = all_rows.raw_client.map(lambda value: resolve(value, mapping))
    all_rows["bd"] = [client.bd for client in clients]
    all_rows["agent"] = [client.name for client in clients]
    all_rows["category"] = [client.category for client in clients]
    all_rows["mode"] = [client.mode for client in clients]
    all_rows["configured"] = [client.configured for client in clients]
    for row in all_rows.loc[~all_rows.configured & ~all_rows.raw_client.map(key).isin({"", "upay"})].itertuples(index=False):
        unmapped.append({"source_type": "recharge", "raw_client": row.raw_client, "source_file": row.source_file, "value": row.amount})
    all_rows["recharge_amount"] = all_rows.amount
    all_rows["total_amount"] = all_rows.amount.where(all_rows["mode"].eq("recharge"), 0.0)
    all_rows["recharge_count"] = 1
    metrics = all_rows.groupby(["date", "bd", "agent", "category"], as_index=False).agg(
        total_amount=("total_amount", "sum"),
        recharge_amount=("recharge_amount", "sum"),
        recharge_count=("recharge_count", "sum"),
    )
    if coverage:
        coverage.append({"source_type": "recharge_deduplication", "source_file": "ALL", "sheet": "", "raw_rows": before, "accepted_rows": len(all_rows), "duplicate_rows_removed": duplicates, "first_date": all_rows.date.min().strftime("%Y-%m-%d"), "last_date": all_rows.date.max().strftime("%Y-%m-%d")})
    return metrics, all_rows


def channel_for(path: Path) -> str | None:
    name = path.name.casefold()
    if any(word in name for word in ["授权单", "等额结算", "差额结算"]):
        return None
    if "passto" in name:
        return "passto"
    if "reap" in name:
        return "reap"
    if "straitsx" in name or "straitx" in name:
        return "straitsx"
    return None


def load_transactions(root: Path, mapping: dict[str, Client], card_map: dict[str, Client], cache_path: Path, coverage: list[dict[str, object]], unmapped: list[dict[str, object]]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    frames: list[pd.DataFrame] = []
    wanted = [
        "ID", "父ID(列表中ID列取该字段)", "卡ID", "渠道卡ID", "交易唯一ID", "交易关联ID",
        "历史所属代理商", "历史代理商名称", "所属代理商", "业务类型", "业务类型名",
        "交易状态", "交易状态名", "收支类型", "收支类型名", "收支类型文本",
        "交易金额", "交易币种", "交易币种名称", "交易原始金额", "交易原始币种", "交易时间",
    ]
    for path in excel_files(root / "消费数据"):
        channel = channel_for(path)
        if not channel:
            continue
        try:
            # May/June use the *名/*文本 header variants, while newer exports
            # use the shorter labels.  交易时间 is the stable discriminator.
            frame, sheet = read_matching_sheet(path, ["交易时间"], wanted)
        except ValueError:
            continue
        raw = len(frame)
        dates = date_series(choose(frame, "交易时间"))
        status = choose(frame, "交易状态", "交易状态名").map(clean)
        business_type = choose(frame, "业务类型", "业务类型名").map(clean)
        selected = frame[
            dates.notna()
            & status.isin({"结算", "预授权成功", "已完成", "成功"})
            & business_type.isin({"消费", "取现", "ATM取现", "退款", "赎回"})
        ].copy()
        selected["date"] = dates.loc[selected.index].dt.normalize()
        selected["status"] = status.loc[selected.index]
        selected["status_priority"] = selected.status.map({"预授权成功": 1, "成功": 1, "已完成": 2, "结算": 3}).fillna(0)
        selected["flow"] = choose(selected, "收支类型", "收支类型名", "收支类型文本").map(clean)
        selected["business_type"] = choose(selected, "业务类型", "业务类型名").map(clean)
        selected["card_id"] = choose(selected, "卡ID", required=False).map(clean)
        selected["channel_card_id"] = choose(selected, "渠道卡ID", required=False).map(clean)
        selected["raw_client"] = choose(selected, "历史所属代理商", "历史代理商名称", "所属代理商", required=False).map(clean)
        transaction_id = choose(selected, "交易关联ID", "交易唯一ID", "ID", "父ID(列表中ID列取该字段)").map(clean)
        # Keep opposite flows for the same refund ID so debit and credit can
        # net correctly, while removing repeated downloads of the same flow.
        selected["transaction_key"] = channel + "|" + transaction_id + "|" + selected["flow"]
        selected["channel"] = channel
        amount = choose(selected, "交易原始金额", "交易金额") if channel == "straitsx" and "交易原始金额" in selected.columns else choose(selected, "交易金额")
        # New StraitsX exports call the USD field 交易原始金额; old exports call
        # the same USD field 交易金额 and use 原始交易金额 for merchant currency.
        if channel == "straitsx" and "交易原始金额" not in selected.columns:
            amount = choose(selected, "交易金额")
        selected["raw_amount"] = number_series(amount)
        selected["currency"] = choose(selected, "交易币种", "交易币种名称", required=False).map(clean).str.upper()
        selected["source_file"] = str(path)
        selected["source_mtime"] = path.stat().st_mtime
        selected["sheet"] = sheet
        coverage.append(source_record(path, sheet, raw, len(selected), dates, f"transaction_{channel}"))
        frames.append(selected[["date", "status", "status_priority", "flow", "business_type", "card_id", "channel_card_id", "raw_client", "transaction_key", "channel", "raw_amount", "currency", "source_file", "source_mtime"]])
    if not frames:
        raise ValueError("没有识别到 Passto、Reap 或 StraitsX 的消费流水。")
    all_rows = pd.concat(frames, ignore_index=True)
    before = len(all_rows)
    all_rows = all_rows.sort_values(["transaction_key", "status_priority", "source_mtime", "date"]).drop_duplicates("transaction_key", keep="last")
    duplicates = before - len(all_rows)

    passto_dates = all_rows.loc[all_rows.channel.eq("passto"), "date"]
    fx_used, fx_lookup = load_fx_rates(cache_path, passto_dates)
    all_rows["fx_rate"] = 1.0
    all_rows["fx_rate_date"] = pd.NaT
    all_rows["amount_usd"] = all_rows.raw_amount
    passto_mask = all_rows.channel.eq("passto")
    if passto_mask.any():
        for idx, transaction_date in all_rows.loc[passto_mask, "date"].items():
            rate, rate_date, _ = fx_lookup[transaction_date]
            all_rows.at[idx, "fx_rate"] = rate
            all_rows.at[idx, "fx_rate_date"] = rate_date
            all_rows.at[idx, "amount_usd"] = all_rows.at[idx, "raw_amount"] / rate
    sign = all_rows.flow.map(lambda value: -1.0 if "收入" in clean(value) else 1.0)
    all_rows["consumption"] = all_rows.amount_usd * sign

    clients: list[Client] = []
    attribution_source: list[str] = []
    for row in all_rows.itertuples(index=False):
        historical = resolve(row.raw_client, mapping)
        matched = card_map.get(row.card_id)
        if historical.configured:
            clients.append(historical)
            attribution_source.append("historical_agent")
        elif matched and matched.configured:
            clients.append(matched)
            attribution_source.append("card_id")
        else:
            clients.append(historical)
            attribution_source.append("unmapped")
    all_rows["bd"] = [client.bd for client in clients]
    all_rows["agent"] = [client.name for client in clients]
    all_rows["category"] = [client.category for client in clients]
    all_rows["mode"] = [client.mode for client in clients]
    all_rows["configured"] = [client.configured for client in clients]
    all_rows["attribution_source"] = attribution_source
    all_rows["shared_consumption"] = all_rows.consumption.where(all_rows["mode"].eq("shared"), 0.0)
    all_rows["total_amount"] = all_rows.shared_consumption
    all_rows["transaction_count"] = 1
    unknown_mask = ~all_rows.configured & ~all_rows.raw_client.map(key).isin({"", "upay"})
    for row in all_rows.loc[unknown_mask].itertuples(index=False):
        unmapped.append({"source_type": f"transaction_{row.channel}", "raw_client": row.raw_client, "source_file": row.source_file, "value": row.consumption})

    metrics = all_rows.groupby(["date", "bd", "agent", "category"], as_index=False).agg(
        total_amount=("total_amount", "sum"),
        consumption=("consumption", "sum"),
        shared_consumption=("shared_consumption", "sum"),
        transaction_count=("transaction_count", "sum"),
    )
    coverage.append({"source_type": "transaction_deduplication", "source_file": "ALL", "sheet": "", "raw_rows": before, "accepted_rows": len(all_rows), "duplicate_rows_removed": duplicates, "first_date": all_rows.date.min().strftime("%Y-%m-%d"), "last_date": all_rows.date.max().strftime("%Y-%m-%d")})
    return metrics, all_rows, fx_used


def combine_metrics(cards: pd.DataFrame, recharges: pd.DataFrame, transactions: pd.DataFrame) -> pd.DataFrame:
    frames = [frame for frame in [cards, recharges, transactions] if not frame.empty]
    combined = pd.concat(frames, ignore_index=True, sort=False)
    for column in DAILY_COLUMNS[4:]:
        if column not in combined:
            combined[column] = 0
        combined[column] = pd.to_numeric(combined[column], errors="coerce").fillna(0)
    combined = combined.groupby(["date", "bd", "agent", "category"], as_index=False)[DAILY_COLUMNS[4:]].sum()
    combined["date"] = pd.to_datetime(combined.date).dt.strftime("%Y-%m-%d")
    for column in ["open_card_virtual", "open_card_physical", "transaction_count", "recharge_count"]:
        combined[column] = combined[column].round().astype(int)
    for column in ["total_amount", "consumption", "recharge_amount", "shared_consumption"]:
        combined[column] = combined[column].round(6)
    return combined.sort_values(["date", "bd", "category", "agent"])[DAILY_COLUMNS]


def dashboard_payload(daily: pd.DataFrame, targets: pd.DataFrame) -> dict[str, object]:
    month_set = sorted(set(daily.date.str[:7]) | set(targets.month))
    periods: list[dict[str, object]] = []
    for month in month_set:
        month_daily = daily[daily.date.str.startswith(month)].copy()
        month_targets = targets[targets.month.eq(month)].copy()
        dates = sorted(month_daily.date.unique())
        reports: list[dict[str, object]] = []
        for date in dates:
            rows = month_daily[month_daily.date.eq(date)]
            details = [{
                "name": row.agent, "owner": row.bd, "type": row.category,
                "recharge": float(row.total_amount), "consumption": float(row.consumption),
                "cards": int(row.open_card_virtual + row.open_card_physical),
                "cardsVirtual": int(row.open_card_virtual), "cardsPhysical": int(row.open_card_physical),
            } for row in rows.itertuples(index=False)]
            reports.append({"date": date, "details": details})
        grouped = month_daily.groupby(["bd", "agent", "category"], as_index=False).agg(
            recharge=("total_amount", "sum"), consumption=("consumption", "sum"),
            cardsVirtual=("open_card_virtual", "sum"), cardsPhysical=("open_card_physical", "sum"),
        ) if not month_daily.empty else pd.DataFrame(columns=["bd", "agent", "category", "recharge", "consumption", "cardsVirtual", "cardsPhysical"])
        latest = month_daily[month_daily.date.eq(dates[-1])].groupby(["bd", "agent"], as_index=False).total_amount.sum() if dates else pd.DataFrame(columns=["bd", "agent", "total_amount"])
        latest_lookup = {(row.bd, row.agent): row.total_amount for row in latest.itertuples(index=False)}
        details = [{
            "name": row.agent, "owner": row.bd, "type": row.category,
            "recharge": float(row.recharge), "consumption": float(row.consumption),
            "cards": int(row.cardsVirtual + row.cardsPhysical),
            "cardsVirtual": int(row.cardsVirtual), "cardsPhysical": int(row.cardsPhysical),
            "yesterday": float(latest_lookup.get((row.bd, row.agent), 0)),
        } for row in grouped.itertuples(index=False)]
        bd_totals = month_daily.groupby("bd", as_index=False).agg(
            recharge=("total_amount", "sum"), cardsVirtual=("open_card_virtual", "sum"), cardsPhysical=("open_card_physical", "sum")
        ) if not month_daily.empty else pd.DataFrame(columns=["bd", "recharge", "cardsVirtual", "cardsPhysical"])
        bd_lookup = {row.bd: row for row in bd_totals.itertuples(index=False)}
        yesterday_bd = month_daily[month_daily.date.eq(dates[-1])].groupby("bd").total_amount.sum().to_dict() if dates else {}
        overall = []
        for target in month_targets.itertuples(index=False):
            actual = bd_lookup.get(target.bd)
            virtual = int(actual.cardsVirtual) if actual else 0
            physical = int(actual.cardsPhysical) if actual else 0
            overall.append({
                "name": target.bd, "target": float(target.target),
                "recharge": float(actual.recharge) if actual else 0,
                "cards": virtual + physical, "cardsVirtual": virtual, "cardsPhysical": physical,
                "yesterday": float(yesterday_bd.get(target.bd, 0)),
            })
        periods.append({
            "id": month,
            "label": f"{month[:4]} 年 {int(month[5:])} 月",
            "start": f"{month}-01",
            "end": dates[-1] if dates else f"{month}-01",
            "overall": overall,
            "details": details,
            "daily": reports,
        })
    return {"source": "UPB automated daily pipeline", "metric": "total_amount", "periods": periods}


def aggregate_unmapped(rows: list[dict[str, object]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["source_type", "raw_client", "records", "value", "example_source_file"])
    frame = pd.DataFrame(rows)
    return frame.groupby(["source_type", "raw_client"], as_index=False).agg(
        records=("value", "size"), value=("value", "sum"), example_source_file=("source_file", "first"),
    ).sort_values(["value", "records"], ascending=False)


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Create UP Business canonical daily metrics.")
    parser.add_argument("--input-dir", type=Path, default=script_dir.parent)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=script_dir / "outputs" / "history")
    parser.add_argument("--fx-cache", type=Path, default=script_dir / "cache" / "fred_usd_hkd_daily.csv")
    args = parser.parse_args()
    root = args.input_dir.resolve()
    config_path = args.config or root / "BD代理关系目标" / "BD代理关系.xlsx"
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    try:
        mapping, targets, allowed_bds = load_configuration(config_path)
        coverage: list[dict[str, object]] = []
        unmapped: list[dict[str, object]] = []
        cards, card_map, card_conflicts = load_card_data(root, mapping, coverage, unmapped)
        recharges, recharge_detail = load_recharges(root, mapping, coverage, unmapped)
        transactions, transaction_detail, fx_used = load_transactions(root, mapping, card_map, args.fx_cache.resolve(), coverage, unmapped)
        daily = combine_metrics(cards, recharges, transactions)
        # The newest export can contain a midnight boundary row for only one
        # channel. Publish through the latest date shared by all present
        # channels so the dashboard never labels a partial day as complete.
        latest_month = daily.date.max()[:7]
        current_transactions = transaction_detail[transaction_detail.date.dt.strftime("%Y-%m").eq(latest_month)]
        channel_ends = current_transactions.groupby("channel").date.max()
        complete_through = channel_ends.min() if len(channel_ends) >= 2 else pd.to_datetime(daily.date.max())
        complete_text = complete_through.strftime("%Y-%m-%d")
        daily = daily[(~daily.date.str.startswith(latest_month)) | daily.date.le(complete_text)].copy()

        monthly = daily.assign(month=daily.date.str[:7]).groupby(["month", "bd", "agent", "category"], as_index=False).agg(
            total_amount=("total_amount", "sum"), consumption=("consumption", "sum"),
            open_card_virtual=("open_card_virtual", "sum"), open_card_physical=("open_card_physical", "sum"),
            recharge_amount=("recharge_amount", "sum"), shared_consumption=("shared_consumption", "sum"),
            transaction_count=("transaction_count", "sum"), recharge_count=("recharge_count", "sum"),
        )
        reconciliation = daily.assign(month=daily.date.str[:7]).groupby("month", as_index=False).agg(
            total_amount=("total_amount", "sum"), consumption=("consumption", "sum"),
            recharge_all_modes=("recharge_amount", "sum"), shared_consumption=("shared_consumption", "sum"),
            open_card_virtual=("open_card_virtual", "sum"), open_card_physical=("open_card_physical", "sum"),
            transaction_count=("transaction_count", "sum"), recharge_count=("recharge_count", "sum"),
        )
        reconciliation["recharge_mode_amount"] = reconciliation.total_amount - reconciliation.shared_consumption
        reconciliation["check_total_minus_components"] = reconciliation.total_amount - (
            reconciliation.recharge_mode_amount + reconciliation.shared_consumption
        )

        daily.to_csv(output / "business_daily_metrics.csv", index=False, encoding="utf-8-sig")
        targets.to_csv(output / "business_monthly_targets.csv", index=False, encoding="utf-8-sig")
        monthly.to_csv(output / "business_monthly_metrics.csv", index=False, encoding="utf-8-sig")
        reconciliation.to_csv(output / "reconciliation_by_month.csv", index=False, encoding="utf-8-sig")
        pd.DataFrame(coverage).to_csv(output / "source_coverage.csv", index=False, encoding="utf-8-sig")
        aggregate_unmapped(unmapped).to_csv(output / "unmapped_clients.csv", index=False, encoding="utf-8-sig")
        pd.DataFrame(card_conflicts, columns=["card_id", "first_agent", "later_agent", "source_file"]).to_csv(output / "card_mapping_conflicts.csv", index=False, encoding="utf-8-sig")
        fx_audit = fx_used.copy()
        for column in ["transaction_date", "matched_rate_date"]:
            if column in fx_audit:
                fx_audit[column] = pd.to_datetime(fx_audit[column]).dt.strftime("%Y-%m-%d")
        fx_audit.to_csv(output / "fx_rates_used.csv", index=False, encoding="utf-8-sig")
        (output / "dashboard-business.json").write_text(
            json.dumps(dashboard_payload(daily, targets), ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        summary = {
            "input_dir": str(root), "configuration": str(config_path), "public_bds": allowed_bds,
            "daily_rows": len(daily), "card_identifiers": len(card_map), "recharge_orders": len(recharge_detail),
            "transactions": len(transaction_detail), "unmapped_groups": len(aggregate_unmapped(unmapped)),
            "card_mapping_conflicts": len(card_conflicts), "first_date": daily.date.min(), "last_date": daily.date.max(),
            "latest_complete_date": complete_text,
            "latest_channel_dates": {name: value.strftime("%Y-%m-%d") for name, value in channel_ends.items()},
        }
        (output / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"UPB 计算完成：{len(daily)} 行每日数据，覆盖 {daily.date.min()} 至 {daily.date.max()}。")
        print(f"充值订单 {len(recharge_detail)} 条；消费流水 {len(transaction_detail)} 条；卡片映射 {len(card_map)} 个。")
        print(f"结果目录：{output}")
        return 0
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        print(f"UPB 计算失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
