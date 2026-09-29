#!/bin/bash
cd "$(dirname "$0")/../../.." || exit 1
python3 tools/site-access/change_password.py --environment production
result=$?
printf '\n按 Enter 关闭窗口…'
read -r
exit "$result"
