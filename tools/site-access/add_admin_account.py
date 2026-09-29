"""Add a second full-access administrator to the staging Worker only."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RECORD = ROOT / "tools/daily-operations/01-测试更新/其他管理员账号.local.txt"
BD_RECORD = ROOT / "tools/daily-operations/01-测试更新/BD账号.local.txt"
PRIMARY_RECORD = ROOT / "tools/daily-operations/01-测试更新/测试网站访问密码.local.txt"
CONFIG = ROOT / "tools/site-access/staging.wrangler.jsonc"


def main():
    parser = argparse.ArgumentParser(description="新增或修改测试站其他管理员账号")
    parser.add_argument("--edit", action="store_true")
    args = parser.parse_args()
    accounts = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else []
    if not isinstance(accounts, list) or (len(accounts) >= 20 and not args.edit) or any(
      not isinstance(item, dict) or not all(isinstance(item.get(key), str) and item[key]
      for key in ("username", "password")) for item in accounts):
        raise ValueError("本机管理员账号记录格式异常或达到 20 个上限，已停止。")
    if args.edit:
        if not accounts:
            raise ValueError("本机没有其他管理员账号记录。")
        print("当前其他管理员账号：" + "、".join(item["username"] for item in accounts))
        selected = input("请输入要修改的当前用户名（只有一个时可直接回车）：").strip() or (accounts[0]["username"] if len(accounts) == 1 else "")
        current = next((item for item in accounts if item["username"].casefold() == selected.casefold()), None)
        if not current:
            raise ValueError("未找到该管理员账号；没有修改任何内容。")
        username = input(f"请输入新用户名（直接回车保留 {current['username']}）：").strip() or current["username"]
    else:
        print("新增测试站管理员：将拥有与 UPay 主管理员相同的完整数据和页面权限。")
        current = None
        username = input("请输入新管理员用户名：").strip()
    if not username or len(username) > 128 or any(ord(char) < 32 for char in username):
        raise ValueError("用户名无效。")
    primary = next((line.split("：", 1)[1] for line in PRIMARY_RECORD.read_text(encoding="utf-8").splitlines()
      if line.startswith("用户名：")), "upay") if PRIMARY_RECORD.exists() else "upay"
    bd_accounts = json.loads(BD_RECORD.read_text(encoding="utf-8")) if BD_RECORD.exists() else []
    if not isinstance(bd_accounts, list):
        raise ValueError("本机 BD 账号记录格式异常，已停止。")
    used_names = [primary, *(item["username"] for item in bd_accounts),
                  *(item["username"] for item in accounts if item is not current)]
    if username.casefold() in {name.casefold() for name in used_names}:
        raise ValueError("用户名已被管理员或 BD 账号使用。")
    password = getpass.getpass("请输入密码（至少 12 位，输入时不显示）：")
    if not 12 <= len(password) <= 128 or password != password.strip() or "\n" in password or "\r" in password:
        raise ValueError("密码需要 12–128 位，首尾不能有空格，不能包含换行。")
    if password != getpass.getpass("请再次输入密码："):
        raise ValueError("两次输入不一致，没有新增账号。")
    next_accounts = [item for item in accounts if item is not current] + [{"username": username, "password": password}]
    cli = ROOT / "node_modules/.bin/wrangler"
    if not cli.exists():
        raise ValueError("未找到项目部署工具。")
    environment = {**os.environ, "WRANGLER_LOG_PATH": str(ROOT / ".wrangler/logs"),
                   "WRANGLER_WRITE_LOGS": "false", "WRANGLER_SEND_METRICS": "false"}
    print("正在保存测试站管理员账号…", flush=True)
    result = subprocess.run([str(cli), "secret", "bulk", "--name", "upay-bd-ranking-staging", "--config", str(CONFIG)],
                            input=json.dumps({"DASHBOARD_ADDITIONAL_ADMINS": json.dumps(next_accounts)}),
                            text=True, cwd=ROOT, env=environment)
    if result.returncode:
        raise ValueError("Cloudflare 未确认配置成功。本机账号记录未修改。")
    descriptor, temporary = tempfile.mkstemp(dir=RECORD.parent, prefix=".admin-account-", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(next_accounts, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, RECORD)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"账号已保存在本机：{RECORD}")
    print("正在确认新管理员可以登录…", flush=True)
    check = subprocess.run(["node", str(ROOT / "tools/site-access/check_password.mjs"), "staging"],
                           input=json.dumps({"username": username, "password": password}),
                           text=True, cwd=ROOT, env=environment)
    if check.returncode:
        raise ValueError("账号已保存，但暂未确认网站生效。请稍后用本机记录测试，不要重复新增。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyboardInterrupt, EOFError) as error:
        raise SystemExit(f"未完成：{error}") from None
