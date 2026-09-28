#!/bin/zsh
OPS_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PLATFORM="${1:-}"
shift
exec zsh "$OPS_DIR/run_pipeline.command" "$PLATFORM" production "$@"
