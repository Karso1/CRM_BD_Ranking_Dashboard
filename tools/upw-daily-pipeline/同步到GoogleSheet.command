#!/bin/zsh

cd "$(dirname "$0")" || exit 1
python3 backfill_wallet_history.py --input-dir ../total\ data --output-dir ./outputs/history || exit 1
python3 sync_wallet_dashboard.py
status=$?
echo ""
if [ $status -eq 0 ]; then
  echo "完成：Google Sheet 与网站数据源将在刷新后读取最新 Wallet 数据。"
else
  echo "未同步；请保留本窗口并把报错截图发给我。"
fi
read "?按 Enter 键关闭窗口..."
exit $status

