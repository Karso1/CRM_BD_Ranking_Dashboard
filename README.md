# UPay 业务数据看板

[English](README.en.md) · [正式站](https://upay-bd-ranking.karsol.workers.dev/) · [测试站](https://upay-bd-ranking-staging.karsol.workers.dev/)

本项目把 **UP Business（UPB）** 和 **UPay Wallet（UPW）** 的后台导出整理成可按月份、日期、BD、代理/API 查看与导出的看板。网站需要登录：管理员看全部数据，BD 账号只看绑定 BD 的数据。测试和正式使用同一套计算与网站代码，但各有独立的表格、接口、Worker、快照和账号配置。

> 日常数据更新、网站代码发布、账号管理是三种不同操作。平时更新数据**不需要**改代码、推送 GitHub 或重新部署网站。

## 日常怎么用

统一操作台在 [`tools/daily-operations/`](tools/daily-operations/00-先看这里.md)。按所更新的平台执行：

1. 把新的后台导出放进 `03-原始数据` 对应的 UPB/UPW 目录；若代理归属、合作模式或目标发生变化，先改相应 Excel 关系表。
2. 在 `01-测试更新` 双击 `UPB-测试更新.command` 或 `UPW-测试更新.command`，等待“云端和网站数据均已通过验收”。
3. 登录[测试站](https://upay-bd-ranking-staging.karsol.workers.dev/)核对日期、金额、卡数、归属与代理资料。
4. 确认无误后，在 `02-正式发布` 双击同平台的正式发布程序，再核对[正式站](https://upay-bd-ranking.karsol.workers.dev/)。正式发布会校验测试成功记录、代码版本与输出哈希，并发布已验收的 CSV，不重新计算。

两个平台分别更新；测试站运行成功**不会**自动更新正式站。如果同步结果不确定，先用 `04-出错时再看` 中同平台、同环境的“重新核验”入口；它不重新计算或重复上传。错误日志也在那里。不要在报错后盲目重跑正式发布。

详细手册：[UPB](docs/BUSINESS_DAILY_WORKFLOW_CN.md) · [UPW](docs/WALLET_DAILY_WORKFLOW_CN.md) · [操作台](tools/daily-operations/00-先看这里.md)

## 数据从哪里来（项目的“知识库”）

| 位置 / 组件 | 保存什么、谁维护 | 日常是否手改 |
| --- | --- | --- |
| 原始导出目录（通过 `03-原始数据` 进入） | 后台导出的开卡、充值、消费、代理关系、用户卡片和交易记录；保留在本机，操作台入口是符号链接 | 下载新文件后放入对应目录；不要改原始行 |
| UPB `BD代理关系目标/BD代理关系.xlsx` | 客户/代理、类别、合作模式、BD 归属、邮箱、合作时间、月份目标与允许展示的 BD 名单 | 关系或目标变化时改 |
| UPW `total data/代理关系及月份目标.xlsx` | 总代 UID / 上一级 UID 归属、代理、BD、邮箱、合作时间、月份目标与允许展示的 BD 名单 | 关系或目标变化时改 |
| 本仓库 `tools/upb-daily-pipeline/`、`tools/upw-daily-pipeline/` | Python 计算、归属与聚合规则；`tools/daily-operations/90-系统维护/pipeline.py` 统一调度 | 日常不改；代码变更需先在测试站验收 |
| Google Sheets | 正式与测试各自独立的私有汇总数据库；`DashboardBusinessDaily`、`DashboardWalletDaily` 等程序专用页由同步程序写入 | 不手改程序页 |
| Google Apps Script | 私有表格的受密钥保护接口；正式与测试各有项目/密钥。核心源码在 `google-apps-script/` | 仅接口代码变更时部署，不随每日 CSV 自动部署 |
| Cloudflare Workers + KV | 两个登录站点及各自的最新已验收快照；Worker 从服务端读取汇总，不把接口密钥交给浏览器 | 日常无需部署；网站代码变更需分别发布 |
| Cloudflare Secrets + 本机 `*.local.txt` / `sync*.local.json` | 网站账号、会话密钥、同步密钥与私有连接配置；测试、正式分开 | 只通过账号菜单或维护流程管理；**不提交 Git** |
| GitHub | 网站、计算程序、Apps Script 源码、测试和文档的版本历史 | 代码发布时推送；不是业务数据库 |

数据路径：`后台导出 + 关系/目标 Excel → 本地 Python 计算 → 对应环境的 Google Sheet → Apps Script 读回核验 → 对应环境的 Worker KV 快照 → 登录后的网站`。网站先读取已发布快照，后台更新完成后再显示新数据，不让每个访客都等待 Google Sheets 冷启动。浏览器不持有原始订单、卡号、完整 UID 或同步密钥。

### 两个平台的关键口径

- **UPB**：合并开卡、手动开卡映射、充值及 Passto/Reap/StraitsX 消费；按合作模式计算总金额。Passto HKD 交易使用按日的官方历史汇率。公开 BD 名单外的内部归属显示为 `UPay`。
- **UPW**：按上一级 UID 优先、总代 UID 兜底匹配代理与 BD，统计完成状态下的净消费、注册和卡数；公开 BD 名单外的归属显示为 `UPay`。特定 UID 归属例外见[说明](docs/UPW归属例外说明.md)。
- 两个平台都从关系表同步代理/API 资料，包括邮箱和合作开始时间；表中已有但业绩为 0 的代理仍可展示。具体合并规则见[代理资料说明](docs/agent-profiles.md)。月目标来自各自的关系/目标 Excel，不来自交易导出。

## 测试、正式与权限

| 项目 | 测试 | 正式 |
| --- | --- | --- |
| 网站 / Worker | `upay-bd-ranking-staging` | `upay-bd-ranking` |
| Google Sheet、Apps Script、KV | 独立测试资源 | 独立正式资源 |
| 本地输入与输出 | 测试输入副本、`outputs/staging` | 已验收结果发布到正式输出 |
| 账号管理 | `01-测试更新/账号管理.command` | `02-正式发布/账号管理.command` |

账号菜单可查看本机记录、增加或修改管理员/BD 账号。管理员可查看两个平台的完整数据；BD 的页面布局相同，但数据接口在 Worker 端按绑定的 BD 裁剪，不能读取其他 BD 的数据，也不能发布数据。密码在 Cloudflare Secret 中校验，不在前端判断。登录后使用有期限的安全 Cookie，登录尝试受限速保护。两个环境最初复制了账号配置，之后**各自修改、互不自动同步**。本机查看菜单中的明文密码需要再次确认；本机记录不是 Cloudflare 的实时密码查询。详见[账号与权限](docs/BD账号测试说明.md)及[密码说明](docs/网站访问密码说明.md)。

## 三类变更，走三条流程

| 要改什么 | 正确做法 |
| --- | --- |
| 每日业务数据、代理关系、目标 | 更新原始文件/关系表 → 测试程序 → 网站验收 → 同平台正式发布程序；不需要 GitHub 或网站部署 |
| 网站界面、计算/归属规则、Apps Script 接口 | 改本仓库源码并运行测试 → 部署/运行测试环境验收 → 获得确认后发布对应正式代码；再按需要重新运行数据管线；最后推送 GitHub |
| 用户名、密码、管理员或 BD 权限 | 用相应环境的 `账号管理.command`；它更新该 Worker 的 Secret，不重算业务数据，也不会自动修改另一个环境 |

计算程序对测试输出保存成功记录、代码摘要和文件哈希；代码或输出在验收后变化会阻止正式发布。上传响应超时/502 时会优先读回核对，不自动重复 POST。测试与正式资源不可互换；不要复制同步密钥、Sheet ID 或 Apps Script 地址到另一环境。

## 维护人员入口

环境：Node.js `>=22.13`、Python 3、项目依赖及已有的 Cloudflare/Google 授权。本机原始数据与私密配置**不在 GitHub**；仅克隆本仓库无法运行真实数据同步。

```bash
npm ci                    # 安装前端与 Wrangler 依赖
npm run check:pipeline    # Python、Apps Script 同源检查及前端/接口测试
npx tsc --noEmit          # TypeScript 检查
npm run build:staging     # 构建测试站
npm run deploy:staging    # 获授权后发布测试站网站代码
npm run deploy:production # 测试验收后发布正式站网站代码
```

`npm run apps-script:build` 只生成测试用 Apps Script 源码，不会部署 Google 项目；接口部署见 [`google-apps-script/README.md`](google-apps-script/README.md)。部署命令发布的是**网站代码**，不是每日业务数据。不要把生成的 `outputs/`、`dist/`、`.env*`、`*.local.txt`、`sync*.local.json`、原始 Excel/CSV 或密钥提交到 Git。

重要目录：`app/` 页面与 API；`lib/site-access.ts` 登录与角色校验；`lib/bd-scope.ts` BD 数据隔离；`worker.ts` Worker 入口；`tools/daily-operations/` 日常入口；`tools/*-daily-pipeline/` 计算与同步；`google-apps-script/` 私有数据接口；`tests/` 验证。历史调查记录在 `docs/`，以本 README、操作台说明和当前源码为准。

遇到问题：先保留报错窗口，查看 `04-出错时再看/运行记录`；同步不确定先运行“重新核验”。不要把账号明文、同步配置、原始客户数据或含密码的截图发到 GitHub Issue/公开聊天。
