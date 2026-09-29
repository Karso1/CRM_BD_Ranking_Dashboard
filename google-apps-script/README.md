# Private Google Sheets API / 私有表格接口

[Project overview / 项目总览](../README.md) · [English overview](../README.en.md)

The dashboard's source Sheets are private. A key-protected Google Apps Script web app reads and writes the aggregated Business/Wallet views; the Cloudflare Worker holds the source URL and key as Secrets. Do not place a deployed URL with its key, spreadsheet ID, or raw customer data in Git.

看板的源 Google Sheets 是私有的。Apps Script Web App 通过独立同步密钥读写 UPB/UPW 汇总视图；Cloudflare Worker 的 Secret 保存源地址及密钥。不要把带密钥的部署地址、表格 ID 或原始客户数据提交到 Git。

## Current source of truth / 当前源码

- `WalletSync.gs`: canonical API/write logic shared by both environments. / 两环境共用的主接口与写入逻辑。
- `ProductionViews.gs`: aggregated read/view handlers used with `WalletSync.gs`. / 汇总读取视图。
- `WalletSync.staging.gs`: generated staging artifact. Run `npm run apps-script:build` to regenerate it; **do not edit it by hand**. / 测试版生成文件，不要手改。
- `Code.gs`: historical reader-only implementation. **Do not deploy it alongside the current source.** / 历史只读接口，不要与现行源码混部署。

Production and staging have **separate Apps Script projects, deployments, keys, and spreadsheets**. The staging project's spreadsheet is selected by its existing `STAGING_SPREADSHEET_ID` Script Property. Preserve each project's existing deployment URL, spreadsheet property, and `WALLET_SYNC_KEY`; never copy them across environments. Exact private values are deliberately absent from this repository.

正式与测试有**独立**的 Apps Script 项目、部署、密钥和 Google Sheet。测试项目用其已有的 `STAGING_SPREADSHEET_ID` 属性指向测试表。两边现有部署地址、表格属性和 `WALLET_SYNC_KEY` 必须保留且不可互换；具体私密值不在仓库中。

## When API code changes / 接口代码变更时

1. Update the canonical source and run `npm run apps-script:build` plus `npm run check:pipeline`. / 修改共用源码，生成测试文件并运行检查。
2. Update the **existing staging** Apps Script deployment with the generated staging source and its own Script Properties. / 更新现有测试部署，保留测试项目属性。
3. Run the staging UPB and UPW data launchers and verify the staging site. / 运行两平台测试数据流程并验收测试站。
4. After acceptance, update the **existing production** Apps Script deployment with the same canonical logic and production's own properties, then run the appropriate production data publisher/verification. / 验收后更新现有正式部署，保留正式项目属性，再运行对应正式发布和核验。

`npm run apps-script:build` only generates local source; it does **not** deploy Google Apps Script. Daily CSV updates also do **not** deploy API code. The program-owned `DashboardBusinessDaily` and `DashboardWalletDaily` sheets should not be edited manually. The current pipeline derives months from accepted daily CSVs and targets; do not follow the old `Code.gs` month-tab instructions.

`npm run apps-script:build` 只生成本地源码，**不会**部署 Google Apps Script；日常 CSV 更新也不会部署接口代码。`DashboardBusinessDaily`、`DashboardWalletDaily` 等程序专用页不应手改。现行管线从已验收 CSV 与目标推导月份，不再按旧 `Code.gs` 的月份标签说明操作。
