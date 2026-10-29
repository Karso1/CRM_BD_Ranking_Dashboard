#!/bin/zsh
set -eu
task_dir="$(cd "$(dirname "$0")/../../upb-download" && pwd)"
if [[ ! -x "$task_dir/.venv/bin/python" ]]; then
  python3 -m venv "$task_dir/.venv"
fi
if ! "$task_dir/.venv/bin/python" -c 'import playwright, openpyxl' >/dev/null 2>&1; then
  "$task_dir/.venv/bin/python" -m pip install -r "$task_dir/requirements.txt"
fi
echo 'UPB 数据下载（后台日期为 UTC+0）'
echo '每次运行还会更新成功状态的手动开卡全量表，并备份旧表。'
echo '1. 自动补齐漏掉的日期（默认；已完成的日期会跳过）'
echo '2. 只下载指定一天'
echo '3. 下载指定日期范围'
echo '4. 退出'
read -r 'choice?请选择 [1]：'
choice="${choice:-1}"
args=()
case "$choice" in
  1) ;;
  2)
    read -r 'selected_day?请输入日期（YYYY-MM-DD）：'
    args=(--date "$selected_day")
    ;;
  3)
    read -r 'first_day?开始日期（YYYY-MM-DD）：'
    read -r 'last_day?结束日期（YYYY-MM-DD）：'
    args=(--start-date "$first_day" --end-date "$last_day")
    ;;
  4) exit 0 ;;
  *) echo '无效选项，未下载。'; read -r '?按 Enter 关闭窗口…'; exit 1 ;;
esac
if "$task_dir/.venv/bin/python" "$task_dir/download.py" "${args[@]}"; then
  echo "下载完成。"
else
  echo "下载未完成，请看上方错误信息。"
fi
read -r '?按 Enter 关闭窗口…'
