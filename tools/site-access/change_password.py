"""Manage site credentials without printing secrets or passing them in argv."""
import argparse
import getpass
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STAGING_FILE = ROOT / "tools/daily-operations/01-测试更新/测试网站访问密码.local.txt"
PRODUCTION_FILE = ROOT / "tools/daily-operations/02-正式发布/正式网站访问密码.local.txt"


def main():
    parser = argparse.ArgumentParser(description="修改测试网站的共用用户名和密码")
    parser.add_argument("--environment", choices=["staging", "production"], default="staging")
    parser.add_argument("--initialize", action="store_true", help="首次配置：生成随机密码和独立会话密钥")
    parser.add_argument("--add-username", action="store_true", help="升级已有密码入口，保留密码并添加用户名")
    parser.add_argument("--copy-staging", action="store_true", help="首次正式发布：复制测试站账户，使用独立会话密钥")
    args = parser.parse_args()
    production = args.environment == "production"
    worker = "upay-bd-ranking" + ("" if production else "-staging")
    config = ROOT / f"tools/site-access/{args.environment}.wrangler.jsonc"
    password_file = PRODUCTION_FILE if production else STAGING_FILE
    if args.copy_staging and (not production or args.initialize or args.add_username or password_file.exists()):
        raise ValueError("复制测试站账户仅用于正式环境首次配置。")
    print(f"网站：{worker}.karsol.workers.dev（{'正式' if production else '测试'}环境）", flush=True)
    previous = {}
    if password_file.exists():
        previous = dict(line.split("：", 1) for line in password_file.read_text(encoding="utf-8").splitlines() if "：" in line)
    if args.copy_staging:
        if not STAGING_FILE.exists():
            raise ValueError("找不到测试站本机密码记录。")
        previous = dict(line.split("：", 1) for line in STAGING_FILE.read_text(encoding="utf-8").splitlines() if "：" in line)
    username = previous.get("用户名", "upay") if args.copy_staging else input(f"请输入用户名（直接回车保留 {previous.get('用户名', 'upay')}）：").strip() or previous.get("用户名", "upay")
    if len(username.encode("utf-16-le")) // 2 > 128 or any(ord(c) < 32 for c in username):
        raise ValueError("用户名最长 128 位，不能包含控制字符。")
    if not production:
        bd_record = ROOT / "tools/daily-operations/01-测试更新/BD账号.local.txt"
        if bd_record.exists() and any(account["username"].casefold() == username.casefold()
          for account in json.loads(bd_record.read_text(encoding="utf-8"))):
            raise ValueError("管理员用户名不能与已有 BD 账号相同。")
        other_admin_record = ROOT / "tools/daily-operations/01-测试更新/其他管理员账号.local.txt"
        if other_admin_record.exists() and any(account["username"].casefold() == username.casefold()
          for account in json.loads(other_admin_record.read_text(encoding="utf-8"))):
            raise ValueError("UPay 主管理员用户名不能与其他管理员账号相同。")
    if args.copy_staging:
        password = previous.get("访问密码")
        if not password:
            raise ValueError("测试站密码记录不完整。")
    elif args.add_username:
        password = previous.get("访问密码")
        if not password:
            raise ValueError("没有本机密码记录，无法保留原密码。")
    elif args.initialize:
        if password_file.exists():
            raise ValueError("本地已有密码记录，请直接运行修改入口，不要重复初始化。")
        password = secrets.token_urlsafe(18)
    else:
        password = getpass.getpass("请输入新密码（至少 12 位，输入时不显示）：")
        if not 12 <= len(password) <= 128 or len(password.encode("utf-16-le")) // 2 > 128 or password != password.strip() or "\n" in password or "\r" in password:
            raise ValueError("密码需要 12–128 位，首尾不能有空格，不能包含换行。")
        if password != getpass.getpass("请再次输入新密码："):
            raise ValueError("两次输入不一致，密码没有修改。")
    cli = ROOT / "node_modules/.bin/wrangler"
    if not cli.exists():
        raise ValueError("未找到项目部署工具，请联系维护者。")
    environment = {**os.environ, "WRANGLER_LOG_PATH": str(ROOT / ".wrangler/logs"),
                   "WRANGLER_WRITE_LOGS": "false", "WRANGLER_SEND_METRICS": "false"}
    command = [str(cli), "secret", "bulk"]
    credentials = {"DASHBOARD_USERNAME": username, "DASHBOARD_PASSWORD": password}
    if args.initialize or args.copy_staging:
        credentials["DASHBOARD_SESSION_SECRET"] = secrets.token_urlsafe(48)
    secret_input = json.dumps(credentials)
    command += ["--name", worker, "--config", str(config)]
    print("正在保存到 Cloudflare，请稍候…", flush=True)
    result = subprocess.run(command, input=secret_input, text=True, cwd=ROOT, env=environment)
    if result.returncode:
        raise ValueError("Cloudflare 未确认密码更新成功。请保留窗口查看错误，不要反复运行。")
    # This is a user-owned private runtime record, ignored by Git.
    descriptor = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(f"{'正式' if production else '测试'}网站：https://{worker}.karsol.workers.dev\n")
        output.write(f"用户名：{username}\n")
        output.write(f"访问密码：{password}\n\n")
        output.write("本文件仅保存在这台电脑，不会上传 GitHub。请妥善保管。\n")
    print(f"密码已保存。查看密码：{password_file}", flush=True)
    if not args.initialize and not args.add_username and not args.copy_staging:
        print("正在确认网站已接受新密码（通常需要几秒）…", flush=True)
        check = subprocess.run(["node", str(ROOT / "tools/site-access/check_password.mjs"), args.environment],
                               input=json.dumps({"username": username, "password": password}), text=True, cwd=ROOT, env=environment)
        if check.returncode:
            return 1
    print("其他浏览器的旧登录状态将在下一次访问/检查数据时失效，需要输入新密码。")
    print("另一个环境没有修改；日常数据更新程序仍按原流程使用。")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except (ValueError, OSError, KeyboardInterrupt, EOFError) as error:
        print(f"未完成：{error}", file=sys.stderr)
        sys.exit(1)
