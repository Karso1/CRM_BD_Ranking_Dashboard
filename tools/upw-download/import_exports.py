#!/usr/bin/env python3
"""Validate UPW exports made in the already signed-in Chrome, then install them.

The input manifest records the counts shown by the backend. This program does
not open a browser, access credentials, or publish either dashboard.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime
import fcntl
import json
from pathlib import Path
import shutil
import sys

import download as core


def _source(item: dict, key: str = "path") -> Path:
    source = Path(item[key]).expanduser().resolve(strict=True)
    if source.suffix.lower() != ".csv":
        raise ValueError(f"只接受后台原始 CSV：{source.name}")
    return source


def _count(item: dict) -> int:
    value = item.get("count")
    if type(value) is not int or value < 0:
        raise ValueError("清单中的页面条数必须是非负整数")
    return value


def prepare(manifest: dict, data: Path, batch: Path) -> tuple[Path, Path, dict[date, list[Path]], dict[str, int]]:
    as_of = date.fromisoformat(manifest["as_of"])
    if as_of > datetime.now(core.ZoneInfo("Asia/Shanghai")).date() - core.timedelta(days=1):
        raise ValueError("截止日期不能晚于 UPW 后台 UTC+8 的昨天")
    card = manifest["cards"]
    cards = batch / "cards.csv"
    shutil.copy2(_source(card), cards)
    card_count = _count(card)
    core.validate_cards(cards, card_count)

    relation = manifest["relationships"]
    total = _count({"count": relation.get("total")})
    if total == 0:
        raise ValueError("代理关系总条数不能为零")
    known, known_max = core.current_relationships(data)
    if total < len(known):
        raise ValueError(f"后台代理关系总数 {total} 少于本地 UID 数 {len(known)}，可能残留了筛选条件；请重置代理关系筛选后重新导出，拒绝导入")
    segments = relation.get("segments", [])
    if not segments:
        raise ValueError("缺少代理关系导出分段")
    collected: dict[str, dict[str, str]] = {}
    prior_oldest = None
    overlap = False
    for index, item in enumerate(segments):
        path = _source(item)
        expected = min(core.SEGMENT, total - index * core.SEGMENT)
        if expected <= 0 or _count(item) != expected:
            raise ValueError("代理关系分段行数与后台总数不符")
        frame = core.validate_relationships(path, expected)
        parsed = core.dates(frame, "注册时间")
        if prior_oldest is not None and parsed.iloc[0] > prior_oldest:
            raise ValueError("代理关系分段时间顺序异常")
        prior_oldest = parsed.iloc[-1]
        for row in frame.loc[:, list(core.RELATIONSHIP_FIELDS)].to_dict("records"):
            uid = str(row["用户UID"]).strip()
            record = {key: str(row[key]).strip() for key in core.RELATIONSHIP_FIELDS}
            if uid in collected and collected[uid] != record:
                raise ValueError("代理关系分段存在冲突 UID")
            collected[uid] = record
        if prior_oldest <= known_max and any(uid in known for uid in frame["用户UID"].astype(str)):
            overlap = True
            break
    if not overlap or len(collected) < total - len(known):
        raise ValueError("代理关系导出未完整覆盖新记录并与历史数据重叠")
    updates = data / "代理关系增量.jsonl"
    overlay: dict[str, dict[str, str]] = {}
    if updates.exists():
        with updates.open(encoding="utf-8") as stream:
            for line in stream:
                if line.strip():
                    row = json.loads(line)
                    overlay[str(row["用户UID"]).strip()] = row
    changed = 0
    for uid, row in collected.items():
        registered = core.dates(core.pd.DataFrame([row]), "注册时间").iloc[0]
        if core.pd.isna(registered) or registered.date() > as_of:
            continue
        if known.get(uid) != row:
            overlay[uid] = row
            changed += 1
    relations = batch / "代理关系增量.jsonl"
    with relations.open("w", encoding="utf-8") as stream:
        for uid in sorted(overlay):
            stream.write(json.dumps(overlay[uid], ensure_ascii=False, separators=(",", ":")) + "\n")

    covered = core.covered_transaction_days(data)
    first = min(covered)
    required = {first + core.timedelta(days=offset) for offset in range((as_of - first).days + 1)} - covered
    entries = manifest.get("transactions", [])
    supplied: dict[date, list[Path]] = {}
    counts: dict[date, int] = {}
    for entry in entries:
        day = date.fromisoformat(entry["date"])
        if day in supplied or day not in required:
            raise ValueError(f"交易日期重复或已导入：{day}")
        count = _count(entry)
        parts = entry.get("segments", [])
        if count == 0 or len(parts) != (count + core.SEGMENT - 1) // core.SEGMENT:
            raise ValueError(f"{day} 的交易分段数与后台条数不符")
        saved = []
        for index, item in enumerate(parts):
            expected = min(core.SEGMENT, count - index * core.SEGMENT)
            if _count(item) != expected:
                raise ValueError(f"{day} 第 {index + 1} 段条数错误")
            target = batch / f"transactions-{day}-part{index + 1:02d}.csv"
            shutil.copy2(_source(item), target)
            core.validate_transactions(target, day, expected)
            saved.append(target)
        supplied[day] = saved
        counts[day] = count
    if set(supplied) != required:
        missing = ", ".join(map(str, sorted(required - set(supplied))[:8]))
        raise ValueError(f"尚有未覆盖的交易日期：{missing}")
    # Reuse dates already checked above. Do not rescan all historical workbooks
    # after announcing success: the process may be closed before indexes update.
    (batch / "coverage.json").write_text(core.coverage_content(covered | set(supplied)), encoding="utf-8")
    return cards, relations, supplied, {"cards": card_count, "relation_updates": changed, "transactions": sum(counts.values()), "days": len(counts)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="已登录浏览器导出文件及页面条数清单 JSON")
    parser.add_argument("--data-dir", type=Path, default=core.DATA)
    parser.add_argument("--install", action="store_true", help="全部校验后备份并安装至原始数据目录")
    args = parser.parse_args()
    data = args.data_dir.resolve(strict=True)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    core.os.umask(0o077)
    core.STATE.mkdir(parents=True, exist_ok=True)
    with (core.STATE / "download.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        batch = core.STATE / "batches" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        batch.mkdir(parents=True)
        cards, relations, transactions, counts = prepare(manifest, data, batch)
        print("校验通过：" + json.dumps(counts, ensure_ascii=False))
        if args.install:
            print("正在安装原始数据并同步日期清单，请等待完成提示……", flush=True)
            with (core.ROOT / "tools/daily-operations/.staging.lock").open("a") as update_lock:
                fcntl.flock(update_lock, fcntl.LOCK_EX)
                core.publish(batch, data, core.STATE, cards, relations, transactions, batch / "coverage.json")
            print("导入完成：原始数据和日期清单均已更新；网站没有更新。", flush=True)
        else:
            print("仅校验，原始数据未更新。确认后加 --install。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        print(f"UPW 导入未完成：{error}", file=sys.stderr)
        raise SystemExit(1) from error
