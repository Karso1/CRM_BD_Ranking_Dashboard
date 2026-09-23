#!/usr/bin/env python3
"""Upload the canonical Wallet daily CSV to the private Google Sheet endpoint."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


HEADERS = [
    "date", "bd", "agent", "register", "open_card_virtual",
    "open_card_physical", "consumption", "transaction_count",
]
TARGET_HEADERS = ["month", "bd", "target"]
DEFAULT_DASHBOARD_REFRESH_URL = "https://upay-bd-ranking.karsol.workers.dev/api/dashboard?platform=wallet&refresh=1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Treat Apps Script's accepted POST redirect as a successful handoff.

    The /exec endpoint writes the Sheet and then redirects to a Google content
    host. Following that redirect as a POST can return HTTP 405 even though the
    write has already succeeded.  We therefore stop at the redirect and verify
    the result with a separate authenticated GET request.
    """

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def number(value: str, integer: bool = False) -> int | float:
    parsed = float(str(value or "0").replace(",", ""))
    return int(parsed) if integer else parsed


def load_rows(path: Path) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != HEADERS:
            raise ValueError(f"CSV 字段不正确。需要：{', '.join(HEADERS)}")
        return [{
            "date": row["date"],
            "bd": row["bd"],
            "agent": row["agent"],
            "register": number(row["register"], True),
            "open_card_virtual": number(row["open_card_virtual"], True),
            "open_card_physical": number(row["open_card_physical"], True),
            "consumption": number(row["consumption"]),
            "transaction_count": number(row["transaction_count"], True),
    } for row in reader]


def load_targets(path: Path) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != TARGET_HEADERS:
            raise ValueError(f"目标 CSV 字段不正确。需要：{', '.join(TARGET_HEADERS)}")
        return [{"month": row["month"], "bd": row["bd"], "target": number(row["target"])} for row in reader]


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Sync Wallet daily dashboard data to Google Sheets.")
    parser.add_argument("--csv", type=Path, default=script_dir / "outputs" / "history" / "wallet_daily_metrics.csv")
    parser.add_argument("--targets", type=Path, default=script_dir / "outputs" / "history" / "wallet_monthly_targets.csv")
    parser.add_argument("--settings", type=Path, default=script_dir / "sync.local.json")
    parser.add_argument("--dashboard-url", default=DEFAULT_DASHBOARD_REFRESH_URL, help="Website cache refresh URL")
    args = parser.parse_args()
    try:
        settings = json.loads(args.settings.read_text(encoding="utf-8"))
        endpoint, key = settings["endpoint"], settings["key"]
        rows = load_rows(args.csv)
        targets = load_targets(args.targets)
        if not rows:
            raise ValueError("每日数据为空，已停止同步。")
        url = endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode({"key": key})
        request = urllib.request.Request(
            url,
            data=json.dumps({"rows": rows, "targets": targets}, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=300) as response:
                result = json.loads(response.read().decode("utf-8"))
            if not result.get("ok"):
                raise ValueError(result.get("error", "Google Sheet 未确认写入。"))
        except urllib.error.HTTPError as error:
            if error.code not in {301, 302, 303, 307, 308}:
                raise

        # Refresh and verify the Worker cache once. The Worker performs the
        # expensive Apps Script read and stores the result, so visitors receive
        # this exact payload immediately instead of rebuilding it on page load.
        dashboard_request = urllib.request.Request(
            args.dashboard_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "UPay-Wallet-Sync/1.0",
            },
        )
        with urllib.request.urlopen(dashboard_request, timeout=360) as response:
            dashboard = json.loads(response.read().decode("utf-8"))
        periods = dashboard.get("wallet", {}).get("periods", [])
        if not periods:
            raise ValueError(dashboard.get("error", "网站没有确认 Wallet 缓存。"))
        expected_end = max(str(row["date"]) for row in rows)
        latest_month = expected_end[:7]
        latest_period = next((period for period in periods if period.get("id") == latest_month), None)
        if not latest_period or str(latest_period.get("end", "")) < expected_end:
            raise ValueError(f"网站仍是旧数据；期望截至 {expected_end}。")
        expected_total = round(sum(float(row["consumption"]) for row in rows if str(row["date"]).startswith(latest_month)), 2)
        published_total = round(sum(float(row.get("recharge", 0)) for row in latest_period.get("overall", [])), 2)
        if abs(expected_total - published_total) > 0.01:
            raise ValueError(f"网站缓存金额未更新；本地 {expected_total:.2f}，网站 {published_total:.2f}。")
        print(f"Google Sheet 同步完成：{len(rows)} 行，已验证 {len(periods)} 个统计月份；网站缓存已更新至 {expected_end}。")
        return 0
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        print(f"同步失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

