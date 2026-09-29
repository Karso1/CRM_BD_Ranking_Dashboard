# UPay 看板测试环境

测试网站：[https://upay-bd-ranking-staging.karsol.workers.dev](https://upay-bd-ranking-staging.karsol.workers.dev)

**访问与数据说明：** 测试与正式 Worker 均要求用户名和密码登录，支持管理员和绑定 BD 的账号；两环境账号配置各自独立。Worker 同时验证页面、静态文件和数据接口的访问权限，BD 数据范围在服务端限制。凭据保存在 Worker Secret，管理方法见 [网站访问密码说明](网站访问密码说明.md)。原始导出、卡号/订单明细和同步密钥仍保留在本机、私有 Google Sheet 或 Worker Secret 中，不写入网页代码。

## 生产与测试的边界

| 环节 | 正式环境 | 测试环境 |
| --- | --- | --- |
| 网站 | `upay-bd-ranking` | `upay-bd-ranking-staging` |
| 数据库 | 现有生产 Google Sheet | 独立的 `UPay Dashboard Staging Database - Test Data` 表格 |
| Apps Script | 现有正式项目/地址 | 单独的 Apps Script 项目与部署地址 |
| 本地同步配置 | `sync.local.json` | `sync.staging.local.json`（Git 忽略） |
| 原始文件 | 日常 UPW / UPB 文件夹 | 各自 `staging-inputs/`（Git 忽略） |
| 汇率缓存/计算输出 | 各自正式目录 | `outputs/staging/`、`cache/staging/` |

测试数据库是独立表，不复制生产表或生产行。专用 `WalletSync.staging.gs` 固定报告 `environment=staging`，通过 `STAGING_SPREADSHEET_ID` 选择测试表；两个本地测试同步器在 POST 前校验环境和接口错误。正式端点没有 staging 标记时会在写入前停止。测试同步地址和密钥与正式配置分别保存，写入只允许指向 staging Apps Script。

## 测试环境组成

1. Google Sheet `UPay Dashboard Staging Database - Test Data` 独立于生产表。
2. Apps Script `UPay Dashboard STAGING API` 独立于生产项目，使用独立部署地址和 staging 专用密钥。
3. Cloudflare Worker `upay-bd-ranking-staging` 独立于正式 Worker；两个平台的 Worker secret 均指向 staging Apps Script。
4. 本地 UPW / UPB 测试配置、输入目录、计算输出和汇率缓存均与正式数据分开。
5. staging 计算输出、汇率缓存、原始输入快照均与正式目录分开，且 Git 忽略。

不要把密钥放进 Git、截图、聊天记录或公开分享链接。测试数据库和 Apps Script 必须保持独立于生产。

## 如何更新测试环境

运行操作台 `tools/daily-operations/01-测试更新/UPW-测试更新.command` 或 `UPB-测试更新.command` 时，程序从 `03-原始数据/` 将当前原始文件镜像到以下 Git 忽略目录，再计算并写入独立 staging 数据库。沿用用户对使用真实汇总数据测试的授权，不再重复要求输入 YES；更新程序用原有同步密钥，不需要输入网站访问密码：

- `tools/upw-daily-pipeline/staging-inputs/total data/`，并将测试用 `代理关系及月份目标.xlsx` 放在 `staging-inputs/` 根目录。
- `tools/upb-daily-pipeline/staging-inputs/`，保持 `开卡`、`手动开卡`、`充值数据`、`消费数据`、`BD代理关系目标/BD代理关系.xlsx` 的相对目录结构。

这套流程使用真实输入验证计算，但只写测试表和测试 Worker，不改正式数据库。提交数据前仍会检查 Apps Script 返回的 `environment=staging`，并在写入后校验数据和刷新测试 Worker 缓存；任何环境不匹配都会在 POST 写入前停止。

## 网页代码更新流程

本地统一入口为 `tools/daily-operations/90-系统维护/pipeline.py`。测试完整运行成功后记录代码摘要和输出校验值；在 `02-正式发布` 运行对应的平台入口可原样发布同一批 CSV。若代码或文件改变，发布会停止并要求重新测试。该入口只发布数据，不部署网页或 Apps Script。

Apps Script 的测试文件通过 `npm run apps-script:build` 从 `WalletSync.gs` 和 `ProductionViews.gs` 生成，仅替换环境和数据库配置；测试文件不要手工修改。`npm run check:pipeline` 检查同源性、月份日期、零业绩 BD、重复订单和同步恢复行为。

在本机先改代码、执行构建/检查，再运行 `npm run deploy:staging` 更新测试 Worker；每次改动先在 staging 用真实数据验收。必须由用户明确确认 staging 结果无误后，才部署同一代码到正式 Worker `upay-bd-ranking`。日常数据刷新不需要重新部署网站：正式和测试同步入口始终分别写入对应环境。
