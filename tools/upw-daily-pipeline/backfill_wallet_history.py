#!/usr/bin/env python3
"""Create canonical daily UPay Wallet metrics from historical backend exports."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd


MASTER_SHEET = "代理商明细 "


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


def load_mapping(path: Path) -> pd.DataFrame:
    frame = normalise_columns(pd.read_excel(path, sheet_name=MASTER_SHEET, dtype=str))
    require_columns(frame, ["总代UID", "商务", "代理商"], f"{path.name} 的 {MASTER_SHEET}")
    frame = frame[["总代UID", "商务", "代理商"]].copy()
    frame.columns = ["master_uid", "bd", "agent"]
    for column in frame:
        frame[column] = as_text(frame[column])
    frame = frame[(frame.master_uid != "") & (frame.bd != "") & (frame.agent != "")]
    if frame.master_uid.duplicated().any():
        duplicates = ", ".join(frame.loc[frame.master_uid.duplicated(keep=False), "master_uid"].drop_duplicates().head(8))
        raise ValueError(f"代理商明细中有重复总代UID：{duplicates}")
    return frame


def load_monthly_targets(path: Path) -> pd.DataFrame:
    """Read the manually managed monthly BD targets from the legacy workbook.

    Targets do not exist in the backend exports, so they remain a business input.
    Keeping them in the existing summary sheets avoids inventing a second target
    list and lets the dashboard follow the same values the team already uses.
    """
    workbook = pd.ExcelFile(path)
    rows: list[dict[str, object]] = []
    for month in range(1, 10):
        candidates = ([f"汇总{month}"] if month != 3 else ["汇总33", "汇总3"]) + [f"UW maintainer汇总{month}"]
        sheet = next((name for name in candidates if name in workbook.sheet_names), None)
        if not sheet:
            continue
        values = pd.read_excel(path, sheet_name=sheet, header=None, dtype=object, keep_default_na=False)
        header = next((index for index, row in values.iterrows() if str(row.iloc[0]).strip().lower() == "maintainer" and str(row.iloc[1]).strip().lower() == "target"), None)
        if header is None:
            continue
        for _, row in values.iloc[header + 1:].iterrows():
            name = str(row.iloc[0]).strip()
            if not name:
                break
            if name.lower() == "total":
                break
            target = parse_amount(row.iloc[1])
            if name and target >= 0:
                rows.append({"month": f"2026-{month:02d}", "bd": name, "target": round(target, 2)})
        if rows:
            # Each month has exactly one source sheet. Do not fall through to a
            # legacy duplicate if this sheet already supplied its targets.
            rows_for_month = [row for row in rows if row["month"] == f"2026-{month:02d}"]
            if rows_for_month:
                continue
    return pd.DataFrame(rows, columns=["month", "bd", "target"])


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


def create_backfill(input_dir: Path, mapping_book: Path, output_dir: Path, config: dict, start: str | None, end: str | None) -> Path:
    relation_path, cards_path, transaction_paths = source_files(input_dir)
    mapping = load_mapping(mapping_book)
    monthly_targets = load_monthly_targets(mapping_book)

    relation = read_table(relation_path)
    require_columns(relation, ["用户UID", "总代UID", "注册时间"], relation_path.name)
    relation = relation[["用户UID", "总代UID", "注册时间"]].copy()
    relation.columns = ["user_uid", "master_uid", "registered_at"]
    relation.user_uid = as_text(relation.user_uid)
    relation.master_uid = as_text(relation.master_uid)
    relation.registered_at = parse_datetime(relation.registered_at)
    relation = relation.dropna(subset=["registered_at"]).drop_duplicates("user_uid", keep="last")
    population = relation.merge(mapping, on="master_uid", how="left")
    mapped_users = population[population.bd.notna()].copy()
    # Keep every user that can be related to a master UID. Transactions with an
    # unknown master (or no relation row) are deliberately retained later as
    # Others / Unassigned instead of silently disappearing from total volume.
    attributed_users = population[["user_uid", "master_uid", "bd", "agent"]].drop_duplicates("user_uid", keep="last").copy()

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
    cards["bd"] = cards["bd"].fillna("Others")
    cards["agent"] = cards["agent"].fillna("Unassigned")

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
    transactions["bd"] = transactions["bd"].fillna("Others")
    transactions["agent"] = transactions["agent"].fillna("Unassigned")

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
    unmapped_summary = unmapped.groupby("master_uid", as_index=False).agg(
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
        "mapping_workbook": str(mapping_book),
        "transaction_date_column": config["transaction_date_column"],
        "included_transaction_types": config["included_transaction_types"],
        "start": start,
        "end": end,
        "daily_rows": int(len(daily)),
        "daily_date_range": [daily.date.min() if not daily.empty else None, daily.date.max() if not daily.empty else None],
    }
    (output_dir / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_dir


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    default_mapping = script_dir.parent / "UW每日数据.xlsx"
    parser = argparse.ArgumentParser(description="Backfill UPay Wallet daily metrics from historical backend exports.")
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--mapping-workbook", type=Path, default=default_mapping)
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

