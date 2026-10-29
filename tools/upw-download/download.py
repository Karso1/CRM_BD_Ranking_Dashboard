#!/usr/bin/env python3
"""Download and validate UPW card, transaction and relationship exports.

Only the backend's visible export controls are used. This command never uploads
data or publishes either dashboard environment.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from zoneinfo import ZoneInfo

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "tools/daily-operations/03-原始数据/UPW每日数据/total data"
STATE = Path(__file__).resolve().parent / ".local"
COVERAGE = Path(__file__).resolve().parent / "UPW-已导入日期.json"
DESKTOP_COVERAGE = Path.home() / "Desktop/UPay每日数据操作台/01-下载数据/upwdownload/UPW-已导入日期.json"
BASE = "https://upayv3.alliancebxc.com:31007/?#/"
CARDS_URL = BASE + "Business/ThirdDebitCard?tab=用户卡片"
TRANSACTIONS_URL = BASE + "Business/ThirdDebitCard?tab=交易记录"
RELATIONSHIPS_URL = BASE + "Activity/Promotion/Relationship?tab=用户代理关系"
SEGMENT = 10_000
CARD_COLUMNS = {"用户UID", "用户卡ID", "站点卡ID", "创建时间", "卡状态"}
TRANSACTION_COLUMNS = {"订单编号", "用户UID", "用户卡ID", "交易类型", "状态", "用户卡流水", "交易提交时间"}
RELATIONSHIP_COLUMNS = {"用户UID", "总代UID", "上一级UID", "注册时间"}
RELATIONSHIP_FIELDS = ("用户UID", "总代UID", "上一级UID", "注册时间")


def table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                frame = pd.read_csv(path, dtype=str, encoding=encoding, low_memory=False)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError(f"不能读取 CSV：{path.name}")
    else:
        frame = pd.read_excel(path, dtype=str)
    frame.columns = [str(column).strip() for column in frame.columns]
    return frame.fillna("")


def dates(frame: pd.DataFrame, column: str) -> pd.Series:
    raw = frame[column].astype(str).str.strip()
    iso = raw.str.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")
    result = pd.Series(pd.NaT, index=frame.index, dtype="datetime64[ns]")
    result.loc[iso] = pd.to_datetime(raw.loc[iso], errors="coerce", yearfirst=True)
    result.loc[~iso] = pd.to_datetime(raw.loc[~iso], errors="coerce", dayfirst=True)
    return result


def require(frame: pd.DataFrame, columns: set[str], name: str) -> None:
    missing = sorted(columns - set(frame.columns))
    if missing:
        raise ValueError(f"{name} 缺少字段：{', '.join(missing)}")


def validate_cards(path: Path, expected: int) -> int:
    frame = table(path)
    require(frame, CARD_COLUMNS, path.name)
    if len(frame) != expected or expected == 0:
        raise ValueError(f"开卡导出行数不符：页面 {expected}，文件 {len(frame)}")
    if not frame["卡状态"].eq("申请成功").all():
        raise ValueError("开卡文件混入非申请成功的记录")
    if frame["用户卡ID"].eq("").any() or frame["用户卡ID"].duplicated().any():
        raise ValueError("开卡文件有空白或重复用户卡 ID")
    if dates(frame, "创建时间").isna().any():
        raise ValueError("开卡文件含无法识别的创建时间")
    return len(frame)


def validate_transactions(path: Path, day: date, expected: int) -> int:
    frame = table(path)
    require(frame, TRANSACTION_COLUMNS, path.name)
    if len(frame) != expected:
        raise ValueError(f"交易导出行数不符：页面 {expected}，文件 {len(frame)}")
    if frame["订单编号"].eq("").any() or frame["订单编号"].duplicated().any():
        raise ValueError("交易文件有空白或重复订单编号")
    if not frame["状态"].eq("已完成").all():
        raise ValueError("交易文件混入非已完成记录")
    parsed = dates(frame, "交易提交时间")
    if parsed.isna().any() or not parsed.dt.date.eq(day).all():
        raise ValueError(f"交易文件不是完整的 {day} 单日数据")
    return len(frame)


def validate_relationships(path: Path, expected: int) -> pd.DataFrame:
    frame = table(path)
    require(frame, RELATIONSHIP_COLUMNS, path.name)
    if len(frame) != expected or expected == 0:
        raise ValueError(f"关系导出行数不符：页面 {expected}，文件 {len(frame)}")
    if frame["用户UID"].eq("").any() or frame["用户UID"].duplicated().any():
        raise ValueError("关系文件有空白或重复用户 UID")
    parsed = dates(frame, "注册时间")
    if parsed.isna().any() or not parsed.is_monotonic_decreasing:
        raise ValueError("关系文件的注册时间无效或未按倒序排列，不能增量导入")
    return frame


def current_relationships(data: Path) -> tuple[dict[str, dict[str, str]], pd.Timestamp]:
    baseline_files = sorted(path for path in data.iterdir() if path.name.startswith("代理关系查询-") and path.suffix.lower() in {".csv", ".xlsx"})
    if len(baseline_files) != 1:
        raise ValueError("代理关系历史底表必须恰好有一份")
    baseline = table(baseline_files[0])
    require(baseline, RELATIONSHIP_COLUMNS, baseline_files[0].name)
    current: dict[str, dict[str, str]] = {}
    for row in baseline.loc[:, list(RELATIONSHIP_FIELDS)].to_dict("records"):
        current[str(row["用户UID"]).strip()] = {key: str(row[key]).strip() for key in RELATIONSHIP_FIELDS}
    changes = data / "代理关系增量.jsonl"
    if changes.exists():
        with changes.open(encoding="utf-8") as stream:
            for number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict) or not RELATIONSHIP_COLUMNS.issubset(row):
                    raise ValueError(f"代理关系增量第 {number} 行无效")
                current[str(row["用户UID"]).strip()] = {key: str(row[key]).strip() for key in RELATIONSHIP_FIELDS}
    maximum = pd.to_datetime([row["注册时间"] for row in current.values()], errors="coerce").max()
    if pd.isna(maximum):
        raise ValueError("代理关系历史底表没有有效注册时间")
    return current, maximum


def covered_transaction_days(data: Path) -> set[date]:
    covered: set[date] = set()
    for path in data.iterdir():
        if path.suffix.lower() not in {".csv", ".xlsx"} or "用户卡片" in path.name or "代理关系" in path.name:
            continue
        try:
            frame = table(path)
        except (ValueError, OSError):
            continue
        if "交易提交时间" not in frame.columns:
            continue
        covered.update(dates(frame, "交易提交时间").dropna().dt.date)
    if not covered:
        raise ValueError("找不到现有交易记录，无法确定从哪天自动补齐；请指定 --start-date")
    return covered


def coverage_content(covered: set[date]) -> str:
    payload = {
        "schema": "upw-coverage-v1",
        "first_date": str(min(covered)),
        "covered_days": [str(day) for day in sorted(covered)],
        "generated_for": str(datetime.now(ZoneInfo("Asia/Shanghai")).date()),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def coverage_targets(output: Path | None = None) -> list[Path]:
    target = (output if output is not None else COVERAGE).resolve()
    targets = [target]
    # The unpacked Chrome extension is launched from the Desktop copy. Keep
    # its already-selected FileSystemFileHandle in sync after every import.
    if output is None and DESKTOP_COVERAGE.is_file() and DESKTOP_COVERAGE.resolve() != target:
        targets.append(DESKTOP_COVERAGE)
    return targets


def install_coverage(content: str, targets: list[Path], backup: Path) -> None:
    """Prepare all index writes first; restore every replaced index on failure."""
    staged: list[tuple[Path, Path, Path | None]] = []
    replaced: list[tuple[Path, Path | None]] = []
    try:
        for index, destination in enumerate(targets):
            destination.parent.mkdir(parents=True, exist_ok=True)
            saved = backup / f"coverage-{index:02d}.json" if destination.exists() else None
            if saved is not None:
                shutil.copy2(destination, saved)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                             prefix=".upw-coverage-", delete=False) as stream:
                temporary = Path(stream.name)
                staged.append((temporary, destination, saved))
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        for temporary, destination, saved in staged:
            os.replace(temporary, destination)
            replaced.append((destination, saved))
            if destination.read_text(encoding="utf-8") != content:
                raise OSError(f"日期清单写入校验失败：{destination}")
    except BaseException:
        for destination, saved in reversed(replaced):
            if saved is None:
                destination.unlink(missing_ok=True)
            else:
                os.replace(saved, destination)
        raise
    finally:
        for temporary, _, _ in staged:
            temporary.unlink(missing_ok=True)


def write_coverage(data: Path, output: Path | None = None) -> Path:
    """Refresh the project index and the existing desktop extension's index."""
    content = coverage_content(covered_transaction_days(data))
    targets = coverage_targets(output)
    with tempfile.TemporaryDirectory(prefix="upw-coverage-backup-") as folder:
        install_coverage(content, targets, Path(folder))
    return targets[0]


def wait_page(page, marker: str, url: str) -> None:
    for attempt in range(3):
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.get_by_role("tab", name=marker, exact=True).wait_for(timeout=15_000)
            break
        except Exception as error:
            if attempt == 2:
                raise RuntimeError("独立 Chrome 未能访问 UPW 后台；原始数据未改动") from error
            print("独立 Chrome 尚未进入 UPW 后台。请在该窗口完成网站或网络认证，完成后回到这里按 Enter 重试；不要在聊天中发送密码。", flush=True)
            input()
    page.get_by_text(re.compile(r"^共\s*[\d,]+\s*条$")).last.wait_for(timeout=30_000)


def result_count(page) -> int:
    text = page.get_by_text(re.compile(r"^共\s*[\d,]+\s*条$")).last.inner_text()
    match = re.search(r"共\s*([\d,]+)\s*条", text)
    if not match:
        raise ValueError("无法识别页面结果条数")
    return int(match.group(1).replace(",", ""))


def wait_count_change(page, previous: int) -> int:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        current = result_count(page)
        if current != previous:
            return current
        page.wait_for_timeout(350)
    raise RuntimeError("查询后结果条数一直未变化，无法确认筛选生效")


def export_segment(page, total: int, index: int, target: Path) -> int:
    if total < 1:
        raise ValueError("不能导出空结果")
    count = min(SEGMENT, total - index * SEGMENT)
    if count <= 0:
        raise ValueError("导出分段越界")
    page.get_by_role("button", name="导出", exact=True).last.click()
    dialog = page.locator(".el-dialog:visible").filter(has=page.get_by_role("heading", name="选择导出页码"))
    dialog.wait_for(timeout=15_000)
    heading = dialog.inner_text()
    if f"共 {total} 条数据" not in heading or f"分为 {(total + SEGMENT - 1) // SEGMENT} 个分段导出" not in heading:
        raise ValueError("后台导出数量与查询结果不一致")
    label = f"{index * SEGMENT + 1}-{min((index + 1) * SEGMENT, total)}"
    if index:
        dialog.get_by_role("combobox").click()
        page.get_by_text(label, exact=True).last.click()
    if label not in dialog.inner_text():
        raise ValueError(f"未选中导出范围 {label}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with page.expect_download(timeout=240_000) as event:
        dialog.get_by_role("button", name="确认").click()
    download = event.value
    if not download.suggested_filename.lower().endswith(".csv"):
        raise ValueError(f"后台导出格式已变化：{download.suggested_filename}")
    download.save_as(target)
    if download.failure():
        raise RuntimeError(f"下载失败：{download.failure()}")
    return count


def get_cards(page, batch: Path) -> tuple[Path, int]:
    wait_page(page, "用户卡片", CARDS_URL)
    card_tab = page.get_by_role("tab", name="用户卡片", exact=True)
    card_tab.click()
    status = page.get_by_role("combobox", name="卡状态:")
    status.click()
    page.get_by_text("申请成功", exact=True).last.click()
    previous = result_count(page)
    page.get_by_role("button", name="查询", exact=True).last.click()
    count = wait_count_change(page, previous)
    if count == 0 or count > SEGMENT:
        raise ValueError(f"申请成功卡片 {count} 条，超出当前单段导出方案；未替换旧表")
    target = batch / "cards.csv"
    export_segment(page, count, 0, target)
    validate_cards(target, count)
    print(f"成功卡片：{count} 条", flush=True)
    return target, count


def get_transactions(page, batch: Path, day: date) -> list[Path]:
    wait_page(page, "交易记录", TRANSACTIONS_URL)
    page.get_by_role("tab", name="交易记录", exact=True).click()
    page.get_by_role("combobox", name="状态:").click()
    page.get_by_text("已完成", exact=True).last.click()
    bounds = page.get_by_role("group", name="交易提交时间:").locator("input.el-range-input")
    bounds.first.fill(f"{day} 00:00:00")
    bounds.last.fill(f"{day} 23:59:59")
    bounds.last.press("Enter")
    if bounds.first.input_value() != f"{day} 00:00:00" or bounds.last.input_value() != f"{day} 23:59:59":
        raise ValueError("交易提交时间条件未生效")
    previous = result_count(page)
    page.get_by_role("button", name="查询", exact=True).last.click()
    count = wait_count_change(page, previous)
    parts: list[Path] = []
    for index in range((count + SEGMENT - 1) // SEGMENT):
        target = batch / f"transactions-{day}-part{index + 1:02d}.csv"
        expected = export_segment(page, count, index, target)
        validate_transactions(target, day, expected)
        parts.append(target)
    if count and sum(len(table(path)) for path in parts) != count:
        raise ValueError(f"{day} 交易分段合计与页面不一致")
    print(f"{day} 已完成交易：{count} 条，{len(parts)} 段", flush=True)
    return parts


def get_relationship_updates(page, batch: Path, data: Path, cutoff: date) -> tuple[Path, int]:
    known, known_max = current_relationships(data)
    wait_page(page, "用户代理关系", RELATIONSHIPS_URL)
    total = result_count(page)
    if total < len(known):
        raise ValueError("后台关系总数少于本地已有 UID 数；停止增量更新")
    collected: dict[str, dict[str, str]] = {}
    prior_oldest = None
    for index in range((total + SEGMENT - 1) // SEGMENT):
        target = batch / f"relationships-part{index + 1:02d}.csv"
        expected = export_segment(page, total, index, target)
        frame = validate_relationships(target, expected)
        parsed = dates(frame, "注册时间")
        newest, oldest = parsed.iloc[0], parsed.iloc[-1]
        if prior_oldest is not None and newest > prior_oldest:
            raise ValueError("代理关系分段发生排序交错，不能保证没有漏行")
        prior_oldest = oldest
        for row in frame.loc[:, list(RELATIONSHIP_FIELDS)].to_dict("records"):
            uid = str(row["用户UID"]).strip()
            collected[uid] = {key: str(row[key]).strip() for key in RELATIONSHIP_FIELDS}
        if oldest <= known_max and any(uid in known for uid in frame["用户UID"].astype(str)):
            break
    else:
        raise ValueError("关系导出未能与历史数据重叠，停止更新以防漏人")
    if len(collected) < total - len(known):
        raise ValueError("已下载关系条数不足以覆盖后台新增数量")
    updates = data / "代理关系增量.jsonl"
    original: dict[str, dict[str, str]] = {}
    if updates.exists():
        with updates.open(encoding="utf-8") as stream:
            for line in stream:
                if line.strip():
                    row = json.loads(line)
                    original[str(row["用户UID"]).strip()] = row
    changed = 0
    for uid, row in collected.items():
        registered = pd.to_datetime(row["注册时间"], errors="coerce")
        if pd.isna(registered) or registered.date() > cutoff:
            continue
        if known.get(uid) != row:
            original[uid] = row
            changed += 1
    target = batch / "代理关系增量.jsonl"
    with target.open("w", encoding="utf-8") as stream:
        for uid in sorted(original):
            stream.write(json.dumps(original[uid], ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"代理关系：核验 {len(collected)} 条，新增或变更 {changed} 条（截至 {cutoff}）", flush=True)
    return target, changed


def publish(batch: Path, data: Path, state: Path, cards: Path, relations: Path,
            transactions: dict[date, list[Path]], coverage: Path | None = None) -> None:
    """Install only after every export has passed checks; keep recoverable originals."""
    backup = state / "backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True, exist_ok=False)
    old_cards = [path for path in data.iterdir() if "用户卡片" in path.name and path.suffix.lower() in {".csv", ".xlsx"}]
    if len(old_cards) != 1:
        raise ValueError("用户卡片旧快照必须恰好有一份；未改动原始数据")
    old_rel = data / "代理关系增量.jsonl"
    new_cards = data / "金融卡三方 - 用户卡片最新.csv"
    installed: list[Path] = []
    removed: list[tuple[Path, Path]] = []
    try:
        for old in [*old_cards, *([old_rel] if old_rel.exists() else [])]:
            saved = backup / old.name
            os.replace(old, saved)
            removed.append((old, saved))
        os.replace(cards, new_cards)
        installed.append(new_cards)
        os.replace(relations, old_rel)
        installed.append(old_rel)
        for day, parts in transactions.items():
            for index, path in enumerate(parts, 1):
                destination = data / f"三方金融卡-交易记录-{day}-part{index:02d}.csv"
                if destination.exists():
                    raise ValueError(f"目标已存在：{destination.name}，未覆盖")
                os.replace(path, destination)
                installed.append(destination)
        if coverage is not None:
            install_coverage(coverage.read_text(encoding="utf-8"), coverage_targets(), backup)
    except BaseException:
        for path in reversed(installed):
            if path.exists():
                os.replace(path, batch / path.name)
        for original, saved in removed:
            if saved.exists():
                os.replace(saved, original)
        raise
    print(f"已安装原始数据{'并同步日期清单' if coverage is not None else ''}；旧快照备份：{backup}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--end-date", type=date.fromisoformat)
    parser.add_argument("--yes", action="store_true", help="超过 7 天时确认批量导出")
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-independent-browser", action="store_true", help="仅后台允许独立浏览器时使用")
    args = parser.parse_args()
    if bool(args.start_date) != bool(args.end_date):
        parser.error("--start-date 和 --end-date 必须一起填写")
    data = args.data_dir.resolve(strict=True)
    yesterday = datetime.now(ZoneInfo("Asia/Shanghai")).date() - timedelta(days=1)
    coverage = covered_transaction_days(data)
    first = args.start_date or min(coverage)
    last = args.end_date or yesterday
    if last > yesterday:
        parser.error(f"不能下载尚未结束的日期；后台口径按 UTC+8，昨天为 {yesterday}")
    requested_days = [first + timedelta(days=offset) for offset in range(max(0, (last - first).days + 1))]
    days = requested_days if args.start_date else [day for day in requested_days if day not in coverage]
    print(f"UPW 后台日期口径 UTC+8；交易待补齐：{len(days)} 天（检查范围 {first} 至 {last}）。")
    print("卡片成功快照和代理关系增量每次都会刷新；程序不会更新网站。")
    if args.dry_run:
        return 0
    if not args.allow_independent_browser:
        parser.error("UPW 当前只允许现有 Chrome 会话；请通过现有浏览器导出，再运行 import_exports.py 校验导入。独立浏览器下载已禁用。")
    if len(days) > 7 and not args.yes:
        if not sys.stdin.isatty() or input("超过 7 天。确认创建多个导出任务请输入“继续”：").strip() != "继续":
            print("已取消，原始数据未改动。")
            return 0
    from playwright.sync_api import sync_playwright
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "download.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        batch = STATE / "batches" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        batch.mkdir(parents=True)
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(STATE / "browser"), channel="chrome", headless=False,
                accept_downloads=True, timezone_id="Asia/Shanghai",
            )
            page = context.new_page()
            page.set_default_timeout(25_000)
            try:
                cards, _ = get_cards(page, batch)
                relations, _ = get_relationship_updates(page, batch, data, yesterday)
                transactions = {day: get_transactions(page, batch, day) for day in days}
                with (ROOT / "tools/daily-operations/.staging.lock").open("a") as update_lock:
                    fcntl.flock(update_lock, fcntl.LOCK_EX)
                    publish(batch, data, STATE, cards, relations, transactions)
            finally:
                context.close()
    print("UPW 下载完成。请先运行 UPW-测试更新并核对，再考虑正式发布。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError) as error:
        print(f"UPW 下载未完成：{error}", file=sys.stderr)
        raise SystemExit(1) from error
