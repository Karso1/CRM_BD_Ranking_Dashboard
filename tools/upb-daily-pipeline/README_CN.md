# UP Business 每日数据自动处理

该程序读取 `/Users/admin/Desktop/upay/UPB每日数据` 下的后台原始导出，自动计算 UP Business 看板所需的每日数据，不修改原始 Excel 文件。

## 计算口径

- 开卡数：只统计“开卡成功”且开卡费大于 0 的正常开卡，并区分虚拟卡和实体卡。
- 零开卡费：不计入开卡张数，但卡 ID 仍进入交易归属映射。
- 手动开卡：不计入开卡张数，只用于把卡 ID 映射到代理商。
- 消费金额：Passto、Reap、StraitsX 三个渠道全部纳入；支出为正、收入/退款为负。
- Passto：HKD 按每笔交易日期对应的官方 USD/HKD 历史汇率换算成 USD。数据来源为美联储 H.10（FRED DEXHKUS）；休市日使用最近一个已公布交易日，汇率保存到本地缓存。
- 总金额：充值模式客户的成功充值金额 + 共享模式客户的消费金额。
- 合作模式：配置表中 `合作模式=1` 为共享模式；空白为充值模式。
- BD 脱敏：只有配置表 J 列名单中的 BD 对外展示；其他内部员工和未归属数据统一进入 `UPay`。
- 目标：月总金额目标和月开卡目标平均分给公开 BD 加 `UPay`，最后一份吸收小数舍入差额。

## 你以后每天做什么

1. 把最新下载文件放入对应文件夹。新文件可以覆盖旧的当月累计文件，也可以保留多个版本；程序会按订单号或交易 ID 去重。
2. 新代理、合作模式、BD 归属和月份目标，只修改 `BD代理关系目标/BD代理关系.xlsx`。
3. 双击 `同步UPB到网站.command`。程序会全量重算、同步 Google Sheet，并刷新网站缓存。
4. 查看终端最后是否出现“UPB 计算完成”和“网站缓存已更新”。

不要手动修改 `outputs/history`、`cache` 或 Google Sheet 中以 `DashboardBusiness` 开头的工作表，它们会在下次运行时覆盖。

## 第一次安装

```bash
cd "/Users/admin/Desktop/upay/UPB每日数据/upb-daily-pipeline"
python3 -m pip install -r requirements.txt
```

## 审计文件

- `business_daily_metrics.csv`：网站使用的标准每日数据。
- `business_monthly_metrics.csv`：按月、BD、代理/API 汇总。
- `business_monthly_targets.csv`：目标分配结果。
- `reconciliation_by_month.csv`：月度总量核验。
- `source_coverage.csv`：每个源文件的覆盖日期和有效行数。
- `unmapped_clients.csv`：配置表中尚未登记、已统一计入 UPay 的客户。
- `card_mapping_conflicts.csv`：同一卡 ID 对应多个代理的冲突。
- `fx_rates_used.csv`：Passto 每个交易日实际使用的汇率及对应官方报价日。
- `run_summary.json`：本次运行概况。
