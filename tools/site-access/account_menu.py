"""One simple entry point for staging account management."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RECORD_DIR = ROOT / "tools/daily-operations/01-测试更新"
PRODUCTION_RECORD_DIR = ROOT / "tools/daily-operations/02-正式发布"


def recorded_accounts(record_dir: Path = RECORD_DIR) -> list[dict[str, str]]:
    """Read local records only; Cloudflare never returns secret values."""
    accounts = []
    primary = record_dir / ("正式网站访问密码.local.txt" if record_dir.name == "02-正式发布" else "测试网站访问密码.local.txt")
    if primary.exists():
        fields = dict(line.split("：", 1) for line in primary.read_text(encoding="utf-8").splitlines() if "：" in line)
        if not fields.get("用户名") or not fields.get("访问密码"):
            raise ValueError("UPay 主管理员本机记录不完整，无法列出账号。")
        accounts.append({"username": fields["用户名"], "password": fields["访问密码"], "role": "主管理员", "owner": "全部数据"})
    for filename, role in (("其他管理员账号.local.txt", "管理员"), ("BD账号.local.txt", "BD")):
        path = record_dir / filename
        if not path.exists():
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            raise ValueError(f"{filename} 格式异常，无法列出账号。")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("username"), str) or not isinstance(row.get("password"), str) or (role == "BD" and not isinstance(row.get("owner"), str)):
                raise ValueError(f"{filename} 格式异常，无法列出账号。")
            accounts.append({"username": row["username"], "password": row["password"], "role": role,
                             "owner": row["owner"] if role == "BD" else "全部数据"})
    return accounts


def show_accounts(record_dir: Path = RECORD_DIR) -> None:
    accounts = recorded_accounts(record_dir)
    site = "正式站" if record_dir.name == "02-正式发布" else "测试站"
    print(f"\n本机保存的{site}账号：{len(accounts)} 个")
    print("注意：这是本机记录，无法从 Cloudflare 读取或核对当前密码。\n")
    for index, account in enumerate(accounts, 1):
        print(f"{index}. {account['username']} ｜ {account['role']} ｜ {account['owner']} ｜ 密码：******")
    if not accounts:
        return
    if input("\n若要在此窗口显示明文密码，请输入“显示”；直接回车则不显示：").strip() != "显示":
        return
    print("\n请注意屏幕旁的人和终端历史记录；不要截图或分享此窗口。")
    for index, account in enumerate(accounts, 1):
        print(f"{index}. {account['username']} ｜ 密码：{account['password']}")


def command_for(action: str, account_type: str, environment: str = "staging") -> list[str]:
    if action == "1" and account_type == "1":
        command = ["python3", "tools/site-access/add_admin_account.py"]
    elif action == "1" and account_type == "2":
        command = ["python3", "tools/site-access/add_bd_account.py", "--add"]
    elif action == "2" and account_type == "1":
        command = ["python3", "tools/site-access/change_password.py"]
    elif action == "2" and account_type == "2":
        command = ["python3", "tools/site-access/add_admin_account.py", "--edit"]
    elif action == "2" and account_type == "3":
        command = ["python3", "tools/site-access/add_bd_account.py", "--edit"]
    else:
        raise ValueError("选项无效，没有修改任何账号。")
    if environment == "production":
        command += ["--environment", "production"]
    return command


def run_once(environment: str = "staging") -> int:
    print(f"\n{'正式' if environment == 'production' else '测试'}网站 · 账号管理")
    print("1. 新增账号\n2. 修改账号或密码\n3. 查看现有账号和权限\n0. 退出")
    action = input("请选择：").strip()
    if action == "0":
        return -1
    if action == "3":
        show_accounts(PRODUCTION_RECORD_DIR if environment == "production" else RECORD_DIR)
        return 0
    if action == "1":
        print("\n1. 管理员（查看全部数据）\n2. BD（只查看绑定 BD 的数据）")
    elif action == "2":
        print("\n1. UPay 主管理员\n2. 其他管理员\n3. BD")
    else:
        raise ValueError("选项无效，没有修改任何账号。")
    account_type = input("请选择账号类型：").strip()
    command = command_for(action, account_type, environment)
    print("\n正在打开所选操作；密码输入时不会显示字符。\n", flush=True)
    return subprocess.run(command, cwd=ROOT, check=False).returncode


def main(environment: str = "staging") -> int:
    while True:
        try:
            result = run_once(environment)
        except ValueError as error:
            print(f"未完成：{error}")
            result = 1
        if result == -1:
            return 0
        if result:
            print("\n本次操作未完成，请查看上面的提示。")
        if input("\n按 Enter 继续，输入 0 退出：").strip() == "0":
            return 0


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description="管理指定环境的网站账号")
        parser.add_argument("--environment", choices=["staging", "production"], default="staging")
        raise SystemExit(main(parser.parse_args().environment))
    except (ValueError, KeyboardInterrupt, EOFError) as error:
        raise SystemExit(f"未完成：{error}") from None
