#!/bin/bash
# 旧入口：日常请使用 01-测试更新/账号管理.command
cd "$(dirname "$0")/../../.." || exit 1
python3 tools/site-access/change_password.py
result=$?
printf '\n按 Enter 关闭窗口…'
read -r
exit "$result"
