#!/bin/bash
cd "$(dirname "$0")/../../.." || exit 1
python3 tools/site-access/add_bd_account.py --edit
result=$?
printf '\n按 Enter 关闭窗口…'
read -r
exit "$result"
