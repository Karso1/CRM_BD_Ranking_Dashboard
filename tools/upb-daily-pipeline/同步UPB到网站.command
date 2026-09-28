#!/bin/zsh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
exec zsh "$SCRIPT_DIR/../daily-operations/90-系统维护/run_pipeline.command" upb production "$@"
