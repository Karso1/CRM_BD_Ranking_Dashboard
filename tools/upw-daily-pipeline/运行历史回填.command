#!/bin/zsh

cd "$(dirname "$0")" || exit 1
echo "UPay Wallet 历史数据回填"
echo "将读取 ../total data 中的所有交易记录，以及同目录下的关系表和用户卡片表。"
echo ""

python3 backfill_wallet_history.py --input-dir ../total\ data --output-dir ./outputs/history
result_code=$?

echo ""
if [ $result_code -eq 0 ]; then
  echo "完成。请先核对 outputs/history/wallet_daily_metrics.csv。"
else
  echo "处理未完成，请保留当前窗口并把报错截图发给我。"
fi
read "?按 Enter 键关闭窗口..."
exit $result_code
