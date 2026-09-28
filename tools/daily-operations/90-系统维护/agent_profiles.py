"""Read optional contact fields without changing the source workbook."""
from datetime import date, datetime, timedelta
import json
import unicodedata

import openpyxl


def text(value):
    return "" if value is None else unicodedata.normalize("NFKC", str(value)).strip()


def cooperation_date(value):
    if value is None or text(value) == "":
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ", timespec="minutes") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, (int, float)):
        return cooperation_date(datetime(1899, 12, 30) + timedelta(days=value))
    value = text(value)
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            parsed = datetime.strptime(value, pattern)
            return parsed.strftime("%Y-%m-%d %H:%M") if "%H" in pattern else parsed.strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError("合作开始日期格式无法识别，请使用 Excel 日期或 年-月-日。")


def read_profiles(path, platform):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet in book.worksheets:
            rows = sheet.iter_rows(values_only=True)
            headers = [text(x) for x in next(rows, ())]
            name_column = "client" if platform == "upb" else "代理商"
            owner_column = "BD" if platform == "upb" else "商务"
            if name_column not in headers or owner_column not in headers:
                continue
            def column(*names):
                return next((headers.index(n) for n in names if n in headers), None)
            name_idx, owner_idx = column(name_column), column(owner_column)
            category_idx = column("Categories") if platform == "upb" else None
            email_idx, date_idx = column("邮箱", "Email", "email"), column("合作开始日期", "合作开始时间", "Cooperation start")
            output = {}
            for row_number, row in enumerate(rows, 2):
                def cell(index):
                    return row[index] if index is not None and index < len(row) else None
                name, owner = text(cell(name_idx)), text(cell(owner_idx))
                if not name:
                    continue
                category = "API" if text(cell(category_idx)).upper() == "API" else "代理商"
                try:
                    started = cooperation_date(cell(date_idx))
                except ValueError as error:
                    raise ValueError(f"{path.name} {sheet.title} 第 {row_number} 行：{error}") from error
                profile = {"name": name, "owner": owner, "type": category, "email": text(cell(email_idx)), "cooperationStart": started}
                key = (name.casefold(), owner.casefold(), category)
                if key in output and output[key] != profile:
                    previous = output[key]
                    if previous["email"] != profile["email"]:
                        raise ValueError(f"{path.name} 第 {row_number} 行：同名代理的邮箱冲突。")
                    dates = [d for d in (previous["cooperationStart"], started) if d]
                    profile = {**previous, "cooperationStart": min(dates) if dates else ""}
                output[key] = profile
            return list(output.values())
        raise ValueError(f"{path.name} 找不到代理关系表。")
    finally:
        book.close()


def export_profiles(path, platform, output):
    profiles = read_profiles(path, platform)
    (output / "agent_profiles.json").write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"代理资料：{len(profiles)} 条，邮箱 {sum(bool(p['email']) for p in profiles)} 条，合作日期 {sum(bool(p['cooperationStart']) for p in profiles)} 条。", flush=True)


def load_profiles(output):
    path = output / "agent_profiles.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
