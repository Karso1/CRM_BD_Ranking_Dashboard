# UPay Performance Dashboard｜操作说明

线上看板：<https://upay-bd-ranking.karsol.workers.dev/>

这个项目展示两个平台的数据：

- **UP Business**：由 UPB 本地程序读取开卡、手动开卡、充值和三渠道消费导出，自动计算后同步。
- **UPay Wallet**：由 UPW 本地程序读取后台原始导出，自动计算后同步。

> 两个平台的日常更新都**不需要**改网页代码、上传 GitHub、重新部署 Cloudflare，也不需要手动做 VLOOKUP 或 SUMIFS。

## 今天要做什么？

### UP Business

1. 将最新开卡、手动开卡、充值、Passto、Reap 和 StraitsX 文件放入 `UPB每日数据` 对应文件夹。
2. 新代理、合作模式、BD 关系或月份目标只在 `BD代理关系目标/BD代理关系.xlsx` 更新。
3. 双击 `UPB每日数据/upb-daily-pipeline/同步UPB到网站.command`。
4. 等终端显示“全部完成”，打开看板并切换到 **UP Business**。

完整说明见 [UP Business 每日运行手册](docs/BUSINESS_DAILY_WORKFLOW_CN.md)。

### UPay Wallet

1. 从后台下载最新原始文件，放入本机 `UPW每日数据/total data` 文件夹。
2. 如果出现新总代 UID、上一级 UID 或归属变更，在 `UPW每日数据/total data/代理关系及月份目标.xlsx` 更新配置。
3. 双击 `UPW每日数据/upw-daily-pipeline/同步到GoogleSheet.command`。
4. 等终端显示“完成”，打开并刷新线上看板，切换到 **UPay Wallet** 查看结果。

完整日常操作说明见 [Wallet 每日运行手册](docs/WALLET_DAILY_WORKFLOW_CN.md)。如需查看实际的 Python 计算代码与逐段说明，见 [Wallet 自动计算程序](tools/upw-daily-pipeline/README_CN.md)。

## 数据流是怎样的？

```text
后台原始导出文件
        ↓
本地 UPB / UPW 计算程序
        ↓
Google Sheet：DashboardBusinessDaily / DashboardWalletDaily（程序专用页）
        ↓
Cloudflare Worker（服务器端私密读取）
        ↓
公开的 UPay 排名网站
```

网站访问者看不到原始 UID、卡号、Google Sheet 私密地址或访问密钥。

## 哪些内容可以修改？

| 内容 | 是否手动改 | 什么时候改 |
| --- | --- | --- |
| `UPB每日数据` 各原始数据文件夹 | 是 | 每天下载最新 UPB 数据后 |
| `BD代理关系目标/BD代理关系.xlsx` | 是 | UPB 新代理、模式、BD 或目标变化时 |
| `total data` 的后台原始导出 | 是 | 每天下载最新数据后 |
| `代理关系及月份目标.xlsx` 的总代 UID / 上一级 UID → BD → 代理商关系 | 是 | 新总代、新代理或归属调整时 |
| `outputs/` 里的 CSV | 否 | 程序自动生成，会被覆盖 |
| Google Sheet 的 `DashboardWalletDaily` 页 | 否 | 程序自动写入，会被覆盖 |
| Google Sheet 的 `DashboardBusinessDaily` 页 | 否 | 程序自动写入，会被覆盖 |
| `sync.local.json` | 否 | 本机私密连接配置，不可删除或上传 |
| 网页代码、GitHub、Cloudflare 设置 | 否 | 日常更新无需操作 |

## 目标数据说明

交易、注册、开卡与消费数据已经自动化。程序会从 `代理关系及月份目标.xlsx` 读取每月总目标，再平均分配给公开 BD 与 `UPay` 并同步到网站。

目标不来自后台导出，因此需要时请在配置表的 `月份 / 目标` 列更新总目标。下次日常同步后，完成率、缺口和图表会自动更新。

## 开发说明

项目使用 TypeScript / React，并部署在 Cloudflare Workers。源代码、构建流程和私密变量均已与原始数据隔离；原始 Excel、UID、卡号和密钥不会提交到 GitHub。
