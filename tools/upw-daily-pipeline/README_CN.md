# UPay Wallet 每日数据自动处理

这个程序替代人工筛选、VLOOKUP 和 SUMIFS。它会读取后台原始导出，生成每日 Wallet 数据，写入 Google Sheet，再由网站读取；不会修改你原有的手工汇总工作表。

## 历史回填（第一次使用）

当 `total data` 中已放入 1–9 月的所有交易文件、全量用户卡片文件和全量代理关系文件时，双击 `运行历史回填.command`。

程序会从记录中的实际时间字段自动按天分组，输出到 `outputs/history/`：

- `wallet_daily_metrics.csv`：网站未来使用的标准化每日数据。
- `wallet_monthly_metrics.csv`：按月汇总，便于与旧报表对照。
- `wallet_monthly_targets.csv`：从原工作簿各月份“汇总”页读取的 BD 月目标，会同步到网站。
- `transaction_source_coverage.csv`：每一份交易文件覆盖的日期范围。
- `unmapped_master_uids.csv`：有活动但尚未在主映射配置归属的总代 UID。
- `unclassified_card_types.csv`：未识别为虚拟或实体的卡种。

历史回填不会覆盖 Google Sheet 或网站。先以 `wallet_daily_metrics.csv` 和旧日报交叉核对，确认日期口径后才接入自动同步。

## 每日准备

把以下文件放在 `../total data` 文件夹：

1. `代理关系查询-用户代理关系*.xlsx`
2. `金融卡三方 - 用户卡片*.csv`
3. `三方金融卡-交易记录*.csv`
4. `UW每日数据.xlsx`（程序仅读取其中 `代理商明细 ` 工作表作为“总代 UID → BD / 代理商”的主映射表）

新代理或总代出现时，只需在 `代理商明细 ` 增加一行：`总代UID`、`商务`、`代理商`。不再需要逐个给新注册用户填 BD 和代理商。没有新归属时，无需修改这个表。

## 第一次安装

在 Terminal 运行：

```bash
cd ~/Desktop/upay/UPW每日数据/upw-daily-pipeline
python3 -m pip install -r requirements.txt
```

## 每日运行、同步 Google Sheet 与网站

日常只需双击 `同步到GoogleSheet.command`。不要关闭终端，看到“完成”后再刷新网站。

它会先全量重算 `total data`，再把 `wallet_daily_metrics.csv` 和 `wallet_monthly_targets.csv` 写到 Google Sheet 的专用工作表。网站只读取这些专用表，不会修改你原有的月度汇总或公式工作表。

不要手动编辑 `outputs/history` 或 `DashboardWalletDaily`；两者都会在下次运行时被覆盖。不要删除 `sync.local.json`，它是本机私密同步设置。

## 输出说明

- `Daily summary`：可直接替代“代理日汇总”的每日 BD / 代理指标。
- `Mapped users`：所有匹配到总代关系的用户及其卡数、当天净消费，便于追溯。
- `Matched transactions`：进入统计的完成交易明细。
- `Unmapped relationships`：关系表里找得到，但尚未配置 BD / 代理商的总代 UID。把需要归属的总代加到 `代理商明细 `。
- `Unclassified new cards`：当天新开但无法按“虚拟 / 实体”判断的卡，供核对卡种规则。

## 已实现的计算口径

- 注册：关系表中，注册时间等于指定日期且总代 UID 已映射的去重用户数。
- 开卡：用户卡片表中，创建时间等于指定日期的去重用户卡 ID；名称含“虚拟”或“实体”自动分类。
- 净消费：仅统计状态为“已完成”的 `消费`、`ATM 取现`、`退款`；使用 `用户卡流水`，按 `ATM 取现 + 消费 - 退款` 汇总。
- 完整总额：所有符合上述口径的交易都会计入。无法从总代 UID 映射到 BD 的交易会显示为 `Others / Unassigned`，不会再从总额中消失；为该总代补齐主映射后，会自动归入对应 BD / 代理商。

## 目标数据

交易、注册、开卡和消费已经自动计算。月目标不属于后台原始交易数据，程序会读取 `UW每日数据.xlsx` 对应月份的汇总页（如 9 月的 `汇总9`）。修改该汇总页中的目标后，下次双击同步程序即可更新网站。

