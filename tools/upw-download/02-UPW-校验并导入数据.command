#!/bin/zsh
set -u

importer="/Users/admin/Documents/ChatGPT/CRM用户生命周期/up-ranking-dashboard-work/tools/upw-download/import_exports.py"
downloads="/Users/admin/Downloads/UPW"
files=("$downloads"/upw-export-*.json(Nom))

finish() {
  if [[ "${1:-}" != "--check-only" ]]; then
    read -r '?按 Enter 关闭窗口…'
  fi
}

if [[ ! -f "$importer" ]]; then
  echo "导入程序不存在：$importer"
  finish "${1:-}"
  exit 1
fi
if (( ${#files} == 0 )); then
  echo "没有找到 UPW 导出清单：$downloads/upw-export-*.json"
  echo "请先在已登录的 UPW 网页运行数据导出助手。"
  finish "${1:-}"
  exit 1
fi

manifest="${files[1]}"
echo "将使用最近下载的 UPW 导出清单："
echo "$manifest"
python3 - "$manifest" <<'PY'
import json
import sys
from pathlib import Path

plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print("截止日期：", plan.get("as_of", "未知"))
print("交易日期：", ", ".join(str(item.get("date", "未知")) for item in plan.get("transactions", [])) or "无")
PY
if (( $? != 0 )); then
  echo "导出清单无法读取，已停止。"
  finish "${1:-}"
  exit 1
fi

if [[ "${1:-}" == "--check-only" ]]; then
  echo "本次仅校验文件。"
  if python3 "$importer" "$manifest"; then
    exit 0
  fi
  echo "校验失败，未导入。"
  exit 1
fi

echo "正在校验；全部通过后自动备份并导入本地 UPW 数据、同步日期清单。"

if python3 "$importer" "$manifest" --install; then
  echo "本地原始数据已更新。下一步可运行 03-更新测试网站/02-UPW-测试更新.command。"
else
  echo "导入未完成。不要运行测试或正式发布，请保留窗口并截图。"
  finish
  exit 1
fi
finish
