# Private Google Sheets endpoint

## Current deployment workflow (2026-09-27)

The canonical aggregation code is `WalletSync.gs`, with published-view handlers in `ProductionViews.gs`. Production uses these two files together. Do not deploy the legacy `Code.gs` into the same project.

Run `npm run apps-script:build` to generate the standalone `WalletSync.staging.gs` from those shared files. It removes the production spreadsheet ID and reads `STAGING_SPREADSHEET_ID` from the staging project's existing properties. Both projects retain their independent `WALLET_SYNC_KEY`, deployment URL, database and published views.

Run `npm run check:pipeline` before deployment. Update the existing staging deployment first, run both staging data pipelines, and verify the site. After user acceptance, update the production project with the same canonical source version and keep its existing deployment URL and properties. Publishing local CSVs does not deploy Apps Script code.

On 2026-09-27 the generated staging code was deployed as version 7. The revised production source is prepared locally and awaits staging acceptance before production deployment.

Daily data updates now use `tools/daily-operations/01-测试更新`, followed by the accepted-results publishers in `02-正式发布`. Months come from the daily CSV and targets automatically. No manual month tabs or `BUSINESS_MONTHS` changes are required for this pipeline.

The setup notes below describe the older spreadsheet-reader endpoint only.

This folder contains the Google Apps Script used by the dashboard to read the two private source sheets and return only the aggregated values shown on the public dashboard.

## One-time setup

1. Open [Google Apps Script](https://script.google.com/home) and create a new project named `UPay Dashboard Data API`.
2. Replace the contents of `Code.gs` with `google-apps-script/Code.gs` from this repository.
3. In **Project Settings → Script properties**, create the following values. Do not save them in GitHub:

   | Property | Value |
   | --- | --- |
   | `DASHBOARD_API_KEY` | A long random secret used only by Cloudflare |
   | `BUSINESS_SPREADSHEET_ID` | The URL ID of the personally-owned `UP 每日数据（看板数据源）` |
   | `WALLET_SPREADSHEET_ID` | The URL ID of the personally-owned `UPay Wallet 每日数据（看板数据源）` |

   The Apps Script project and both source Sheets must be owned by `karsol0001@gmail.com`.
4. Deploy the project as a **Web app**. It must run as your Google account and be accessible to **Anyone**.
5. Copy the deployed URL ending in `/exec`, then append `?key=` and the API key.
6. The `Code.gs` endpoint is the legacy spreadsheet reader. If retained as a fallback, store its URL as `DASHBOARD_SOURCE_URL` in Cloudflare Workers & Pages → `upay-bd-ranking` → Settings → Variables and Secrets.
7. The production daily UPB and UPW commands both write to the `WalletSync.gs` web app. Store that deployed URL as `WALLET_SOURCE_URL`; it returns both the Business and Wallet datasets. The Worker uses this combined endpoint as the canonical source for both platforms, so both daily commands must target the same production deployment and key.

The source spreadsheets remain private. The endpoint checks the key and returns only aggregated dashboard data.

## Daily process

- Update the relevant day/month tabs in **UP 每日数据（看板数据源）** for UP Business.
- Update the equivalent tabs in **UPay Wallet 每日数据（看板数据源）** for UPay Wallet.
- The dashboard reads the fresh aggregate on each refresh. You do not need to push code to GitHub for ordinary daily updates.

## Adding a new month

The initial source workbooks include January–September 2026. Before creating an October (or later) tab, add its summary/daily tab names to `BUSINESS_MONTHS` and `WALLET_MONTHS` in `Code.gs`, then deploy a new version of the Apps Script.
