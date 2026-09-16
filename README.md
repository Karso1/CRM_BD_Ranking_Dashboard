# UPay Performance Dashboard

UP Business 与 UPay Wallet 的月度业绩排名看板。支持平台切换，并可按月份、日期、BD、排名指标和名称筛选。

## 看板功能

- UP Business：总体、代理商、API 三个排名页签
- UPay Wallet：总体与代理商排名页签
- 2026 年 1 月至 9 月的月份切换
- 选择 BD 后，仅显示该 BD 关联的代理商和 API
- BD 月目标、累计充值、当日充值、开卡数与完成率
- 代理商/API 的累计充值、累计消费、当日充值与开卡数
- 导出当前页面用于日报

## 数据从哪里来

当前看板使用两份月度数据生成：

- `UB每日数据.xlsx`：UP Business 的充值、消费、开卡及 BD 目标数据
- `UW每日数据.xlsx`：UPay Wallet 的消费、开卡及 BD 目标数据

原始 Excel、UID、卡号和 Google Sheet 凭据不会提交到仓库。网页读取的是已整理的 `app/dashboard-data.json` 和 `app/wallet-data.json`。

## 更新数据

当你拿到更新后的数据表后，在项目根目录运行：

```bash
python3 scripts/import_ub_excel.py "/完整路径/UB每日数据.xlsx" app/dashboard-data.json
python3 scripts/import_uw_excel.py "/完整路径/UW每日数据.xlsx" app/wallet-data.json
npm run build
git add app/dashboard-data.json app/wallet-data.json
git commit -m "更新月度看板数据"
git push
```

目前这是“导入后发布”的方式。后续可接入 Google Sheets：每天将月度汇总结果记录为快照，网站读取专用汇总表后即可自动更新并支持按日期回看。

## 本地运行

需要 Node.js 22 或更新版本，以及 Python 3（用于导入 Excel）。

```bash
npm install
npm run dev
```

终端会显示本地访问地址，通常是 `http://localhost:4173`。

## 发布

```bash
npm run build
```

当前版本已部署为私有预览。若要让团队成员直接访问，可以将部署平台的访问权限改为公开，或后续绑定自己的域名。

## 项目文件说明

- `app/page.tsx`：看板页面、筛选与排名逻辑
- `app/dashboard-data.json`：UP Business 的已整理数据
- `app/wallet-data.json`：UPay Wallet 的已整理数据
- `scripts/import_ub_excel.py`：导入 UP Business 数据
- `scripts/import_uw_excel.py`：导入 UPay Wallet 数据
- `app/globals.css`：页面样式

## 注意事项

- 不要将原始 Excel、访问令牌、Google Sheet 密钥或卡号/UID 上传到 GitHub。
- 若仓库需要对外公开，请先确认 `app/dashboard-data.json` 中的汇总数据可以公开。
