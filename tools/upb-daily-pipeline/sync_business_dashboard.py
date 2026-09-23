#!/usr/bin/env python3
"""Upload canonical UP Business daily rows to the private dashboard endpoint."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DAILY_HEADERS = [
    "date", "bd", "agent", "category", "total_amount", "consumption",
    "open_card_virtual", "open_card_physical", "recharge_amount",
    "shared_consumption", "transaction_count", "recharge_count",
]
TARGET_HEADERS = ["month", "bd", "target", "card_target"]
DEFAULT_REFRESH_URL = "https://upay-bd-ranking.karsol.workers.dev/api/dashboard?platform=business&refresh=1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def numeric(value: str, integer: bool = False) -> int | float:
    parsed = float(str(value or "0").replace(",", ""))
    return int(parsed) if integer else parsed


def rows(path: Path, headers: list[str]) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != headers:
            raise ValueError(f"{path.name} 字段不正确。需要：{', '.join(headers)}")
        output = []
        for row in reader:
            item: dict[str, object] = {}
            for field in headers:
                if field in {"date", "month", "bd", "agent", "category"}:
                    item[field] = row[field]
                else:
                    item[field] = numeric(row[field], field in {"open_card_virtual", "open_card_physical", "transaction_count", "recharge_count"})
            output.append(item)
        return output


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Sync UP Business canonical data.")
    parser.add_argument("--daily", type=Path, default=script_dir / "outputs" / "history" / "business_daily_metrics.csv")
    parser.add_argument("--targets", type=Path, default=script_dir / "outputs" / "history" / "business_monthly_targets.csv")
    parser.add_argument("--settings", type=Path, default=script_dir / "sync.local.json")
    parser.add_argument("--dashboard-url", default=DEFAULT_REFRESH_URL)
    args = parser.parse_args()
    try:
        settings = json.loads(args.settings.read_text(encoding="utf-8"))
        endpoint, secret = settings["endpoint"], settings["key"]
        daily_rows = rows(args.daily, DAILY_HEADERS)
        target_rows = rows(args.targets, TARGET_HEADERS)
        if not daily_rows:
            raise ValueError("每日数据为空，已停止同步。")
        url = endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode({"key": secret})
        payload = json.dumps({"businessRows": daily_rows, "businessTargets": target_rows}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=120) as response:
                result = json.loads(response.read().decode("utf-8"))
            if not result.get("ok"):
                raise ValueError(result.get("error", "Google Sheet 未确认写入。"))
        except urllib.error.HTTPError as error:
            if error.code not in {301, 302, 303, 307, 308}:
                raise

        with urllib.request.urlopen(url, timeout=120) as response:
            verification = json.loads(response.read().decode("utf-8"))
        periods = verification.get("business", {}).get("periods", [])
        if not periods:
            raise ValueError(verification.get("error", "写入后没有读取到 UP Business 数据。"))
        try:
            refresh = urllib.request.Request(args.dashboard_url, headers={"Accept": "application/json", "User-Agent": "UPay-UPB-Sync/1.0"})
            with urllib.request.urlopen(refresh, timeout=120) as response:
                website = json.loads(response.read().decode("utf-8"))
            if not website.get("business", {}).get("periods"):
                raise ValueError("网站没有确认 UP Business 缓存。")
            print(f"UPB 同步完成：{len(daily_rows)} 行，已验证 {len(periods)} 个统计月份；网站缓存已更新。")
        except (OSError, ValueError, urllib.error.URLError) as error:
            print(f"UPB 已同步 Google Sheet：{len(daily_rows)} 行；网站缓存将在首次访问时更新（{error}）。")
        return 0
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        print(f"UPB 同步失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
