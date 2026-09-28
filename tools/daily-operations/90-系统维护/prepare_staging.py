#!/usr/bin/env python3
"""Refresh a local staging input snapshot after explicit public-data consent."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


FORMAL_DATA_LINKS = "03-原始数据"


def mirror_directory(source: Path, destination: Path, workspace: Path) -> None:
    source = source.resolve(strict=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    destination.relative_to(workspace.resolve(strict=True))
    if destination.is_symlink() or not source.is_dir():
        raise RuntimeError(f"输入目录无效：{source}")
    if shutil.which("rsync") is None:
        raise RuntimeError("找不到 rsync；为避免使用过期输入，未继续 staging 计算。")
    destination.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["rsync", "--archive", "--delete", f"{source}/", f"{destination}/"],
        check=True,
    )


def mirror_file(source: Path, destination: Path, workspace: Path) -> None:
    source = source.resolve(strict=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    destination.relative_to(workspace.resolve(strict=True))
    if destination.is_symlink() or not source.is_file():
        raise RuntimeError(f"映射/目标文件无效：{source}")
    shutil.copy2(source, destination)


def prepare(platform: str, confirm_public_real_data: bool = False) -> None:
    if platform not in {"upw", "upb"}:
        raise ValueError("平台必须为 upw 或 upb。")
    if not confirm_public_real_data:
        raise RuntimeError(
            "测试网站是公开访问的。真实业务汇总数据可能被任何拿到网址的人看到；"
            "确认后请使用 --confirm-public-real-data。"
        )

    script = Path(__file__).resolve()
    workspace = script.parents[3]
    operations = script.parents[1]
    data_root = operations / FORMAL_DATA_LINKS

    if platform == "upw":
        formal = data_root / "UPW每日数据"
        pipeline = workspace / "tools" / "upw-daily-pipeline"
        mirror_directory(formal / "total data", pipeline / "staging-inputs" / "total data", workspace)
        mirror_file(
            formal / "total data" / "代理关系及月份目标.xlsx",
            pipeline / "staging-inputs" / "代理关系及月份目标.xlsx",
            workspace,
        )
    else:
        formal = data_root / "UPB每日数据"
        pipeline = workspace / "tools" / "upb-daily-pipeline"
        for folder in ("开卡", "手动开卡", "充值数据", "消费数据", "BD代理关系目标"):
            mirror_directory(formal / folder, pipeline / "staging-inputs" / folder, workspace)
        mirror_file(
            formal / "upb-daily-pipeline" / "cache" / "fred_usd_hkd_daily.csv",
            pipeline / "cache" / "staging" / "fred_usd_hkd_daily.csv",
            workspace,
        )

    print(
        f"{platform.upper()} 测试输入副本已从原始数据目录刷新。"
        "上传仍会由同步程序校验目标必须标记为 staging。"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh local staging inputs before an explicitly authorized public staging sync.")
    parser.add_argument("--platform", choices=("upw", "upb"), required=True)
    parser.add_argument(
        "--confirm-public-real-data",
        action="store_true",
        help="Acknowledge that aggregated real business data will be visible on the public staging site.",
    )
    args = parser.parse_args()
    try:
        prepare(args.platform, args.confirm_public_real_data)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Staging 安全准备失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
