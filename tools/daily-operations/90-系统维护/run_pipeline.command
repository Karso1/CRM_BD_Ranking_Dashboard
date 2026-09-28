#!/bin/zsh
OPS_DIR="$(cd "$(dirname "$0")" && pwd -P)"
python3 -u "$OPS_DIR/pipeline.py" "$@"
RESULT=$?
if [[ -t 0 ]]; then
  read "?按 Enter 键关闭窗口..."
fi
exit $RESULT
