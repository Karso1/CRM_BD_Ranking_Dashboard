#!/usr/bin/env python3
"""Write a browser-readable summary of dates already present in local UPW data."""
from __future__ import annotations

import argparse
from pathlib import Path

import download as core

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=core.DATA)
    parser.add_argument("--output", type=Path, help="只写指定文件；默认同时刷新项目与现有桌面清单")
    args = parser.parse_args()
    print(core.write_coverage(args.data_dir.resolve(strict=True), args.output))
