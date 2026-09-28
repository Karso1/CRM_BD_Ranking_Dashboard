#!/bin/zsh

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
UPW_SETTINGS="./tools/upw-daily-pipeline/sync.staging.local.json"
UPB_SETTINGS="./tools/upb-daily-pipeline/sync.staging.local.json"

if [[ ! -f "$UPW_SETTINGS" || ! -f "$UPB_SETTINGS" ]]; then
  echo "缺少 staging 同步设置。请分别复制 UPW/UPB 的 sync-config.staging.example.json 为 sync.staging.local.json，并填入测试端点与测试密钥。"
  read "?按 Enter 键关闭..."
  exit 1
fi

python3 ./tools/upw-daily-pipeline/sync_wallet_dashboard.py --csv ./tools/staging-fixtures/wallet_daily_metrics.csv --targets ./tools/staging-fixtures/wallet_monthly_targets.csv --settings "$UPW_SETTINGS" --expected-environment staging --dashboard-url "https://upay-bd-ranking-staging.karsol.workers.dev/api/dashboard?platform=wallet&refresh=1" || exit 1
python3 ./tools/upb-daily-pipeline/sync_business_dashboard.py --daily ./tools/staging-fixtures/business_daily_metrics.csv --targets ./tools/staging-fixtures/business_monthly_targets.csv --settings "$UPB_SETTINGS" --expected-environment staging --dashboard-url "https://upay-bd-ranking-staging.karsol.workers.dev/api/dashboard?platform=business&refresh=1" || exit 1
echo "已将虚构演示数据写入测试表并刷新测试网站。正式环境没有被触碰。"
read "?按 Enter 键关闭..."
