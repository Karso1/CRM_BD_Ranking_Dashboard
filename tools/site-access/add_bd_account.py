"""Create or rotate one staging BD account; never print passwords or pass them in argv."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RECORD = ROOT / "tools/daily-operations/01-测试更新/BD账号.local.txt"
CONFIG = ROOT / "tools/site-access/staging.wrangler.jsonc"


def main():
    parser = argparse.ArgumentParser(description="设置测试站 BD 账号")
    parser.add_argument("--username", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--rotate", action="store_true")
    args = parser.parse_args()
    username, owner = args.username.strip(), args.owner.strip()
    if not username or len(username) > 128 or not owner or len(owner) > 128 or any(ord(char) < 32 for char in username + owner):
        raise ValueError("用户名或 BD 名称无效。")
    if username.casefold() == "upay":
        raise ValueError("UPay 是管理员账号，不能设为 BD 账号。")
    accounts = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else []
    if not isinstance(accounts, list) or any(not isinstance(account, dict) for account in accounts):
        raise ValueError("本机 BD 账号记录格式异常，已停止以防覆盖。")
    current = next((account for account in accounts if account["username"].casefold() == username.casefold()), None)
    if current and not args.rotate:
        raise ValueError("账号已存在；如需重置密码，请使用 --rotate。")
    password = secrets.token_urlsafe(18)
    new_account = {"username": username, "password": password, "owner": owner}
    next_accounts = [account for account in accounts if account["username"].casefold() != username.casefold()] + [new_account]
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
    descriptor = os.open(RECORD, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(next_accounts, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(f"账号已保存在本机：{RECORD}")
    print("密码不会显示在窗口或上传 GitHub；请在本机文件中查看并妥善告知本人。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyboardInterrupt) as error:
        raise SystemExit(f"未完成：{error}") from None
