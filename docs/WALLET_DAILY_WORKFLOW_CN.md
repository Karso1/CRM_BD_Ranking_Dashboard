# UPay Wallet 每日运行手册

这份手册只说明日常操作。目标是让你不再需要手动筛选卡种、复制 UID、做 VLOOKUP、SUMIFS 或手工汇总日报。

## 先理解三个区域

### 1. `total data`：你每天放新文件的地方

位置：`/Users/admin/Desktop/upay/UPW每日数据/total data`

这里放的是从后台下载的**原始文件**，不是以前做完公式后的大表。程序需要识别三类数据：

| 原始文件 | 用途 | 使用要求 |
| --- | --- | --- |
| 名称包含“代理关系查询”的文件 | 找到用户 UID 对应的总代 UID、注册时间 | 保留一份最新、完整的导出 |
| 名称包含“用户卡片”的文件 | 判断开卡时间、虚拟卡/实体卡 | 保留一份最新、完整的导出 |
| 包含“交易类型”列的交易文件 | 统计每日净消费 | 可有多份历史文件；优先使用不重叠的日期文件或一份完整导出 |

程序会按交易订单号去重；但为了避免同一订单在不同导出中内容不一致，建议不要同时放多份互相覆盖且内容不同的交易文件。

### 2. `代理关系及月份目标.xlsx`：归属与目标配置

位置：`/Users/admin/Desktop/upay/UPW每日数据/total data/代理关系及月份目标.xlsx`。这是目前唯一需要你偶尔人工维护的表，不需要每天重复填。

当新总代 UID、上一级 UID、BD 或代理商归属更换时，新增或修正这一行。填写其中一种 UID 即可：

```text
总代UID 或 上一级UID | 商务（BD） | 代理商
```

程序优先按总代 UID 匹配，找不到时按上一级 UID 匹配。L 列的 BD 名单决定哪些 BD 可公开展示；名单外内部商务与没有归属的数据都归入 `Others`，内部归属会以 `UPay · 代理商` 标识。不要再逐个在“总表 UW 代理下注册用户”中手工写每个用户的归属。

### 3. `upw-daily-pipeline`：程序和结果

位置：`/Users/admin/Desktop/upay/UPW每日数据/upw-daily-pipeline`

- `同步到GoogleSheet.command`：日常唯一需要双击的文件。
- `outputs/history/wallet_daily_metrics.csv`：程序生成的每日结果，用来核对；不要手改。
- `outputs/history/unmapped_master_uids.csv`：发现新 UID 未归属时查看它，并把需要的归属补到 `代理关系及月份目标.xlsx`。
- `sync.local.json`：私密同步设置；不能删除、不能上传 GitHub、不能发给其他人。

## 每日操作：四步

### 第一步：更新后台原始数据

下载今天最新的代理关系、用户卡片、交易记录，放到 `total data`。

如果后台导出是“全量历史数据”，请用最新文件替换旧的全量文件；如果交易记录是按天/按月单独下载，可以继续保留历史交易文件。

### 第二步：检查是否有新的归属关系

只有在出现新总代 UID、上一级 UID 或归属变化时，打开 `代理关系及月份目标.xlsx` 更新配置。

没有新增或变更时，跳过这一步。

### 第三步：双击运行

双击 `同步到GoogleSheet.command`，不要关闭弹出的终端窗口。

程序会：

1. 读取所有原始文件。
2. 按总代 UID 优先、上一级 UID 兜底的规则合并 BD、代理商关系。
3. 按站点卡名称识别虚拟卡和实体卡。
4. 只统计状态为“已完成”的消费、ATM 取现、退款，并按 `ATM 取现 + 消费 - 退款` 计算净消费。
5. 按日期、BD、代理商汇总注册、开卡、消费、交易笔数。
6. 更新 Google Sheet 的 `DashboardWalletDaily` 专用页。
7. 让线上网站下次刷新时读取新结果。

看到“完成：Google Sheet 与网站数据源将在刷新后读取最新 Wallet 数据。”即可。

### 第四步：核对与查看

1. 如当天有新总代理 UID，先看 `outputs/history/unmapped_master_uids.csv` 是否有需要配置的 UID。
2. 打开 <https://upay-bd-ranking.karsol.workers.dev/>。
3. 点击 **UPay Wallet**，再刷新浏览器或点击右上角刷新按钮。
4. 选择日期、周期、BD 或代理商查看数据。

## 你不需要做什么？

- 不需要手动筛选虚拟/实体卡。
- 不需要复制 UID 到子表。
- 不需要做 VLOOKUP、SUMIFS 或代理日汇总。
- 不需要手动上传数据到 Google Sheet。
- 不需要修改 GitHub 或重新部署网站。
- 不要编辑 `DashboardWalletDaily`、`outputs/history` 或 `sync.local.json`。

## 目标（Target）目前如何处理？

目标不是后台原始交易数据。程序会读取 `代理关系及月份目标.xlsx` 的每月总目标，并平均分配给 L 列公开 BD 名单和 `Others`，再在每次同步时更新网站。

日常没有调整目标时，无需处理。要调整某月目标时，只改配置表中对应月份的目标数值，然后重新双击 `同步到GoogleSheet.command`。

## 想看程序怎么计算？

GitHub 中的 [`tools/upw-daily-pipeline`](../tools/upw-daily-pipeline/) 包含 Python 源码和逐段中文说明。重点文件是：

- `backfill_wallet_history.py`：读取原始导出、关联 UID、计算每日数据。
- `sync_wallet_dashboard.py`：把计算结果和目标同步到 Google Sheet。
- `README_CN.md`：输入、输出、计算口径与日常运行方式。

## 如果程序报错

先不要关闭终端窗口，截图发来。最常见原因是：

- 原始文件缺少“代理关系查询”“用户卡片”或交易记录。
- 后台导出改变了列名。
- 新总代 UID 尚未配置 BD/代理商归属。
- 文件正在 Excel 中打开并被锁定。
