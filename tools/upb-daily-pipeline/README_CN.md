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

1. 把最新下载文件放入对应文件夹。开卡文件可以保留多个版本；重复订单按文件名中的年月排序，较新的月份表覆盖旧表，同月则按文件修改时间取最新版本。覆盖选择先于“开卡成功且开卡费大于 0”的统计筛选，因此较新表中的状态/费用变更会替代旧记录。程序不会改动原始文件；若同一份文件内同一订单字段互相冲突，会停止并提示核查。
2. 新代理、合作模式、BD 归属和月份目标，只修改 `BD代理关系目标/BD代理关系.xlsx`。
3. 双击操作台 `01-测试更新/UPB-测试更新.command`，运行共用计算/同步程序并核验测试网站。
4. 确认后运行 `02-正式发布/UPB-正式发布.command` 原样发布测试结果。超时先用 `04-出错时再看/UPB-重新核验.command` 或 `UPB-正式环境重新核验.command`。

不要手动修改 `outputs/history`、`cache` 或 Google Sheet 中以 `DashboardBusiness` 开头的工作表，它们会在下次运行时覆盖。

## 测试环境

`同步测试文件到测试网站.command` 从原始数据快捷入口刷新 Git 忽略的独立 `staging-inputs/`，并写入 staging Google Sheet。沿用已授权的公开测试真实汇总数据设置；Apps Script 环境在写入前严格校验。设置步骤见 [测试环境操作说明](../../docs/STAGING_ENVIRONMENT_CN.md)。

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
