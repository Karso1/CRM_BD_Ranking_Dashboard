# UPay Wallet 每日数据自动处理

这个程序替代人工筛选、VLOOKUP 和 SUMIFS。它会读取后台原始导出，生成每日 Wallet 数据，写入 Google Sheet，再由网站读取；不会修改你原有的手工汇总工作表。

## 历史回填（第一次使用）

当 `total data` 中已放入 1–9 月的所有交易文件、全量用户卡片文件和全量代理关系文件时，双击 `运行历史回填.command`。

程序会从记录中的实际时间字段自动按天分组，输出到 `outputs/history/`：

- `wallet_daily_metrics.csv`：网站未来使用的标准化每日数据。
- `wallet_monthly_metrics.csv`：按月汇总，便于与旧报表对照。
- `wallet_monthly_targets.csv`：从新配置表读取的月总目标，按公开 BD 和 Others 平均分配后同步到网站。
- `transaction_source_coverage.csv`：每一份交易文件覆盖的日期范围。
- `unmapped_master_uids.csv`：有活动但尚未在主映射配置归属的总代 UID。
- `unclassified_card_types.csv`：未识别为虚拟或实体的卡种。

历史回填不会覆盖 Google Sheet 或网站。先以 `wallet_daily_metrics.csv` 和旧日报交叉核对，确认日期口径后才接入自动同步。

## 每日准备

把以下文件放在 `../total data` 文件夹：

1. `代理关系查询-用户代理关系*.xlsx`
2. `金融卡三方 - 用户卡片*.csv`
3. `三方金融卡-交易记录*.csv`
4. `代理关系及月份目标.xlsx`（同在 `total data` 中，作为唯一的归属与目标配置表）

新代理或总代出现时，只需在 `代理关系及月份目标.xlsx` 增加或修改一行。可填写 `总代UID` 或 `上一级UID`：前者按原始关系表的总代匹配，后者按原始关系表的上一级匹配；两者都匹配时总代优先。L 列 `BD` 是允许公开展示的 BD 名单，名单外的内部商务会归入 `Others`，并在代理明细中以 `UPay · 代理商` 标识，不展示真实内部商务名。

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
- `Unmapped relationships`：关系表里找得到、但尚未在配置表中归属的总代或上一级 UID。把需要归属的 UID 加到 `代理关系及月份目标.xlsx`。
- `Unclassified new cards`：当天新开但无法按“虚拟 / 实体”判断的卡，供核对卡种规则。

## 已实现的计算口径

- 注册：关系表中，注册时间等于指定日期且总代 UID 已映射的去重用户数。
- 开卡：用户卡片表中，创建时间等于指定日期的去重用户卡 ID；名称含“虚拟”或“实体”自动分类。
- 净消费：仅统计状态为“已完成”的 `消费`、`ATM 取现`、`退款`；使用 `用户卡流水`，按 `ATM 取现 + 消费 - 退款` 汇总。
- 完整总额：所有符合上述口径的交易都会计入。内部商务和无法匹配的交易均归入 `Others`，不会从总额中消失；为 UID 补齐归属后，会自动归入对应 BD / 代理商。

## 目标数据

交易、注册、开卡和消费已经自动计算。月目标不属于后台原始交易数据，程序会读取 `代理关系及月份目标.xlsx` 的 `月份 / 目标` 总目标，并平均分配给 L 列的所有公开 BD 和 `Others`。例如 6 个公开 BD 时，月目标会分为 7 份。修改该表后，下次双击同步程序即可更新网站。

