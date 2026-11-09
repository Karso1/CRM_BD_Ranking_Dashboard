# API 客户 Excel 更新入口（测试站）

桌面操作台 `07-API客户更新` 中，将最新 Lark 原始导出放入 `01-放入最新表格`，双击 `02-更新API客户到测试网站.command`。该入口调用本目录 `update.mjs`，只写入既有测试 KV 的 `crm:api-clients:v1`，不会部署网站或接触正式资源。

程序读取目录中最后修改的 `.xlsx`（忽略 Excel 临时文件），通过现有 UPB Python 环境读取，复用网站 `validateClients` 校验申请编号、必填字段和条数。按申请编号合并更新，保留未出现在本次导出中的旧申请。读取原快照失败时停止。

更新前将旧快照、目标快照及源 Excel 归档在 `.local/<UTC时间>/`，并保存云端上一份快照；写入后仅重试读回核验，不重复提交写入。读回一致后报告成功。`.local` 被 Git 忽略。

```sh
node tools/api-client-update/update.mjs --input-dir '/path/to/exports' --check-only
node tools/api-client-update/update.mjs --input-dir '/path/to/exports'
```

依赖现有 `tools/upb-download/.venv/bin/python` 的 openpyxl、项目 Node 依赖及有权访问测试 KV 的 Cloudflare 本机授权。输入上限 2 MB、5000 条，默认无确认输入；本地校验通过后直接备份并更新测试站。完成后在测试站 API 客户更新页点击刷新。
