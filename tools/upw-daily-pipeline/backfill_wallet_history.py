#!/usr/bin/env python3
"""Create canonical daily UPay Wallet metrics from historical backend exports."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd


def normalise_columns(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame.columns = [str(column).strip() for column in frame.columns]
    return frame


def read_csv(path: Path) -> pd.DataFrame:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return normalise_columns(pd.read_csv(path, encoding=encoding, dtype=str, low_memory=False))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"无法读取 CSV 编码：{path.name}")


def read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return read_csv(path)
    return normalise_columns(pd.read_excel(path, dtype=str))


def require_columns(frame: pd.DataFrame, columns: list[str], source: str) -> None:
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"{source} 缺少字段：{', '.join(missing)}")


def as_text(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip().str.replace(r"\.0$", "", regex=True)


def parse_amount(value: object) -> float:
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", str(value or ""))
    return float(match.group(0).replace(",", "")) if match else 0.0


def parse_datetime(series: pd.Series) -> pd.Series:
    """Parse mixed backend date exports without swapping day and month.

    Excel exports use YYYY/MM/DD (or YYYY-MM-DD); CSV exports use DD/MM/YYYY.
    Both can occur in one historical import, so parsing must be per value rather
    than a single global ``dayfirst`` preference.
    """
    text = series.fillna("").astype(str).str.strip()
    iso_mask = text.str.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")
    result = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    if iso_mask.any():
        result.loc[iso_mask] = pd.to_datetime(text.loc[iso_mask], errors="coerce", yearfirst=True)
    if (~iso_mask).any():
        result.loc[~iso_mask] = pd.to_datetime(text.loc[~iso_mask], errors="coerce", dayfirst=True)
    return result


def card_kind(value: object, config: dict) -> str | None:
    text = str(value or "")
    if any(keyword in text for keyword in config["virtual_card_keywords"]):
        return "virtual"
    if any(keyword in text for keyword in config["physical_card_keywords"]):
        return "physical"
    return None


def load_configuration(path: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Read the single editable UID relationship and monthly-target workbook.

    A configured master UID matches the relationship export's ``总代UID``.
    A configured parent UID matches its ``上一级UID``. Parent UID wins if a user
    matches both, so explicitly configured sub-agents are separated from their
    master agent. Only names in the workbook's ``BD`` list may be shown as a BD;
    other internal staff are aggregated as ``UPay``.
    """
    frame = normalise_columns(pd.read_excel(path, dtype=str))
    require_columns(frame, ["总代UID", "上一级UID", "商务", "代理商", "月份", "目标", "BD"], path.name)
    for column in frame:
        frame[column] = as_text(frame[column])

    allowed_bds = [name for name in frame["BD"].tolist() if name and name.lower() != "bd"]
    if not allowed_bds:
        raise ValueError(f"{path.name} 的 BD 列至少需要填写一个允许展示的 BD。")
    allowed_by_lower = {name.lower(): name for name in allowed_bds}

    mapping = frame[["总代UID", "上一级UID", "商务", "代理商"]].copy()
    mapping.columns = ["master_uid", "parent_uid", "raw_bd", "agent"]
    mapping = mapping[(mapping.master_uid != "") | (mapping.parent_uid != "")].copy()
    mapping["is_internal"] = ~mapping.raw_bd.str.lower().isin(allowed_by_lower)
    # Targets and dashboard contribution have one catch-all bucket: UPay.
    # The configured employee name is never shown outside the public BD list.
    mapping["bd"] = mapping.raw_bd.str.lower().map(allowed_by_lower).fillna("UPay")
    mapping["agent"] = mapping.agent.replace("", "UPay")
    mapping.loc[mapping.is_internal & (mapping.agent.str.lower() == mapping.raw_bd.str.lower()), "agent"] = "UPay"
    for key, label in (("master_uid", "总代UID"), ("parent_uid", "上一级UID")):
        configured = mapping[mapping[key] != ""]
        if configured[key].duplicated().any():
            duplicates = ", ".join(configured.loc[configured[key].duplicated(keep=False), key].drop_duplicates().head(8))
            raise ValueError(f"配置表中有重复{label}：{duplicates}")

    monthly_totals = frame[["月份", "目标"]].copy()
    monthly_totals.columns = ["month", "total_target"]
    monthly_totals = monthly_totals[monthly_totals.month.str.fullmatch(r"\d{6}", na=False)].copy()
    if monthly_totals.month.duplicated().any():
        duplicates = ", ".join(monthly_totals.loc[monthly_totals.month.duplicated(keep=False), "month"].drop_duplicates())
        raise ValueError(f"配置表中有重复月份目标：{duplicates}")
    recipients = allowed_bds + ["UPay"]
    target_rows: list[dict[str, object]] = []
    for _, row in monthly_totals.iterrows():
        month = f"{row.month[:4]}-{row.month[4:]}"
        total = round(parse_amount(row.total_target), 2)
        share = round(total / len(recipients), 2)
        for bd in recipients:
            # Assign the two-decimal rounding remainder to UPay so displayed
            # targets always reconcile exactly to the configured monthly total.
            amount = round(total - share * (len(recipients) - 1), 2) if bd == "UPay" else share
            target_rows.append({"month": month, "bd": bd, "target": amount})
    return mapping, pd.DataFrame(target_rows, columns=["month", "bd", "target"]), allowed_bds


def column_names(path: Path) -> set[str]:
    if path.suffix.lower() == ".csv":
        # 只读取表头；历史交易 CSV 很大，不需要为识别文件而加载整份内容。
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                return set(normalise_columns(pd.read_csv(path, encoding=encoding, nrows=0)).columns)
            except UnicodeDecodeError:
                continue
        raise ValueError(f"无法读取 CSV 编码：{path.name}")
    return set(normalise_columns(pd.read_excel(path, nrows=0)).columns)


def source_files(input_dir: Path) -> tuple[Path, Path, list[Path]]:
    candidates = [path for path in input_dir.iterdir() if path.is_file() and not path.name.startswith(".")]
    relationship = next((path for path in candidates if "代理关系查询" in path.name), None)
    cards = next((path for path in candidates if "用户卡片" in path.name), None)
    if not relationship or not cards:
        raise FileNotFoundError("total data 中必须有代理关系查询文件和用户卡片文件。")
    transactions = []
    for path in candidates:
        if path in {relationship, cards} or path.suffix.lower() not in {".csv", ".xlsx"}:
            continue
        try:
            if "交易类型" in column_names(path):
                transactions.append(path)
        except Exception as error:
            raise ValueError(f"无法检查文件 {path.name}：{error}") from error
    if not transactions:
        raise FileNotFoundError("total data 中没有识别到交易记录文件。")
    return relationship, cards, sorted(transactions, key=lambda path: path.name)


def apply_range(frame: pd.DataFrame, date_column: str, start: str | None, end: str | None) -> pd.DataFrame:
    output = frame.copy()
    if start:
        output = output[output[date_column] >= pd.Timestamp(start)]
    if end:
        output = output[output[date_column] <= pd.Timestamp(end)]
    return output


def create_backfill(input_dir: Path, configuration_book: Path, output_dir: Path, config: dict, start: str | None, end: str | None) -> Path:
    relation_path, cards_path, transaction_paths = source_files(input_dir)
    mapping, monthly_targets, allowed_bds = load_configuration(configuration_book)

    relation = read_table(relation_path)
    require_columns(relation, ["用户UID", "总代UID", "上一级UID", "注册时间"], relation_path.name)
    relation = relation[["用户UID", "总代UID", "上一级UID", "注册时间"]].copy()
    relation.columns = ["user_uid", "master_uid", "parent_uid", "registered_at"]
    relation.user_uid = as_text(relation.user_uid)
    relation.master_uid = as_text(relation.master_uid)
    relation.parent_uid = as_text(relation.parent_uid)
    relation.registered_at = parse_datetime(relation.registered_at)
    relation = relation.dropna(subset=["registered_at"]).drop_duplicates("user_uid", keep="last")
    master_mapping = mapping[mapping.master_uid != ""][["master_uid", "bd", "agent"]].rename(columns={"bd": "master_bd", "agent": "master_agent"})
    parent_mapping = mapping[mapping.parent_uid != ""][["parent_uid", "bd", "agent"]].rename(columns={"bd": "parent_bd", "agent": "parent_agent"})
    population = relation.merge(master_mapping, on="master_uid", how="left")
    population = population.merge(parent_mapping, on="parent_uid", how="left")
    # A parent mapping is more specific than a master mapping. Prefer it when
    # both exist; fall back to the master mapping for users whose direct parent
    # has not been configured separately.
    population["bd"] = population.parent_bd.combine_first(population.master_bd)
    population["agent"] = population.parent_agent.combine_first(population.master_agent)
    mapped_users = population[population.bd.notna()].copy()
    # Keep every user that can be related to a master UID. Transactions with an
    # unknown master (or no relation row) are deliberately retained later as
    # UPay instead of silently disappearing from total volume.
    attributed_users = population[["user_uid", "master_uid", "parent_uid", "bd", "agent"]].drop_duplicates("user_uid", keep="last").copy()

    cards = read_table(cards_path)
    require_columns(cards, ["用户UID", "用户卡ID", "站点卡ID", "创建时间"], cards_path.name)
    cards = cards[["用户UID", "用户卡ID", "站点卡ID", "创建时间"]].copy()
    cards.columns = ["user_uid", "card_id", "site_card", "created_at"]
    cards.user_uid = as_text(cards.user_uid)
    cards.card_id = as_text(cards.card_id)
    cards.created_at = parse_datetime(cards.created_at)
    cards["card_kind"] = cards.site_card.map(lambda value: card_kind(value, config))
    raw_card_user_ids = set(cards.user_uid[cards.created_at.notna() & (cards.card_id != "")])
    cards = cards.merge(attributed_users[["user_uid", "bd", "agent"]], on="user_uid", how="left")
    cards["bd"] = cards["bd"].fillna("UPay")
    cards["agent"] = cards["agent"].fillna("UPay")

    transaction_frames: list[pd.DataFrame] = []
    coverage: list[dict[str, object]] = []
    required_transaction_columns = ["订单编号", "用户UID", "用户卡ID", "交易类型", "状态", "用户卡流水", config["transaction_date_column"]]
    for path in transaction_paths:
        frame = read_table(path)
        require_columns(frame, required_transaction_columns, path.name)
        frame = frame[required_transaction_columns].copy()
        frame.columns = ["order_id", "user_uid", "card_id", "transaction_type", "status", "card_flow", "transaction_at"]
        frame.order_id = as_text(frame.order_id)
        frame.user_uid = as_text(frame.user_uid)
        frame.card_id = as_text(frame.card_id)
        frame.transaction_at = parse_datetime(frame.transaction_at)
        coverage.append({
            "source_file": path.name,
            "records": len(frame),
            "first_transaction": frame.transaction_at.min(),
            "last_transaction": frame.transaction_at.max(),
        })
        transaction_frames.append(frame)

    transactions = pd.concat(transaction_frames, ignore_index=True)
    transactions = transactions.dropna(subset=["transaction_at"]).drop_duplicates("order_id", keep="last")
    transactions = transactions[
        transactions.status.isin(config["successful_transaction_status"])
        & transactions.transaction_type.isin(config["included_transaction_types"])
    ].copy()
    raw_transaction_user_ids = set(transactions.user_uid[transactions.user_uid != ""])
    transactions["flow_amount"] = transactions.card_flow.map(parse_amount)
    transactions["net_consumption"] = -transactions.flow_amount
    transactions = transactions.merge(attributed_users[["user_uid", "bd", "agent"]], on="user_uid", how="left")
    transactions["bd"] = transactions["bd"].fillna("UPay")
    transactions["agent"] = transactions["agent"].fillna("UPay")

    registrations = mapped_users.assign(date=mapped_users.registered_at.dt.normalize())
    registrations = apply_range(registrations, "date", start, end)
    registrations = registrations.groupby(["date", "bd", "agent"], as_index=False).agg(register=("user_uid", "nunique"))

    classified_cards = cards.dropna(subset=["created_at", "card_kind"]).assign(date=cards.created_at.dt.normalize())
    classified_cards = apply_range(classified_cards, "date", start, end)
    card_metrics = (
        classified_cards.groupby(["date", "bd", "agent", "card_kind"])["card_id"]
        .nunique()
        .unstack(fill_value=0)
        .reset_index()
        .rename(columns={"virtual": "open_card_virtual", "physical": "open_card_physical"})
    )
    for column in ("open_card_virtual", "open_card_physical"):
        if column not in card_metrics.columns:
            card_metrics[column] = 0

    transactions["date"] = transactions.transaction_at.dt.normalize()
    transactions = apply_range(transactions, "date", start, end)
    consumption = transactions.groupby(["date", "bd", "agent"], as_index=False).agg(
        consumption=("net_consumption", "sum"),
        transaction_count=("order_id", "nunique"),
    )

    # The reporting cutoff follows completed transaction data. Card and
    # registration exports can arrive one day earlier than transactions;
    # including that later day creates a misleading zero-consumption point.
    latest_transaction_date = consumption.loc[consumption.transaction_count > 0, "date"].max()
    if pd.notna(latest_transaction_date):
        registrations = registrations[registrations.date <= latest_transaction_date]
        card_metrics = card_metrics[card_metrics.date <= latest_transaction_date]

    daily = registrations.merge(card_metrics, on=["date", "bd", "agent"], how="outer")
    daily = daily.merge(consumption, on=["date", "bd", "agent"], how="outer").fillna(0)
    for column in ("register", "open_card_virtual", "open_card_physical", "transaction_count"):
        daily[column] = daily[column].astype(int)
    daily["consumption"] = daily["consumption"].round(2)
    daily["date"] = pd.to_datetime(daily["date"]).dt.strftime("%Y-%m-%d")
    daily = daily[["date", "bd", "agent", "register", "open_card_virtual", "open_card_physical", "consumption", "transaction_count"]]
    daily = daily.sort_values(["date", "bd", "agent"], kind="stable")

    monthly = daily.assign(month=daily.date.str.slice(0, 7)).groupby(["month", "bd", "agent"], as_index=False).agg(
        register=("register", "sum"),
        open_card_virtual=("open_card_virtual", "sum"),
        open_card_physical=("open_card_physical", "sum"),
        consumption=("consumption", "sum"),
        transaction_count=("transaction_count", "sum"),
    )
    monthly["consumption"] = monthly["consumption"].round(2)

    # 在合并 BD / 代理商之前保存 UID，才能把“有业务但未配置总代归属”的记录列出来。
    registered_user_ids = set(population.user_uid)
    active_user_ids = raw_transaction_user_ids | raw_card_user_ids | registered_user_ids
    unmapped = population[population.bd.isna() & population.user_uid.isin(active_user_ids)].copy()
    unmapped["reference_uid"] = unmapped.master_uid.where(unmapped.master_uid != "", unmapped.parent_uid)
    unmapped_summary = unmapped.groupby("reference_uid", as_index=False).agg(
        affected_users=("user_uid", "nunique"),
        first_registration=("registered_at", "min"),
        last_registration=("registered_at", "max"),
    )
    unknown_cards = cards[cards.card_kind.isna() & cards.created_at.notna()].groupby("site_card", as_index=False).agg(
        cards=("card_id", "nunique"),
        first_created=("created_at", "min"),
        last_created=("created_at", "max"),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    daily.to_csv(output_dir / "wallet_daily_metrics.csv", index=False, encoding="utf-8-sig")
    monthly.to_csv(output_dir / "wallet_monthly_metrics.csv", index=False, encoding="utf-8-sig")
    monthly_targets.to_csv(output_dir / "wallet_monthly_targets.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(coverage).to_csv(output_dir / "transaction_source_coverage.csv", index=False, encoding="utf-8-sig")
    unmapped_summary.to_csv(output_dir / "unmapped_master_uids.csv", index=False, encoding="utf-8-sig")
    unknown_cards.to_csv(output_dir / "unclassified_card_types.csv", index=False, encoding="utf-8-sig")
    manifest = {
        "relationship_file": relation_path.name,
        "cards_file": cards_path.name,
        "transaction_files": [path.name for path in transaction_paths],
        "configuration_workbook": str(configuration_book),
        "allowed_bds": allowed_bds,
        "transaction_date_column": config["transaction_date_column"],
        "included_transaction_types": config["included_transaction_types"],
        "start": start,
        "end": end,
        "latest_complete_transaction_date": (
            latest_transaction_date.strftime("%Y-%m-%d") if pd.notna(latest_transaction_date) else None
        ),
        "daily_rows": int(len(daily)),
        "daily_date_range": [daily.date.min() if not daily.empty else None, daily.date.max() if not daily.empty else None],
    }
    (output_dir / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_dir


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    default_mapping = script_dir.parent / "total data" / "代理关系及月份目标.xlsx"
    parser = argparse.ArgumentParser(description="Backfill UPay Wallet daily metrics from historical backend exports.")
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--mapping-workbook", type=Path, default=default_mapping, help="代理关系及月份目标.xlsx")
    parser.add_argument("--output-dir", type=Path, default=script_dir / "outputs" / "history")
    parser.add_argument("--from", dest="start", help="Inclusive date, YYYY-MM-DD")
    parser.add_argument("--to", dest="end", help="Inclusive date, YYYY-MM-DD")
    parser.add_argument("--config", type=Path, default=script_dir / "config.json")
    args = parser.parse_args()
    try:
        if args.start:
            pd.Timestamp(args.start)
        if args.end:
            pd.Timestamp(args.end)
        if args.start and args.end and pd.Timestamp(args.start) > pd.Timestamp(args.end):
            raise ValueError("--from 不能晚于 --to")
        config = json.loads(args.config.read_text(encoding="utf-8"))
        destination = create_backfill(args.input_dir, args.mapping_workbook, args.output_dir, config, args.start, args.end)
        print(f"历史回填完成：{destination}")
        return 0
    except Exception as error:
        print(f"处理失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
