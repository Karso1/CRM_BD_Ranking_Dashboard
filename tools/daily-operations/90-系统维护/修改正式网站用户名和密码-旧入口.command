#!/bin/bash
# 旧入口：日常请使用 02-正式发布/账号管理.command
cd "$(dirname "$0")/../../.." || exit 1
python3 tools/site-access/change_password.py --environment production
result=$?
printf '\n按 Enter 关闭窗口…'
read -r
exit "$result"
