#!/usr/bin/env python3
"""One local execution path for both platforms and deployment environments."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, ExitStack
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from prepare_staging import prepare
from agent_profiles import export_profiles

WORKSPACE = Path(__file__).resolve().parents[3]
OPERATIONS = WORKSPACE / "tools" / "daily-operations"
SYSTEM_FILES = OPERATIONS / "90-系统维护"


def code_version(platform: str) -> str:
    sources = sorted((WORKSPACE / "tools" / f"{platform}-daily-pipeline").glob("*.py"))
    sources += sorted(SYSTEM_FILES.glob("*.py"))
    if platform == "upw":
        sources.append(WORKSPACE / "tools/upw-daily-pipeline/config.json")
    digest = hashlib.sha256()
    for path in sources:
        digest.update(str(path.relative_to(WORKSPACE)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def output_hashes(output: Path) -> dict:
    return {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
        for pattern in ("*_daily_metrics.csv", "*_monthly_targets.csv", "agent_profiles.json") for file in output.glob(pattern)}


def validated_staging(platform: str) -> dict:
    staging = plan(platform, "staging")
    receipt = json.loads((staging["output"] / "last_success.json").read_text(encoding="utf-8"))
    if receipt.get("environment") != "staging" or receipt.get("mode") != "run" or receipt.get("status") != "verified":
        raise ValueError("测试环境尚无完整运行并验收通过的批次，请先运行测试程序。")
    if receipt.get("code_version") != code_version(platform):
        raise ValueError("计算/同步代码已变化，请重新运行测试程序后再发布。")
    hashes = output_hashes(staging["output"])
    if len(hashes) < 2 or hashes != receipt.get("outputs"):
        raise ValueError("测试输出在验收后发生变化，请重新运行测试程序。")
    return staging


def plan(platform: str, environment: str, workspace: Path = WORKSPACE) -> dict:
    if platform not in {"upw", "upb"} or environment not in {"production", "staging"}:
        raise ValueError("必须明确指定 UPW/UPB 和 production/staging。")
    code = workspace / "tools" / f"{platform}-daily-pipeline"
    formal = (workspace / "tools/daily-operations/03-原始数据" / f"{platform.upper()}每日数据").resolve()
    production = formal / f"{platform}-daily-pipeline"
    staging = environment == "staging"
    inputs = code / "staging-inputs" if staging else formal
    output = code / "outputs/staging" if staging else production / "outputs/history"
    settings = code / "sync.staging.local.json" if staging else production / "sync.local.json"
    field = "wallet" if platform == "upw" else "business"
    host = "upay-bd-ranking-staging" if staging else "upay-bd-ranking"
    python = [sys.executable, "-u", "-W", "ignore:Workbook contains no default style:UserWarning:openpyxl.styles.stylesheet"]
    if platform == "upw":
        mapping = inputs / "代理关系及月份目标.xlsx" if staging else inputs / "total data/代理关系及月份目标.xlsx"
        calculate = python + [str(code / "backfill_wallet_history.py"), "--input-dir", str(inputs / "total data"),
            "--mapping-workbook", str(mapping), "--config", str(code / "config.json"), "--output-dir", str(output)]
        sync = python + [str(code / "sync_wallet_dashboard.py"), "--csv", str(output / "wallet_daily_metrics.csv")]
    else:
        mapping = inputs / "BD代理关系目标/BD代理关系.xlsx"
        cache = code / "cache/staging/fred_usd_hkd_daily.csv" if staging else production / "cache/fred_usd_hkd_daily.csv"
        calculate = python + [str(code / "build_business_history.py"), "--input-dir", str(inputs),
            "--config", str(inputs / "BD代理关系目标/BD代理关系.xlsx"), "--output-dir", str(output), "--fx-cache", str(cache)]
        sync = python + [str(code / "sync_business_dashboard.py"), "--daily", str(output / "business_daily_metrics.csv")]
    sync += ["--targets", str(output / f"{field}_monthly_targets.csv"), "--settings", str(settings),
        "--expected-environment", environment, "--dashboard-url", f"https://{host}.karsol.workers.dev/api/dashboard?platform={field}&refresh=1"]
    return {"calculate": calculate, "sync": sync, "settings": settings, "output": output, "formal": formal, "mapping": mapping}


@contextmanager
def environment_lock(environment: str, operations: Path = OPERATIONS):
    # Both platforms write to the same Apps Script project. Serialize per
    # environment; flock is released by the OS even after a terminal crashes.
    with (operations / f".{environment}.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(f"{environment} 已有同步任务运行，请等该任务结束。") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def execute(command: list[str], label: str, log) -> None:
    started = time.monotonic()
    message = f"\n{label}…"
    print(message, flush=True)
    log.write(message + "\n")
    with subprocess.Popen(command, cwd=WORKSPACE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as child:
        try:
            for line in child.stdout:
                print(line, end="", flush=True)
                log.write(line)
                log.flush()
            result = child.wait()
        except BaseException:
            child.terminate()
            child.wait()
            raise
    if result:
        raise RuntimeError(f"{label}未完成（退出码 {result}）。请按日志中的失败阶段处理。")
    message = f"{label}完成，用时 {time.monotonic() - started:.1f} 秒。"
    print(message, flush=True)
    log.write(message + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("upw", "upb"))
    parser.add_argument("environment", choices=("staging", "production"))
    parser.add_argument("--mode", choices=("run", "verify", "calculate", "promote"), default="run")
    parser.add_argument("--dry-run", action="store_true", help="仅检查路径和计划，不计算、不访问网络、不上传。")
    args = parser.parse_args()
    if args.mode == "promote" and args.environment != "production":
        parser.error("发布测试结果只能选择 production。")
    execution = plan(args.platform, args.environment)
    if args.dry_run:
        print(json.dumps(execution, ensure_ascii=False, indent=2, default=str))
        return 0
    os.umask(0o077)
    logs = OPERATIONS / "04-出错时再看" / "运行记录"
    logs.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = logs / f"{stamp}-{args.platform}-{args.environment}"
    summary = {"platform": args.platform, "environment": args.environment, "mode": args.mode,
        "started_at": datetime.now().astimezone().isoformat(), "status": "running", "code_version": code_version(args.platform)}
    started = time.monotonic()
    try:
        with ExitStack() as stack:
            stack.enter_context(environment_lock(args.environment))
            if args.mode == "promote":
                stack.enter_context(environment_lock("staging"))
            log = stack.enter_context(path.with_suffix(".log").open("w", encoding="utf-8"))
            print(f"平台：{args.platform.upper()} | 环境：{args.environment} | 操作：{args.mode}\n日志：{path.with_suffix('.log')}", flush=True)
            if args.mode != "calculate" and not execution["settings"].is_file():
                raise RuntimeError(f"缺少同步配置：{execution['settings']}")
            staged = validated_staging(args.platform) if args.mode == "promote" else None
            if args.mode in {"run", "calculate"}:
                if args.environment == "staging":
                    # Owner has authorized public staging with real aggregate data.
                    print("[1/3] 更新测试输入副本…", flush=True)
                    prepare(args.platform, confirm_public_real_data=True)
                execute(execution["calculate"], "[2/3] 计算数据", log)
                export_profiles(execution["mapping"], args.platform, execution["output"])
            if summary["code_version"] != code_version(args.platform):
                raise RuntimeError("运行期间代码发生变化，请重新运行测试程序。")
            if staged:
                # Keep the exact attempted data locally so verify-only can
                # recover an uncertain response without sending another POST.
                execution["output"].mkdir(parents=True, exist_ok=True)
                backup = execution["output"].parent / "published-backups" / stamp
                backup.mkdir(parents=True)
                for previous in execution["output"].iterdir():
                    if previous.is_file() and previous.suffix in {".csv", ".json"}:
                        shutil.copy2(previous, backup / previous.name)
                for source in staged["output"].iterdir():
                    if source.is_file() and source.suffix in {".csv", ".json"} and source.name not in {"last_success.json", "pending_sync.json"}:
                        shutil.copy2(source, execution["output"] / source.name)
            if args.mode != "calculate":
                if args.mode in {"run", "promote"}:
                    summary["outputs"] = output_hashes(execution["output"])
                    (execution["output"] / "pending_sync.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
                command = execution["sync"] + (["--verify-only"] if args.mode == "verify" else [])
                execute(command, "[3/3] 核验云端和网站" if args.mode == "verify" else "[3/3] 同步并核验云端和网站", log)
            if summary["code_version"] != code_version(args.platform):
                raise RuntimeError("运行期间代码发生变化，验收记录未发布；请重新运行测试程序。")
            summary["status"] = "calculated" if args.mode == "calculate" else "verified"
            summary["outputs"] = output_hashes(execution["output"])
            if args.mode in {"run", "promote"}:
                (execution["output"] / "last_success.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            elif args.mode == "verify":
                pending_path = execution["output"] / "pending_sync.json"
                if pending_path.is_file():
                    pending = json.loads(pending_path.read_text(encoding="utf-8"))
                    if (pending.get("environment") == args.environment and pending.get("code_version") == summary["code_version"]
                            and pending.get("outputs") == summary["outputs"] and pending.get("mode") in {"run", "promote"}):
                        pending.update(status="verified", recovered_at=datetime.now().astimezone().isoformat())
                        (execution["output"] / "last_success.json").write_text(json.dumps(pending, ensure_ascii=False, indent=2), encoding="utf-8")
            print("完成：本地计算已完成，尚未上传。" if args.mode == "calculate" else "完成：云端和网站数据均已通过验收。", flush=True)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        summary.update(status="failed", error=str(error) or "用户中断")
        print(f"未完成：{summary['error']}\n日志：{path.with_suffix('.log')}", file=sys.stderr)
        return 1
    finally:
        summary["duration_seconds"] = round(time.monotonic() - started, 1)
        path.with_suffix(".json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
