#!/bin/zsh
OPS_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
exec zsh "$OPS_DIR/90-系统维护/run_pipeline.command" upb production --mode verify
