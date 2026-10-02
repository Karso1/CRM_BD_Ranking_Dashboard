# UPay Operations Platform｜项目总览与交接说明

[English](README.en.md) · [正式站](https://upaydashboard.com/) · [测试站](https://staging.upaydashboard.com/)

本说明按 **2026-10-02** 的仓库代码与现行操作台整理。它是项目地图，不是财务审计、安全渗透测试或线上资源清单的自动备份；涉及实际账号、密钥、表格 ID 的私密值不在 GitHub。

本项目把 **UP Business（UPB）** 和 **UPay Wallet（UPW）** 的后台导出整理成登录后可用的运营看板：按月份/日期区间和 BD 筛选，查看趋势、BD 贡献、BD/代理/API 排名、活跃度与代理资料。排名表有不参与排名的汇总行。**主管理员**可导出与当前筛选一致的 Excel；其他管理员与 BD 账号不能使用这一导出入口。BD 账号只接收服务端裁剪后的所属 BD 数据。

它目前是“**本地文件计算 + 云端汇总读取 + 受控展示**”的系统，不是在线 CRM 主数据录入系统，也不是财务结算账本。KYB 审批、客户生命周期状态和多人协作写入仍是未来功能。

> 日常数据更新、网站代码发布、账号管理是三种不同操作。平时更新数据**不需要**改代码、推送 GitHub 或重新部署网站。

## 日常怎么用

统一操作台在 [`tools/daily-operations/`](tools/daily-operations/00-先看这里.md)。按所更新的平台执行：

1. 把新的后台导出放进 `03-原始数据` 对应的 UPB/UPW 目录；若代理归属、合作模式或目标发生变化，先改相应 Excel 关系表。
2. 在 `01-测试更新` 双击 `UPB-测试更新.command` 或 `UPW-测试更新.command`，等待“云端和网站数据均已通过验收”。
3. 登录[测试站](https://staging.upaydashboard.com/)核对日期、金额、卡数、归属与代理资料。
4. 确认无误后，在 `02-正式发布` 双击同平台的正式发布程序，再核对[正式站](https://upaydashboard.com/)。正式发布会校验测试成功记录、代码版本与输出哈希，并发布已验收的 CSV，不重新计算。

两个平台分别更新；测试站运行成功**不会**自动更新正式站。如果同步结果不确定，先用 `04-出错时再看` 中同平台、同环境的“重新核验”入口；它不重新计算或重复上传。错误日志也在那里。不要在报错后盲目重跑正式发布。

详细手册：[UPB](docs/BUSINESS_DAILY_WORKFLOW_CN.md) · [UPW](docs/WALLET_DAILY_WORKFLOW_CN.md) · [操作台](tools/daily-operations/00-先看这里.md)

## 数据从哪里来（项目的“知识库”）

| 位置 / 组件 | 保存什么、谁维护 | 日常是否手改 |
| --- | --- | --- |
| 原始导出目录（通过 `03-原始数据` 进入） | 后台导出的开卡、充值、消费、代理关系、用户卡片和交易记录；保留在本机 Desktop 目录，操作台入口是符号链接 | 放入新导出；原则上保留原件。确需修正旧行时先备份、记录和复核，不要无痕覆盖 |
| UPB `BD代理关系目标/BD代理关系.xlsx` | 客户/代理、类别、合作模式、BD 归属、邮箱、合作时间、月份目标与允许展示的 BD 名单 | 关系或目标变化时改 |
| UPW `total data/代理关系及月份目标.xlsx` | 总代 UID / 上一级 UID 归属、代理、BD、邮箱、合作时间、月份目标与允许展示的 BD 名单 | 关系或目标变化时改 |
| 本仓库 `tools/upb-daily-pipeline/`、`tools/upw-daily-pipeline/` | Python 计算、归属与聚合规则；`tools/daily-operations/90-系统维护/pipeline.py` 统一调度 | 日常不改；代码变更需先在测试站验收 |
| Google Sheets | 正式与测试各自独立的私有汇总数据库；`DashboardBusinessDaily`、`DashboardWalletDaily` 等程序专用页由同步程序写入 | 不手改程序页 |
| Google Apps Script | 私有表格的受密钥保护接口；正式与测试各有项目/密钥。核心源码在 `google-apps-script/` | 仅接口代码变更时部署，不随每日 CSV 自动部署 |
| Cloudflare Workers + KV | 两个登录站点及各自的最新已验收快照；Worker 从服务端读取汇总，不把接口密钥交给浏览器 | 日常无需部署；网站代码变更需分别发布 |
| Cloudflare Secrets + 本机 `*.local.txt` / `sync*.local.json` | 网站账号、会话密钥、同步密钥与私有连接配置；测试、正式分开 | 只通过账号菜单或维护流程管理；**不提交 Git** |
| GitHub | 网站、计算程序、Apps Script 源码、测试和文档的版本历史 | 代码发布时推送；不是业务数据库，也不包含原始表格与私密配置 |

数据路径：`后台导出 + 关系/目标 Excel → 本地 Python 计算 → 对应环境的 Google Sheet → Apps Script 读回核验 → 对应环境的 Worker KV 快照 → 登录后的网站`。网站先读取已发布快照，后台更新完成后再显示新数据，不让每个访客都等待 Google Sheets 冷启动。浏览器不持有原始订单、卡号、完整 UID 或同步密钥。

### 两个平台的关键口径

- **UPB**：合并开卡、手动开卡映射、充值及 Passto/Reap/StraitsX 消费；按合作模式计算总金额，并单列充值/消费口径。Passto HKD 交易使用按日历史汇率。跨文件开卡订单按文件账期和版本去重；**同一文件内状态冲突仍会停机**，不能自动断言后面的行一定正确。公开 BD 名单外的内部归属显示为 `UPay`。
- **UPW**：按上一级 UID 优先、总代 UID 兜底匹配代理与 BD，统计完成状态下的净消费、注册和卡数；公开 BD 名单外的归属显示为 `UPay`。特定 UID 归属例外见[说明](docs/UPW归属例外说明.md)。
- 两个平台都从关系表同步代理/API 资料，包括邮箱和合作开始时间；表中已有但业绩为 0 的代理仍可展示。UPB 有 BD、总体（代理+API）、代理和 API 榜；UPW 有 BD、总体和代理榜。汇总随筛选变化，不占用名次。活跃度基于最近 30 天正消费记录，详见[活跃度说明](docs/ACTIVITY_AND_REFRESH_2026-09-27_CN.md)。具体资料合并规则见[代理资料说明](docs/agent-profiles.md)。月目标来自各自的关系/目标 Excel，不来自交易导出。

## 测试、正式与权限

| 项目 | 测试 | 正式 |
| --- | --- | --- |
| **访问域名** | **[staging.upaydashboard.com](https://staging.upaydashboard.com/)** | **[upaydashboard.com](https://upaydashboard.com/)** |
| Worker 名称 | `upay-bd-ranking-staging` | `upay-bd-ranking` |
| 技术备用地址 | `upay-bd-ranking-staging.karsol.workers.dev` | `upay-bd-ranking.karsol.workers.dev` |
| Google Sheet、Apps Script、KV | 独立测试资源 | 独立正式资源 |
| 本地输入与输出 | 测试输入副本、`outputs/staging` | 已验收结果发布到正式输出 |
| 账号管理 | `01-测试更新/账号管理.command` | `02-正式发布/账号管理.command` |

**只购买了一个根域名 `upaydashboard.com`**；`staging.upaydashboard.com` 是这个域名下配置的子域名，无需再买第二个域名。上述两组地址在 2026-10-02 均可访问登录页；购买域名不等于购买/隔离数据库，也不自动改变 Worker 的安全边界。日常分享应使用自有域名，`workers.dev` 地址留作排障入口。域名续费、DNS 与 Worker Custom Domain 的账号权限应纳入交接。

账号菜单可查看本机记录、增加或修改管理员/BD 账号。主管理员和其他管理员均可看两个平台完整数据，但**只有主管理员可用 Excel 导出**；BD 的页面布局相同，数据接口在 Worker 端按绑定的 BD 裁剪，不能读取其他 BD 的数据，也不能发布数据。密码在 Cloudflare Secret 中校验，不在前端判断。登录后使用有期限的安全 Cookie，登录尝试受限速保护。两个环境最初复制了账号配置，之后**各自修改、互不自动同步**。本机查看菜单中的明文密码需要再次确认；本机记录不是 Cloudflare 的实时密码查询。详见[账号与权限](docs/BD账号测试说明.md)及[密码说明](docs/网站访问密码说明.md)。

## 涉及的知识点与代码位置

| 领域 | 本项目如何使用 | 关键位置 |
| --- | --- | --- |
| 数据工程 / ETL | Excel/CSV 输入、客户/UID 归属、订单去重、汇率换算、每日与月度聚合、源文件覆盖审计 | `tools/upb-daily-pipeline/`、`tools/upw-daily-pipeline/` |
| 发布与数据质量 | 测试批次成功凭据、代码摘要与文件哈希、读回逐日/归属核验、正式发布前防误写、失败后的仅核验 | `tools/daily-operations/90-系统维护/`、`tests/` |
| 云端数据接口 | Google Sheets 作为汇总存储，Apps Script Web App 读写；正式和测试资源分开 | `google-apps-script/` |
| Web 与边缘计算 | React/TypeScript 看板、Worker API、KV 已验收快照、缓存与异步刷新 | `app/`、`worker.ts`、`vite.config.ts` |
| 身份与数据权限 | 登录、会话 Cookie、限速、管理员/BD 角色、服务端 BD 范围裁剪、导出权限 | `lib/site-access.ts`、`lib/bd-scope.ts`、`worker.ts` |
| 报表与可视化 | 趋势、贡献、排名、活跃度、筛选汇总和主管理员 Excel 导出 | `app/page.tsx`、`lib/agent-activity.ts`、`lib/xlsx-export.ts` |
| 域名、交付与恢复 | DNS/Custom Domain、测试与正式 Worker、Git 版本、运行日志及本地备份 | `vite.config.ts`、`tools/daily-operations/`、GitHub |

仓库中的 `db/`、`drizzle/` 是项目脚手架文件；当前运营数据的实际存储链路是 **Google Sheets + Worker KV**，不要误以为已部署了可接管业务数据的 D1 数据库。

## 三类变更，走三条流程

| 要改什么 | 正确做法 |
| --- | --- |
| 每日业务数据、代理关系、目标 | 更新原始文件/关系表 → 测试程序 → 网站验收 → 同平台正式发布程序；不需要 GitHub 或网站部署 |
| 网站界面、计算/归属规则、Apps Script 接口 | 改本仓库源码并运行测试 → 部署/运行测试环境验收 → 获得确认后发布对应正式代码；再按需要重新运行数据管线；最后推送 GitHub |
| 用户名、密码、管理员或 BD 权限 | 用相应环境的 `账号管理.command`；它更新该 Worker 的 Secret，不重算业务数据，也不会自动修改另一个环境 |

计算程序对测试输出保存成功记录、代码摘要和文件哈希；代码或输出在验收后变化会阻止正式发布。上传响应超时/502 时会优先读回核对，不自动重复 POST。测试与正式资源不可互换；不要复制同步密钥、Sheet ID 或 Apps Script 地址到另一环境。

## 已有防护与仍需关注的隐患

以下是维护清单，不表示每项都已造成线上错误；先保留现有隔离、登录、哈希验收和快照，再按风险逐步改进。旧的 [2026-09-24 审查记录](docs/PROJECT_REVIEW_2026-09-24_CN.md)属于历史快照，其中关于公开访问、状态和导出的描述已被后续功能替代，不能直接当作当前现状。

| 优先级 | 隐患 / 当前边界 | 建议 |
| --- | --- | --- |
| 高 | **原始数据、关系表、同步配置和部分账号记录仍依赖维护者本机**；GitHub 只有源码。电脑损坏或离职时，单靠 `git clone` 无法重建日常同步 | 建立加密、可授权恢复的原始数据与配置备份；记录 Cloudflare/Google/域名管理权属；用另一台机器演练恢复 |
| 高 | **Google Sheet 多个程序页依次清空再写入，不是原子事务**。虽然有环境锁、读回验收与本地正式输出备份，中途失败仍可能让云端短暂或持续处于不完整批次；代码回滚不等于数据回滚 | 采用批次表/版本指针，全部写完且验收后才切换“当前版本”；保留并定期演练回退 |
| 高 | **数据正确性依赖源文件质量**。跨文件开卡去重已有规则，但同一文件内相同订单的状态冲突会停止计算；缺失渠道文件、UID/代理映射变化、退款、时区日切与目标口径需要独立对账。2026-10-01 的同文件重复行经备份后手工修正，程序规则尚未自动扩展 | 增加必需文件/日期覆盖清单、重复订单差异报告及独立金额/张数对账；只有能可靠判定新旧时才自动去重，不静默删原始记录 |
| 中 | **账号秘密与权限交接**：Worker Secret 保护线上密码，但本机账号记录可显示明文，且不是线上实时真值；增减账号尚依赖桌面菜单。测试站同样是真实运营汇总数据 | 对本机记录做加密或迁移到受控密钥库，建立账号发放/撤销与定期权限复核；测试账号和真实数据按同等敏感级别管理 |
| 中 | **可观测性和发布自动化不完整**：有本地日志和 Worker 基本日志，但仓库未配置 CI 检查、数据延迟告警或 Worker 分布式 traces；日常运行仍需人工操作 | 在 GitHub CI 跑现有测试/构建；按“数据截止日、同步失败、接口 5xx、KV 快照年龄”告警；配置受控的结构化日志与 traces |
| 中 | **业务口径可能随关系表改动而重算历史**，而当前看板是运营参考，非财务账；个人目标、活跃度阈值和汇率使用方式需有明确业务所有者 | 明确“当时归属”还是“现归属追溯”，为关系与合作模式加生效日期；把指标定义、异常审批和月度对账记录下来 |
| 低 | 看板页面与计算逻辑仍较集中，历史全量 Excel 重算会随文件增长而变慢 | 先量测耗时和包体，再拆分组件、做可失效的增量计算；不要在缺少回归测试时直接重构 |

**安全边界**：登录保护的是页面、静态资源与数据 API，不是“只隐藏前端按钮”。但任何被授权的账号都能看到其权限内的数据；域名和密码无法代替账号回收、备份加密或访问审计。不要向公开渠道发送带密码的截图、邮箱清单或客户原始记录。

## 下一阶段怎么做

1. **先解决可交接性**：制作不含明文秘密的资产清单（域名注册商、Cloudflare 账号与两个 Worker/KV、两个 Google Sheet/Apps Script、备份位置、负责人），保存到受控公司空间；为接手人提供最低权限，做一次“新电脑从零运行测试站”的演练。
2. **再补数据可靠性**：定义批次 ID、来源清单、独立对账、原子发布与回滚，自动检测过期数据。达成后再考虑无人值守的每日计划任务；自动化不能跳过测试验收或异常复核。
3. **最后扩展业务模块**：先梳理客户主键、KYB 阶段、责任人、资料类型、权限和状态流转。若开始多人在线编辑、审批与附件管理，再评估数据库和私有对象存储；不要把 KYB 附件直接放到当前静态站或公开测试资料里。

这些是**建议**，不是已上线功能，也不要求立即从 Google Sheets 迁走。当前单人维护的看板仍可继续按现有测试→正式流程使用。

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

`npm run apps-script:build` 只生成测试用 Apps Script 源码，不会部署 Google 项目；接口部署见 [`google-apps-script/README.md`](google-apps-script/README.md)。部署命令发布的是**网站代码**，不是每日业务数据。不要把生成的 `outputs/`、`dist/`、`.env*`、`*.local.txt`、`sync*.local.json`、原始 Excel/CSV、备份或密钥提交到 Git。更新文档/代码并推送 GitHub，也**不会**自动更新网站或业务数据。

重要目录：`app/` 页面与 API；`lib/site-access.ts` 登录与角色校验；`lib/bd-scope.ts` BD 数据隔离；`worker.ts` Worker 入口；`tools/daily-operations/` 日常入口；`tools/*-daily-pipeline/` 计算与同步；`google-apps-script/` 私有数据接口；`tests/` 验证。历史调查记录在 `docs/`，以本 README、操作台说明和当前源码为准。

遇到问题：先保留报错窗口，查看 `04-出错时再看/运行记录`；同步不确定先运行“重新核验”。不要把账号明文、同步配置、原始客户数据或含密码的截图发到 GitHub Issue/公开聊天。
