"""One simple entry point for staging account management."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def command_for(action: str, account_type: str) -> list[str]:
    if action == "1" and account_type == "1":
        return ["python3", "tools/site-access/add_admin_account.py"]
    if action == "1" and account_type == "2":
        return ["python3", "tools/site-access/add_bd_account.py", "--add"]
    if action == "2" and account_type == "1":
        return ["python3", "tools/site-access/change_password.py"]
    if action == "2" and account_type == "2":
        return ["python3", "tools/site-access/add_admin_account.py", "--edit"]
    if action == "2" and account_type == "3":
        return ["python3", "tools/site-access/add_bd_account.py", "--edit"]
    raise ValueError("选项无效，没有修改任何账号。")


def main() -> int:
    print("测试网站 · 账号管理\n")
    print("1. 新增账号\n2. 修改账号或密码\n0. 退出")
    action = input("请选择：").strip()
    if action == "0":
        return 0
    if action == "1":
        print("\n1. 管理员（查看全部数据）\n2. BD（只查看绑定 BD 的数据）")
    elif action == "2":
        print("\n1. UPay 主管理员\n2. 其他管理员\n3. BD")
    else:
        raise ValueError("选项无效，没有修改任何账号。")
    account_type = input("请选择账号类型：").strip()
    command = command_for(action, account_type)
    print("\n正在打开所选操作；密码输入时不会显示字符。\n", flush=True)
    return subprocess.run(command, cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyboardInterrupt, EOFError) as error:
        raise SystemExit(f"未完成：{error}") from None
