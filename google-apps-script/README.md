# Private Google Sheets endpoint

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
6. In Cloudflare Workers & Pages → `upay-bd-ranking` → Settings → Variables and Secrets, create a secret named `DASHBOARD_SOURCE_URL` and paste that complete URL.
7. The automated Wallet pipeline uses a separate secret named `WALLET_SOURCE_URL`. It points to the deployed Wallet sync web app and is intentionally kept separate from the existing Business / Wallet legacy source.

The source spreadsheets remain private. The endpoint checks the key and returns only aggregated dashboard data.

## Daily process

- Update the relevant day/month tabs in **UP 每日数据（看板数据源）** for UP Business.
- Update the equivalent tabs in **UPay Wallet 每日数据（看板数据源）** for UPay Wallet.
- The dashboard reads the fresh aggregate on each refresh. You do not need to push code to GitHub for ordinary daily updates.

## Adding a new month

The initial source workbooks include January–September 2026. Before creating an October (or later) tab, add its summary/daily tab names to `BUSINESS_MONTHS` and `WALLET_MONTHS` in `Code.gs`, then deploy a new version of the Apps Script.
