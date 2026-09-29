# UPay Business Dashboard

[中文说明](README.md) · [Production site](https://upay-bd-ranking.karsol.workers.dev/) · [Staging site](https://upay-bd-ranking-staging.karsol.workers.dev/)

This project turns **UP Business (UPB)** and **UPay Wallet (UPW)** back-office exports into a dashboard with monthly, daily, BD, agent/API, and export views. Sign-in is required: administrators see all data, while each BD account sees only data assigned to its BD. Staging and production share the calculation and website code but use separate spreadsheets, APIs, Workers, snapshots, and account configurations.

> Daily data updates, website code releases, and account management are separate operations. An ordinary data update does **not** require a code change, GitHub push, or website redeployment.

## Daily workflow

The desktop operations console is [`tools/daily-operations/`](tools/daily-operations/00-先看这里.md). For the platform being updated:

1. Place new back-office exports in the corresponding UPB/UPW directory reached through `03-原始数据`. Update the relevant Excel relationship workbook if ownership, cooperation mode, or targets changed.
2. In `01-测试更新`, run `UPB-测试更新.command` or `UPW-测试更新.command` and wait for cloud and website verification to finish.
3. Sign in to the [staging site](https://upay-bd-ranking-staging.karsol.workers.dev/) and review dates, amounts, cards, ownership, and agent profiles.
4. Once accepted, run the matching production publisher in `02-正式发布`, then check the [production site](https://upay-bd-ranking.karsol.workers.dev/). Publication checks the successful staging receipt, code version, and output hashes and sends the accepted CSVs without recalculating them.

Run UPB and UPW separately. A successful staging run **never** publishes production automatically. If a sync response is uncertain, first use the matching environment/platform's verification-only launcher in `04-出错时再看`; it neither recalculates nor repeats the upload. Logs are kept there. Do not blindly rerun a failed production publication.

Detailed guides: [UPB](docs/BUSINESS_DAILY_WORKFLOW_CN.md) · [UPW](docs/WALLET_DAILY_WORKFLOW_CN.md) · [operations console](tools/daily-operations/00-先看这里.md) (Chinese)

## Data sources and sources of truth

| Location / component | What it contains and who maintains it | Edit manually? |
| --- | --- | --- |
| Raw-export directories (via `03-原始数据`) | Local back-office card, recharge, consumption, agency, user-card, and transaction exports. The console links to these directories rather than moving them | Add newly downloaded files to the proper folders; do not alter raw rows |
| UPB `BD代理关系目标/BD代理关系.xlsx` | Client/agent category, cooperation mode, BD assignment, email, cooperation start, monthly targets, and the displayable BD list | When relationships or targets change |
| UPW `total data/代理关系及月份目标.xlsx` | Master/parent UID ownership, agent and BD, email, cooperation start, monthly targets, and the displayable BD list | When relationships or targets change |
| `tools/upb-daily-pipeline/`, `tools/upw-daily-pipeline/` | Python calculation, ownership, and aggregation rules; `tools/daily-operations/90-系统维护/pipeline.py` coordinates both workflows | Not for daily edits; test code changes in staging first |
| Google Sheets | Separate private production and staging aggregate databases. The sync program owns sheets such as `DashboardBusinessDaily` and `DashboardWalletDaily` | Do not hand-edit program-owned sheets |
| Google Apps Script | Key-protected API for the private Sheets, with separate staging and production projects/keys. Canonical source is in `google-apps-script/` | Deploy only when API code changes; CSV publication does not deploy it |
| Cloudflare Workers + KV | Two authenticated websites and their separate last-verified data snapshots. Workers read aggregates server-side rather than exposing source keys to browsers | No daily deployment; deploy each environment for website code changes |
| Cloudflare Secrets and local `*.local.txt` / `sync*.local.json` | Website accounts, session/signing keys, sync keys, and private connection settings, separated by environment | Manage only through the account menu or maintenance procedures; **never commit** |
| GitHub | Version history for the website, pipelines, Apps Script source, tests, and documentation | Push code releases; it is not the business database |

Data flow: `Back-office exports + relationship/target Excel → local Python calculation → environment-specific Google Sheet → Apps Script read-back verification → environment-specific Worker KV snapshot → authenticated website`. The website first displays the latest published snapshot and switches to newer data when the update completes, avoiding a cold Google Sheets read for every visitor. Browsers do not hold raw orders, card numbers, complete UIDs, or sync keys.

### Key business rules

- **UPB:** combines card openings, manual card-to-agent mapping, recharges, and Passto/Reap/StraitsX consumption. The cooperation mode determines the total-amount calculation. Passto HKD transactions use daily official historical FX rates. Internal owners outside the public BD allowlist appear as `UPay`.
- **UPW:** matches parent UID first and master UID as a fallback, then aggregates completed net consumption, registrations, and cards. Owners outside its public BD allowlist appear as `UPay`. A specific UID attribution exception is [documented here](docs/UPW归属例外说明.md).
- Both platforms publish agent/API profiles, including email and cooperation start. Agents listed in the workbook remain visible even with zero activity. See [profile rules](docs/agent-profiles.md). Monthly targets come from the relationship/target workbooks, not transaction exports.

## Environments and access control

| Item | Staging | Production |
| --- | --- | --- |
| Website / Worker | `upay-bd-ranking-staging` | `upay-bd-ranking` |
| Google Sheet, Apps Script, KV | Isolated staging resources | Isolated production resources |
| Local inputs and outputs | Staging input copies and `outputs/staging` | Accepted results published to production outputs |
| Account manager | `01-测试更新/账号管理.command` | `02-正式发布/账号管理.command` |

The account menu lists locally recorded accounts and can add or modify administrator and BD credentials. Administrators can view both complete platforms. BDs use the same UI, but the Worker restricts API responses to their assigned BD and denies publication. Passwords are checked against Cloudflare Secrets, not in frontend code. Sessions use expiring secure cookies; sign-in attempts are rate-limited. Both environments initially received the same accounts, but subsequent changes are **independent**. Displaying plaintext passwords from the local record requires a second confirmation; that record is not a live query of Cloudflare passwords. See [account roles](docs/BD账号测试说明.md) and [password management](docs/网站访问密码说明.md) (Chinese).

## Three kinds of changes, three procedures

| Change | Procedure |
| --- | --- |
| Daily business data, ownership, or targets | Update exports/workbooks → staging run → inspect site → matching production publisher. No GitHub push or website deployment |
| Website UI, calculation/ownership logic, or Apps Script API | Change and test source → deploy/run staging → obtain acceptance → release the corresponding production code and rerun data pipelines if required → push GitHub |
| Usernames, passwords, administrator/BD access | Use that environment's `账号管理.command`. It changes the selected Worker's Secret without recalculating business data or changing the other environment |

The calculation workflow records a successful staging receipt, code digest, and output hashes. Changes after acceptance block production publication. For uncertain upload responses (including timeouts/502s), it reads back and verifies instead of automatically repeating the POST. Never cross-wire staging and production keys, Sheet IDs, or Apps Script URLs.

## Maintainer quick reference

Requirements: Node.js `>=22.13`, Python 3, project dependencies, and existing Cloudflare/Google authorization. Raw local data and private configuration are **not in GitHub**; cloning the repository alone cannot run a real data sync.

```bash
npm ci                    # Frontend and Wrangler dependencies
npm run check:pipeline    # Python, Apps Script source, and frontend/API tests
npx tsc --noEmit          # TypeScript check
npm run build:staging     # Build the staging website
npm run deploy:staging    # Deploy staging website code when authorized
npm run deploy:production # Deploy production website code after acceptance
```

`npm run apps-script:build` generates staging Apps Script source but does not deploy a Google project; see [`google-apps-script/README.md`](google-apps-script/README.md). Website deployment commands do **not** publish daily business data. Never commit generated `outputs/`, `dist/`, `.env*`, `*.local.txt`, `sync*.local.json`, raw Excel/CSV files, or secrets.

Directory map: `app/` UI and API; `lib/site-access.ts` authentication and roles; `lib/bd-scope.ts` BD data isolation; `worker.ts` Worker entry point; `tools/daily-operations/` daily launchers; `tools/*-daily-pipeline/` calculations and sync; `google-apps-script/` private-data API; `tests/` verification. Historical investigation notes live under `docs/`; use this README, the operations-console guide, and current source as the authority for the present workflow.

On failure, keep the error window and inspect `04-出错时再看/运行记录`. For an uncertain sync, use verification-only first. Do not post plaintext credentials, sync configuration, raw customer data, or screenshots containing passwords to GitHub issues or public chats.
