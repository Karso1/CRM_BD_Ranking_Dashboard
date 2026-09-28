#!/usr/bin/env python3
"""UPW CSV adapter for the shared synchronization pipeline."""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "daily-operations" / "90-系统维护"))
from sync_common import sync

DAILY_HEADERS = ["date","bd","agent","register","open_card_virtual","open_card_physical","consumption","transaction_count"]
TARGET_HEADERS = ["month","bd","target"]

def rows(path, headers):
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != headers:
            raise ValueError(f"{path.name} 字段不正确。")
        output = []
        for row in reader:
            item = {}
            for key, value in row.items():
                if key in {"date", "month", "bd", "agent", "category"}:
                    item[key] = value
                else:
                    number = float(str(value or "0").replace(",", ""))
                    item[key] = int(number) if key in {"register", "open_card_virtual", "open_card_physical", "transaction_count", "recharge_count"} else number
            output.append(item)
        return output

def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=root / "outputs/history/wallet_daily_metrics.csv")
    parser.add_argument("--targets", type=Path, default=root / "outputs/history/wallet_monthly_targets.csv")
    parser.add_argument("--settings", type=Path, default=root / "sync.local.json")
    parser.add_argument("--dashboard-url")
    parser.add_argument("--expected-environment", choices=["production", "staging"], default="production")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    try:
        return sync(json.loads(args.settings.read_text(encoding="utf-8")), rows(args.csv, DAILY_HEADERS),
                    rows(args.targets, TARGET_HEADERS), "wallet", args.expected_environment, args.dashboard_url, args.verify_only)
    except (OSError, ValueError, KeyError) as error:
        print(f"UPW 本地文件读取失败：{error}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
