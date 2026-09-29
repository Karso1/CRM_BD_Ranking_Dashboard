"""Create or rotate one staging BD account; never print passwords or pass them in argv."""
import argparse
import getpass
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RECORD = ROOT / "tools/daily-operations/01-测试更新/BD账号.local.txt"
CONFIG = ROOT / "tools/site-access/staging.wrangler.jsonc"


def main():
    parser = argparse.ArgumentParser(description="设置测试站 BD 账号")
    parser.add_argument("--username")
    parser.add_argument("--owner")
    parser.add_argument("--rotate", action="store_true")
    parser.add_argument("--edit", action="store_true", help="交互式修改现有 BD 账号的用户名和密码")
    args = parser.parse_args()
    if args.edit and (args.rotate or args.username or args.owner):
        raise ValueError("交互式修改不能与新增/重置参数同时使用。")
    accounts = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else []
    if not isinstance(accounts, list) or any(not isinstance(account, dict) or
      not all(isinstance(account.get(key), str) and account[key] for key in ("username", "password", "owner")) for account in accounts):
        raise ValueError("本机 BD 账号记录格式异常，已停止以防覆盖。")
    if args.edit:
        if not accounts:
            raise ValueError("本机没有 BD 账号记录，无法修改。")
        print("当前 BD 账号：" + "、".join(account["username"] for account in accounts))
        selected = input("请输入要修改的当前用户名（只有一个账号时可直接回车）：").strip() or (accounts[0]["username"] if len(accounts) == 1 else "")
        current = next((account for account in accounts if account["username"].casefold() == selected.casefold()), None)
        if not current:
            raise ValueError("未找到该 BD 账号；没有修改任何内容。")
        owner = current["owner"]
        username = input(f"请输入新用户名（直接回车保留 {current['username']}）：").strip() or current["username"]
        password = getpass.getpass("请输入新密码（至少 12 位，输入时不显示）：")
        if not 12 <= len(password) <= 128 or password != password.strip() or "\n" in password or "\r" in password:
            raise ValueError("密码需要 12–128 位，首尾不能有空格，不能包含换行。")
        if password != getpass.getpass("请再次输入新密码："):
            raise ValueError("两次输入不一致，没有修改任何内容。")
    else:
        if not args.username or not args.owner:
            raise ValueError("新增账号需要 --username 和 --owner。")
        username, owner = args.username.strip(), args.owner.strip()
        current = next((account for account in accounts if account["username"].casefold() == username.casefold()), None)
        if current and not args.rotate:
            raise ValueError("账号已存在；如需重置密码，请使用 --rotate。")
        password = secrets.token_urlsafe(18)
    if not username or len(username) > 128 or not owner or len(owner) > 128 or any(ord(char) < 32 for char in username + owner):
        raise ValueError("用户名或 BD 名称无效。")
    admin_record = ROOT / "tools/daily-operations/01-测试更新/测试网站访问密码.local.txt"
    admin_name = next((line.split("：", 1)[1] for line in admin_record.read_text(encoding="utf-8").splitlines()
      if line.startswith("用户名：")), "upay") if admin_record.exists() else "upay"
    if username.casefold() == admin_name.casefold():
        raise ValueError("不能与 UPay 管理员用户名相同。")
    if any(account is not current and account["username"].casefold() == username.casefold() for account in accounts):
        raise ValueError("该用户名已被其他 BD 使用。")
    new_account = {"username": username, "password": password, "owner": owner}
    next_accounts = [account for account in accounts if account is not current] + [new_account]
    cli = ROOT / "node_modules/.bin/wrangler"
    if not cli.exists():
        raise ValueError("未找到项目部署工具。")
    environment = {**os.environ, "WRANGLER_LOG_PATH": str(ROOT / ".wrangler/logs"),
                   "WRANGLER_WRITE_LOGS": "false", "WRANGLER_SEND_METRICS": "false"}
    print("正在配置测试站 BD 账号…", flush=True)
    result = subprocess.run([str(cli), "secret", "bulk", "--name", "upay-bd-ranking-staging", "--config", str(CONFIG)],
                            input=json.dumps({"DASHBOARD_BD_ACCOUNTS": json.dumps(next_accounts)}), text=True, cwd=ROOT, env=environment)
    if result.returncode:
        raise ValueError("Cloudflare 未确认配置成功。本机账号记录未修改。")
    descriptor, temporary = tempfile.mkstemp(dir=RECORD.parent, prefix=".bd-account-", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(next_accounts, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, RECORD)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"账号已保存在本机：{RECORD}")
    print("密码不会显示在窗口或上传 GitHub；请在本机文件中查看并妥善告知本人。")
    if args.edit:
        print("正在确认测试网站已接受新账号和密码…", flush=True)
        check = subprocess.run(["node", str(ROOT / "tools/site-access/check_password.mjs"), "staging"],
                               input=json.dumps({"username": username, "password": password}), text=True, cwd=ROOT, env=environment)
        if check.returncode:
            raise ValueError("密码已保存，但暂未确认网站生效。请稍后使用本机记录测试，不要重复修改。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyboardInterrupt) as error:
        raise SystemExit(f"未完成：{error}") from None
