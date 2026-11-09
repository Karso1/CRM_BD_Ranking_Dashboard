"""Read Lark's exported workbook, including exports with incorrect dimensions."""
import datetime
import json
import sys
import openpyxl

book = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
sheet = book.active
sheet.reset_dimensions()
rows = iter(sheet.iter_rows(values_only=True))
headers = [str(value or '').strip() for value in next(rows)]
if len(set(headers)) != len(headers) or any(not h for h in headers):
    raise ValueError('表头包含空白或重复列，请使用 Lark 原始导出。')
records = []
for row in rows:
    if not any(value is not None for value in row):
        continue
    records.append({key: value.isoformat(sep=' ', timespec='minutes') if isinstance(value, datetime.datetime)
                    else value.isoformat() if isinstance(value, datetime.date)
                    else str(value) if value is not None else '' for key, value in zip(headers, row)})
print(json.dumps(records, ensure_ascii=False))
book.close()
