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

原始 Excel、UID、卡号和 Google Sheet 凭据不会提交到仓库。网页有两层数据来源：

- **默认备用数据**：`app/dashboard-data.json` 与 `app/wallet-data.json`，仅用于本地预览或数据接口暂不可用时。
- **线上实时数据**：Cloudflare Worker 从私有 Apps Script 读取两份私有 Google Sheet 的聚合结果；Apps Script 的访问密钥只保存在 Cloudflare，不会发送到访问者浏览器。

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

### 日常更新（上线后的固定步骤）

1. 使用 `karsol0001@gmail.com` 更新两份专用 Google Sheet：UP Business 与 UPay Wallet。
2. 保持原有工作表名称和列结构；只更新数据，不删除月度汇总或每日明细。
3. 打开网站并点击右上角刷新按钮（或直接刷新浏览器）。网站会重新读取最新聚合数据，无需再上传 Excel、提交 GitHub 或重新部署。

Apps Script 与 Cloudflare 的一次性配置说明在 [`google-apps-script/README.md`](google-apps-script/README.md)。

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
