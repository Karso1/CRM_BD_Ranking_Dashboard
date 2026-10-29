# UPay Operations Platform — project map and handover guide

[中文说明](README.md) · [Production site](https://upaydashboard.com/) · [Staging site](https://staging.upaydashboard.com/)

This guide reflects the repository and operations workflow as of **2026-10-29**. It is not a financial audit, penetration test, or automatic backup of live resources. Raw business files, browser sessions, credentials, and local run state are excluded from this source update.

Latest guides: [UPB automatic downloads](tools/upb-download/README.md), [UPW export and automatic import](tools/upw-download/README.md), [Chrome extension and permissions](tools/upw-download/chrome-extension/README.md), and [engineering lessons and roadmap](docs/PROJECT_ROADMAP_2026-10-29_CN.md) (Chinese).

## October reliability update

- UPB downloads missing days, validates five daily sources, splits oversized exports, and backs up the successful manual-card mapping snapshot. Completed downloads are checked against stored file hashes.
- UPW extension **0.3.7** operates in the existing signed-in Chrome, resets filters, scopes controls and counts to the requested visible tab, commits date ranges before querying, and checks result dates. Bounded page recovery preserves completed stages and days; unchanged counts alone do not trigger a failure.
- The desktop UPW importer now validates, backs up, installs, and updates both local coverage indexes automatically. It no longer asks the operator to type a confirmation word. `--check-only` remains available.
- Relationship deltas merge by UID over the historical baseline; source validation, overlap, and ordering remain required. Zero-transaction days and very large card snapshots still need additional support.
- The standard test command includes extension `.cjs` tests. Full browser workflows still require ongoing real-backend acceptance; mock tests do not prove source completeness.

Downloaded, imported, staging-accepted, and production-published are separate states. UPB uses UTC+0 business dates; UPW uses UTC+8. A coverage file's generation date is not its latest imported transaction date.

The next priorities are a unified operations console, per-day data ledger, immutable export archives, independent reconciliation and versioned publication/recovery. Business expansion should then add stable customer IDs, customer profiles, BD follow-up tasks and actionable alerts, followed by funnels/retention, API onboarding and versioned commission/month-end workflows. These are **plans, not shipped features**. Keep the existing dashboard and access controls; introduce transactional business storage and private attachments when collaborative editing requires them. See the [full roadmap](docs/PROJECT_ROADMAP_2026-10-29_CN.md).

This project turns **UP Business (UPB)** and **UPay Wallet (UPW)** back-office exports into an authenticated operations dashboard: month/date-range and BD filters, trends, BD contribution, BD/agent/API rankings, activity, and agent profiles. Ranking tables show a total row outside the ranking. The **primary administrator** can export Excel data matching the current filters; other admins and BD accounts cannot use that export. BD accounts receive only their own BD's server-scoped data.

It is currently a **local-file calculation → cloud aggregate → controlled display** system, not an online CRM master-data editor or financial ledger. KYB approvals, lifecycle states, and multi-user write workflows are future possibilities, not shipped features.

> Daily data updates, website code releases, and account management are separate operations. An ordinary data update does **not** require a code change, GitHub push, or website redeployment.

## Daily workflow

The desktop operations console is [`tools/daily-operations/`](tools/daily-operations/00-先看这里.md). For the platform being updated:

1. Acquire and import sources: run the UPB download launcher, or use the UPW extension in the existing Chrome and then double-click `02-UPW-校验并导入数据.command`. A successful import does not publish the website. Update the relevant Excel relationship workbook if ownership, cooperation mode, or targets changed.
2. In `01-测试更新`, run `UPB-测试更新.command` or `UPW-测试更新.command` and wait for cloud and website verification to finish.
3. Sign in to the [staging site](https://staging.upaydashboard.com/) and review dates, amounts, cards, ownership, and agent profiles.
4. Once accepted, run the matching production publisher in `02-正式发布`, then check the [production site](https://upaydashboard.com/). Publication checks the successful staging receipt, code version, and output hashes and sends the accepted CSVs without recalculating them.

Run UPB and UPW separately. A successful staging run **never** publishes production automatically. If a sync response is uncertain, first use the matching environment/platform's verification-only launcher in `04-出错时再看`; it neither recalculates nor repeats the upload. Logs are kept there. Do not blindly rerun a failed production publication.

Detailed guides: [UPB](docs/BUSINESS_DAILY_WORKFLOW_CN.md) · [UPW](docs/WALLET_DAILY_WORKFLOW_CN.md) · [operations console](tools/daily-operations/00-先看这里.md) (Chinese)

## Data sources and sources of truth

| Location / component | What it contains and who maintains it | Edit manually? |
| --- | --- | --- |
| Raw-export directories (via `03-原始数据`) | Local back-office card, recharge, consumption, agency, user-card, and transaction exports. The console links to Desktop directories rather than moving them | Add new exports; normally preserve originals. Back up, document, and verify any exceptional source-row correction |
| UPB `BD代理关系目标/BD代理关系.xlsx` | Client/agent category, cooperation mode, BD assignment, email, cooperation start, monthly targets, and the displayable BD list | When relationships or targets change |
| UPW `total data/代理关系及月份目标.xlsx` | Master/parent UID ownership, agent and BD, email, cooperation start, monthly targets, and the displayable BD list | When relationships or targets change |
| `tools/upb-daily-pipeline/`, `tools/upw-daily-pipeline/` | Python calculation, ownership, and aggregation rules; `tools/daily-operations/90-系统维护/pipeline.py` coordinates both workflows | Not for daily edits; test code changes in staging first |
| Google Sheets | Separate private production and staging aggregate databases. The sync program owns sheets such as `DashboardBusinessDaily` and `DashboardWalletDaily` | Do not hand-edit program-owned sheets |
| Google Apps Script | Key-protected API for the private Sheets, with separate staging and production projects/keys. Canonical source is in `google-apps-script/` | Deploy only when API code changes; CSV publication does not deploy it |
| Cloudflare Workers + KV | Two authenticated websites and their separate last-verified data snapshots. Workers read aggregates server-side rather than exposing source keys to browsers | No daily deployment; deploy each environment for website code changes |
| Cloudflare Secrets and local `*.local.txt` / `sync*.local.json` | Website accounts, session/signing keys, sync keys, and private connection settings, separated by environment | Manage only through the account menu or maintenance procedures; **never commit** |
| GitHub | Version history for the website, pipelines, Apps Script source, tests, and documentation | Push code releases; it is neither the business database nor a store for raw workbooks and private configuration |

Data flow: `Back-office exports + relationship/target Excel → local Python calculation → environment-specific Google Sheet → Apps Script read-back verification → environment-specific Worker KV snapshot → authenticated website`. The website first displays the latest published snapshot and switches to newer data when the update completes, avoiding a cold Google Sheets read for every visitor. Browsers do not hold raw orders, card numbers, complete UIDs, or sync keys.

### Key business rules

- **UPB:** combines card openings, manual card-to-agent mapping, recharges, and Passto/Reap/StraitsX consumption. Cooperation mode determines total amount; recharge and consumption are also reported separately. Passto HKD transactions use daily historical FX rates. Within a workbook, duplicate orders keep the earliest application; ties or missing application timestamps keep the first source row. Across workbooks, the newer reporting-month/file snapshot wins before status/fee filtering. Changes to this rule require historical staging review. Internal owners outside the public BD allowlist appear as `UPay`.
- **UPW:** matches parent UID first and master UID as a fallback, then aggregates completed net consumption, registrations, and cards. Owners outside its public BD allowlist appear as `UPay`. A specific UID attribution exception is [documented here](docs/UPW归属例外说明.md).
- Both platforms publish agent/API profiles, including email and cooperation start. Listed agents remain visible with zero activity. UPB provides BD, Overall (agents + API), Agents, and API rankings; UPW provides BD, Overall, and Agents. Filtered totals do not take a rank. Activity uses positive consumption events in a recent 30-day window; see the [activity note](docs/ACTIVITY_AND_REFRESH_2026-09-27_CN.md) (Chinese) and [profile rules](docs/agent-profiles.md). Monthly targets come from relationship/target workbooks, not transaction exports.

## Environments and access control

| Item | Staging | Production |
| --- | --- | --- |
| **User-facing domain** | **[staging.upaydashboard.com](https://staging.upaydashboard.com/)** | **[upaydashboard.com](https://upaydashboard.com/)** |
| Worker name | `upay-bd-ranking-staging` | `upay-bd-ranking` |
| Technical fallback URL | `upay-bd-ranking-staging.karsol.workers.dev` | `upay-bd-ranking.karsol.workers.dev` |
| Google Sheet, Apps Script, KV | Isolated staging resources | Isolated production resources |
| Local inputs and outputs | Staging input copies and `outputs/staging` | Accepted results published to production outputs |
| Account manager | `01-测试更新/账号管理.command` | `02-正式发布/账号管理.command` |

Only **one root domain, `upaydashboard.com`, was purchased**. `staging.upaydashboard.com` is a subdomain configured under it; it does not require a second purchase. Both custom-domain and `workers.dev` login URLs responded on 2026-10-02. Domain ownership does not itself isolate data or change Worker authorization. Use custom domains for ordinary sharing; retain `workers.dev` addresses as troubleshooting paths. Include registrar renewal, DNS, and Worker Custom Domain ownership in handover.

The account menu lists locally recorded accounts and can add or modify administrator and BD credentials. Primary and additional administrators see complete data, but **only the primary administrator can export Excel**. BDs use the same UI, but the Worker restricts API responses to their assigned BD and denies publication. Passwords are checked against Cloudflare Secrets, not in frontend code. Sessions use expiring secure cookies; sign-in attempts are rate-limited. Both environments initially received the same accounts, but subsequent changes are **independent**. Displaying plaintext passwords from the local record requires a second confirmation; that record is not a live query of Cloudflare passwords. See [account roles](docs/BD账号测试说明.md) and [password management](docs/网站访问密码说明.md) (Chinese).

## Concepts and code map

| Area | How this project uses it | Where to look |
| --- | --- | --- |
| Data engineering / ETL | Excel/CSV inputs, client/UID ownership, order deduplication, FX conversion, daily/monthly aggregation, source coverage | `tools/upb-daily-pipeline/`, `tools/upw-daily-pipeline/` |
| Publication and data quality | Staging receipts, code and output hashes, daily/owner read-back checks, production guardrails, verification-only recovery | `tools/daily-operations/90-系统维护/`, `tests/` |
| Cloud data interface | Google Sheets aggregate storage and Apps Script read/write Web App, isolated by environment | `google-apps-script/` |
| Web and edge | React/TypeScript dashboard, Worker API, KV last-verified snapshots, caching and background refresh | `app/`, `worker.ts`, `vite.config.ts` |
| Identity and authorization | Sign-in, session cookies, rate limits, administrator/BD roles, server-side BD scoping, export permission | `lib/site-access.ts`, `lib/bd-scope.ts`, `worker.ts` |
| Reporting and visualization | Trends, contribution, rankings, activity, filtered totals, and primary-admin Excel export | `app/page.tsx`, `lib/agent-activity.ts`, `lib/xlsx-export.ts` |
| Domains and recovery | DNS/Custom Domains, staging and production Workers, Git history, operation logs and local backups | `vite.config.ts`, `tools/daily-operations/`, GitHub |

The `db/` and `drizzle/` folders are starter scaffolding; the current operational data path is **Google Sheets + Worker KV**, not an already deployed D1 database capable of taking over business data.

## Three kinds of changes, three procedures

| Change | Procedure |
| --- | --- |
| Daily business data, ownership, or targets | Update exports/workbooks → staging run → inspect site → matching production publisher. No GitHub push or website deployment |
| Website UI, calculation/ownership logic, or Apps Script API | Change and test source → deploy/run staging → obtain acceptance → release the corresponding production code and rerun data pipelines if required → push GitHub |
| Usernames, passwords, administrator/BD access | Use that environment's `账号管理.command`. It changes the selected Worker's Secret without recalculating business data or changing the other environment |

The calculation workflow records a successful staging receipt, code digest, and output hashes. Changes after acceptance block production publication. For uncertain upload responses (including timeouts/502s), it reads back and verifies instead of automatically repeating the POST. Never cross-wire staging and production keys, Sheet IDs, or Apps Script URLs.

## Existing safeguards and remaining risks

This is a maintenance backlog, not a claim that each issue has already caused a production incident. Preserve the existing environment separation, sign-in gate, hash-based acceptance, and published snapshots while improving the remaining gaps. The [2026-09-24 review](docs/PROJECT_REVIEW_2026-09-24_CN.md) is historical: its statements about public access, statuses, and export do not all describe the current release.

| Priority | Risk / present boundary | Direction |
| --- | --- | --- |
| High | **Raw exports, relationship workbooks, sync configuration, and some account records still depend on the maintainer's computer**; GitHub has source code only. A clone cannot restore daily publishing after device loss or handover | Maintain encrypted, recoverable backups of data and configuration; document Cloudflare/Google/domain ownership; rehearse recovery on another machine |
| High | **The Google Sheet writer clears and fills multiple program-owned sheets sequentially, not as one atomic transaction.** Environment locks, read-back verification, and local production-output backups reduce risk but do not make a partial cloud write impossible; code rollback does not roll back data | Write versioned batches, verify all data, then switch an active-version pointer; retain and exercise rollback |
| High | **Accuracy depends on export completeness and mapping rules.** File/date/status/count checks and deduplication exist; missing channels, late status changes, refunds, UID mappings and zero-data days still require independent reconciliation | Add a per-platform/source/day ledger with query conditions, hashes and totals, plus traceable historical corrections |
| Medium | **Credential and permission handover**: Worker Secrets protect online passwords, but the local account record can reveal plaintext and is not a live source of truth; account lifecycle still uses a desktop menu. Staging also holds real operating aggregates | Encrypt local records or move them into controlled secret storage; formalize account issue/revocation and periodic access review; protect staging data like production data |
| Medium | **Observability and release automation remain incomplete**: local operation logs and basic Worker logs exist, but this repository has no CI workflow, data-lag alerting, or configured Worker distributed traces; daily runs are manual | Add GitHub CI for tests/build, alerts for data date/sync failure/API errors/KV age, and appropriately sampled structured logs and traces |
| Medium | **Current relationship settings can recalculate historical attribution**; the dashboard is an operations reference, not a finance ledger. Individual targets, activity thresholds, and FX usage need named business owners | Decide whether historical or current ownership governs old transactions; introduce effective dates; document metric definitions, exception approval, and monthly reconciliation |
| Low | Dashboard UI and calculation logic remain concentrated, and full-history Excel recomputation will get slower as files grow | Measure runtime and payloads first, then split components and add invalidation-aware incremental computation behind regression tests |

**Security boundary:** authentication covers the page, static assets, and data API; hiding a frontend button is not the authorization model. Still, every authorized account can see data within its granted scope. A domain and password do not replace account revocation, encrypted backups, or access audit. Never post password screenshots, email lists, or raw customer records publicly.

## Suggested next phases

1. **Make handover practical:** maintain a non-secret asset inventory covering registrar, Cloudflare Workers/KV, two Google Sheets/Apps Script projects, backups, and owners in a controlled company space. Give a successor least-privilege access and rehearse a clean staging run on another machine.
2. **Improve publication reliability:** define batch IDs, required-source inventory, independent reconciliation, atomic publication, and rollback. Alert on stale data. Only then consider unattended daily scheduling; automation must not bypass staging acceptance or exception review.
3. **Design future CRM/KYB modules:** first specify stable client IDs, KYB stages, owners, document types, permissions, and state transitions. Consider a database and private object storage when multi-user editing, approvals, and attachments become real requirements; do not place KYB files in current public assets or real-data staging fixtures.

These are **recommendations**, not deployed features or an immediate mandate to migrate away from Google Sheets. The current single-maintainer dashboard can keep using its staging → production workflow meanwhile.

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

`npm run apps-script:build` generates staging Apps Script source but does not deploy a Google project; see [`google-apps-script/README.md`](google-apps-script/README.md). Website deployment commands do **not** publish daily business data. Never commit generated `outputs/`, `dist/`, `.env*`, `*.local.txt`, `sync*.local.json`, raw Excel/CSV files, backups, or secrets. Pushing documentation or code to GitHub also does **not** update the website or daily data automatically.

Directory map: `app/` UI and API; `lib/site-access.ts` authentication and roles; `lib/bd-scope.ts` BD data isolation; `worker.ts` Worker entry point; `tools/daily-operations/` daily launchers; `tools/*-daily-pipeline/` calculations and sync; `google-apps-script/` private-data API; `tests/` verification. Historical investigation notes live under `docs/`; use this README, the operations-console guide, and current source as the authority for the present workflow.

On failure, keep the error window and inspect `04-出错时再看/运行记录`. For an uncertain sync, use verification-only first. Do not post plaintext credentials, sync configuration, raw customer data, or screenshots containing passwords to GitHub issues or public chats.
