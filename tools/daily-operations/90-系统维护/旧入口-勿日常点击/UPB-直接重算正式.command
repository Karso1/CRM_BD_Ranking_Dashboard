#!/bin/zsh
cd "$(dirname "$0")/.." || exit 1
./run_pipeline.command upb production
