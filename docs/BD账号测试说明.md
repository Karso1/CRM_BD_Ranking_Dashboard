# BD 独立账号｜测试环境

测试网址：https://upay-bd-ranking-staging.karsol.workers.dev

目前只在测试站增加了一个 `Katrina` 样板账号。原 `UPay` 管理员账号及完整看板保持不变。正式站尚未启用 BD 独立账号。

## 查看账号

Katrina 的用户名和随机生成的密码仅保存在本机 `tools/daily-operations/01-测试更新/BD账号.local.txt`。该文件是 Git 忽略文件，权限仅限本机用户，不能上传 GitHub。请私下将密码告知本人，不要发到公开群或聊天记录。

建议用无痕窗口或另一浏览器测试 Katrina 账号，以免与当前浏览器保存的 UPay 管理员登录状态混淆。先退出当前账号，再输入 Katrina 用户名和密码。

## Katrina 可以看到什么

Katrina 登录后进入与 UPay 管理员相同布局的看板，保留平台切换、日期筛选、图表、排名、代理详情和浏览器导出。BD 筛选只显示 Katrina；所有金额、目标、趋势、代理及邮箱都来自 Katrina 名下的数据。原有的管理员看板布局不变。

后台从测试站已发布的快照中按原始 `owner=Katrina` 过滤月度、每日、代理资料。可供 BD 账号读取的前端包不再包含完整备用快照；数据接口只返回 Katrina 范围，数据发布接口不可使用。没有发布快照时返回不可用，不会回退为完整数据。

## 后续添加其他 BD

维护者可运行 `python3 tools/site-access/add_bd_account.py --username <用户名> --owner <BD名称>`，为测试站生成独立密码并更新测试 Worker Secret。用户名和 BD 归属必须与业务表核对。重设某个账号密码时使用同一命令加 `--rotate`；密码变化后该账号的旧登录状态失效。

该操作只修改测试站登录信息，不重新计算或发布业务数据。正式站仍需单独验收与授权后才可启用相同机制。
