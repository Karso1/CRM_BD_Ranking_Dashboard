#!/bin/zsh
cd "$(dirname "$0")" || exit 1

python3 build_business_history.py
exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo ""
  echo "UPB 计算失败，未同步网站。请把上面的错误截图发给我。"
  read -k 1 "?按任意键关闭..."
  exit $exit_code
fi

python3 sync_business_dashboard.py
exit_code=$?
echo ""
if [ $exit_code -eq 0 ]; then
  echo "全部完成。网站已经可以读取最新 UP Business 数据。"
else
  echo "本地计算已完成，但同步失败。请把上面的错误截图发给我。"
fi
read -k 1 "?按任意键关闭..."
exit $exit_code
