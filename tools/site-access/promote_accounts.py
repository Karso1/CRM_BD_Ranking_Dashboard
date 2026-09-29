"""Copy accepted staging credentials to production without exposing passwords."""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "tools/daily-operations/01-测试更新"
PRODUCTION = ROOT / "tools/daily-operations/02-正式发布"
CONFIG = ROOT / "tools/site-access/production.wrangler.jsonc"


def records():
    fields = dict(line.split("：", 1) for line in (STAGING / "测试网站访问密码.local.txt").read_text(encoding="utf-8").splitlines() if "：" in line)
    primary = {"username": fields.get("用户名"), "password": fields.get("访问密码")}
    bd = json.loads((STAGING / "BD账号.local.txt").read_text(encoding="utf-8"))
    other = json.loads((STAGING / "其他管理员账号.local.txt").read_text(encoding="utf-8")) if (STAGING / "其他管理员账号.local.txt").exists() else []
    if not isinstance(bd, list) or not isinstance(other, list) or len(bd) > 50 or len(other) > 20:
        raise ValueError("测试站账号记录格式异常。")
    entries = [primary, *bd, *other]
    if any(not isinstance(item, dict) or not isinstance(item.get("username"), str) or not item["username"] or
      not isinstance(item.get("password"), str) or not item["password"] for item in entries):
        raise ValueError("测试站账号记录不完整。")
    if any(not isinstance(item.get("owner"), str) or not item["owner"] for item in bd):
        raise ValueError("BD 归属缺失。")
    usernames = [item["username"].casefold() for item in entries]
    if len(usernames) != len(set(usernames)):
        raise ValueError("账号用户名重复，已停止迁移。")
    return primary, bd, other


def upload(secret_values: dict[str, str]):
    cli = ROOT / "node_modules/.bin/wrangler"
    environment = {**os.environ, "WRANGLER_LOG_PATH": str(ROOT / ".wrangler/logs"),
                   "WRANGLER_WRITE_LOGS": "false", "WRANGLER_SEND_METRICS": "false"}
    result = subprocess.run([str(cli), "secret", "bulk", "--name", "upay-bd-ranking", "--config", str(CONFIG)],
                            input=json.dumps(secret_values, ensure_ascii=False), text=True, cwd=ROOT, env=environment)
    if result.returncode:
        raise ValueError("Cloudflare 未确认上传成功，本机正式站记录没有更新。")


def save_private(path: Path, content: str):
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".promote-account-", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
        os.replace(temporary, path)
        if hasattr(os, "chflags") and hasattr(stat, "UF_HIDDEN"):
            try:
                os.chflags(path, os.stat(path).st_flags | stat.UF_HIDDEN)
            except OSError:
                pass
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description="将测试站账号复制到正式站")
    parser.add_argument("phase", choices=["prepare", "primary"])
    args = parser.parse_args()
    primary, bd, other = records()
    if args.phase == "prepare":
        for name in ("BD账号.local.txt", "其他管理员账号.local.txt"):
            if (PRODUCTION / name).exists():
                raise ValueError(f"正式站已有 {name}，请先人工核对，避免覆盖。")
        upload({"DASHBOARD_BD_ACCOUNTS": json.dumps(bd, ensure_ascii=False),
                "DASHBOARD_ADDITIONAL_ADMINS": json.dumps(other, ensure_ascii=False)})
        save_private(PRODUCTION / "BD账号.local.txt", json.dumps(bd, ensure_ascii=False, indent=2) + "\n")
        save_private(PRODUCTION / "其他管理员账号.local.txt", json.dumps(other, ensure_ascii=False, indent=2) + "\n")
        print(f"正式站已配置 {len(bd)} 个 BD 账号和 {len(other)} 个附加管理员账号；密码没有输出。")
    else:
        current = PRODUCTION / "正式网站访问密码.local.txt"
        backup = PRODUCTION / "正式网站访问密码.同步前备份.local.txt"
        if backup.exists():
            raise ValueError("正式站已有同步前备份，已停止以避免覆盖。")
        if not (PRODUCTION / "BD账号.local.txt").exists() or not (PRODUCTION / "其他管理员账号.local.txt").exists():
            raise ValueError("请先完成 prepare 阶段。")
        upload({"DASHBOARD_USERNAME": primary["username"], "DASHBOARD_PASSWORD": primary["password"]})
        if current.exists():
            save_private(backup, current.read_text(encoding="utf-8"))
        save_private(current, "正式网站：https://upay-bd-ranking.karsol.workers.dev\n" +
                     f"用户名：{primary['username']}\n访问密码：{primary['password']}\n\n" +
                     "本文件仅保存在这台电脑，不会上传 GitHub。请妥善保管。\n")
        print("正式站 UPay 主管理员账号已与测试站一致；旧本机记录已备份。密码没有输出。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, KeyboardInterrupt) as error:
        raise SystemExit(f"未完成：{error}") from None
