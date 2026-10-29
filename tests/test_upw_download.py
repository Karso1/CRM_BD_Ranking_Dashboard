from datetime import date
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/upw-download/download.py"
SPEC = importlib.util.spec_from_file_location("upw_download", MODULE_PATH)
assert SPEC and SPEC.loader
download = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(download)
sys.modules["download"] = download
IMPORT_SPEC = importlib.util.spec_from_file_location("upw_import", ROOT / "tools/upw-download/import_exports.py")
assert IMPORT_SPEC and IMPORT_SPEC.loader
upw_import = importlib.util.module_from_spec(IMPORT_SPEC)
IMPORT_SPEC.loader.exec_module(upw_import)


class UpwDownloadTests(unittest.TestCase):
    def test_existing_browser_exports_can_be_validated_without_new_browser(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            batch = root / "batch"
            data.mkdir()
            batch.mkdir()
            as_of = pd.Timestamp.now(tz="Asia/Shanghai").date() - pd.Timedelta(days=1)
            old_day = as_of - pd.Timedelta(days=1)
            pd.DataFrame([{"订单编号": "old", "用户UID": "1", "用户卡ID": "1",
                           "交易类型": "消费", "状态": "已完成", "用户卡流水": "-1 USDT",
                           "交易提交时间": f"{old_day} 10:00:00"}]).to_csv(data / "old-transactions.csv", index=False)
            pd.DataFrame([{"用户UID": "1", "总代UID": "1", "上一级UID": "0",
                           "注册时间": f"{old_day} 10:00:00"}]).to_csv(data / "代理关系查询-用户代理关系.csv", index=False)
            (data / "金融卡三方 - 用户卡片旧.csv").write_text("old", encoding="utf-8")
            cards = root / "cards.csv"
            pd.DataFrame([{"用户UID": "1", "用户卡ID": "card-1", "站点卡ID": "100",
                           "创建时间": f"{old_day} 10:00:00", "卡状态": "申请成功"}]).to_csv(cards, index=False)
            relation = root / "relation.csv"
            pd.DataFrame([{"用户UID": "2", "总代UID": "2", "上一级UID": "0",
                           "注册时间": f"{as_of} 10:00:00"},
                          {"用户UID": "1", "总代UID": "1", "上一级UID": "0",
                           "注册时间": f"{old_day} 10:00:00"}]).to_csv(relation, index=False)
            transaction = root / "new-transactions.csv"
            pd.DataFrame([{"订单编号": "new", "用户UID": "2", "用户卡ID": "card-1",
                           "交易类型": "消费", "状态": "已完成", "用户卡流水": "-2 USDT",
                           "交易提交时间": f"{as_of} 11:00:00"}]).to_csv(transaction, index=False)
            manifest = {"as_of": str(as_of), "cards": {"path": str(cards), "count": 1},
                        "relationships": {"total": 2, "segments": [{"path": str(relation), "count": 2}]},
                        "transactions": [{"date": str(as_of), "count": 1,
                                          "segments": [{"path": str(transaction), "count": 1}]}]}
            prepared = upw_import.prepare(manifest, data, batch)
            self.assertEqual(prepared[3], {"cards": 1, "relation_updates": 1, "transactions": 1, "days": 1})
            self.assertEqual(len((batch / "代理关系增量.jsonl").read_text().splitlines()), 1)
            self.assertEqual(json.loads((batch / "coverage.json").read_text())["covered_days"],
                             [str(old_day), str(as_of)])
            manifest["transactions"] = []
            with self.assertRaisesRegex(ValueError, "未覆盖的交易日期"):
                upw_import.prepare(manifest, data, batch)

    def test_transaction_validation_rejects_wrong_day_and_status(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "transactions.csv"
            frame = pd.DataFrame([{
                "订单编号": "101", "用户UID": "900", "用户卡ID": "500", "交易类型": "消费",
                "状态": "已完成", "用户卡流水": "-12.00 USDT", "交易提交时间": "2026-10-16 10:00:00",
            }])
            frame.to_csv(path, index=False)
            self.assertEqual(download.validate_transactions(path, date(2026, 10, 16), 1), 1)
            with self.assertRaisesRegex(ValueError, "单日数据"):
                download.validate_transactions(path, date(2026, 10, 17), 1)
            frame.loc[0, "状态"] = "失败"
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "非已完成"):
                download.validate_transactions(path, date(2026, 10, 16), 1)

    def test_coverage_index_uses_local_transaction_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            data.mkdir()
            pd.DataFrame([{"交易提交时间": "2026-10-16 12:00:00"},
                          {"交易提交时间": "2026-10-18 12:00:00"}]).to_csv(data / "transactions.csv", index=False)
            output = download.write_coverage(data, root / "UPW-已导入日期.json")
            plan = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(plan["schema"], "upw-coverage-v1")
            self.assertEqual(plan["first_date"], "2026-10-16")
            self.assertEqual(plan["covered_days"], ["2026-10-16", "2026-10-18"])

    def test_default_coverage_refreshes_existing_desktop_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            data.mkdir()
            pd.DataFrame([{"交易提交时间": "2026-10-22 12:00:00"}]).to_csv(data / "transactions.csv", index=False)
            project = root / "project.json"
            desktop = root / "desktop.json"
            desktop.write_text('{"covered_days": ["2026-10-19"]}', encoding="utf-8")
            with patch.object(download, "COVERAGE", project), patch.object(download, "DESKTOP_COVERAGE", desktop):
                download.write_coverage(data)
            self.assertEqual(project.read_text(encoding="utf-8"), desktop.read_text(encoding="utf-8"))
            self.assertEqual(json.loads(desktop.read_text(encoding="utf-8"))["covered_days"], ["2026-10-22"])

    def test_relationship_validation_rejects_unsorted_export(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "relations.csv"
            frame = pd.DataFrame([
                {"用户UID": "1", "总代UID": "1", "上一级UID": "0", "注册时间": "2026-10-15 08:00:00"},
                {"用户UID": "2", "总代UID": "2", "上一级UID": "0", "注册时间": "2026-10-16 08:00:00"},
            ])
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "倒序"):
                download.validate_relationships(path, 2)

    def test_publish_keeps_data_and_both_indexes_consistent(self):
        for fail_desktop in (False, True):
            with self.subTest(fail_desktop=fail_desktop), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                data, batch, state = root / "data", root / "batch", root / "state"
                data.mkdir()
                batch.mkdir()
                old_cards = data / "用户卡片旧.csv"
                old_cards.write_text("old cards")
                old_relations = data / "代理关系增量.jsonl"
                old_relations.write_text("old relations")
                project, desktop = root / "project.json", root / "desktop.json"
                for target in (project, desktop):
                    target.write_text("old coverage")
                cards, relations, tx = batch / "cards.csv", batch / "relations.jsonl", batch / "tx.csv"
                cards.write_text("new cards")
                relations.write_text("new relations")
                tx.write_text("new transaction")
                coverage = batch / "coverage.json"
                content = download.coverage_content({date(2026, 10, 23), date(2026, 10, 24)})
                coverage.write_text(content)
                replace = download.os.replace

                def replace_with_failure(source, destination):
                    if fail_desktop and Path(destination) == desktop:
                        raise PermissionError("desktop index unavailable")
                    return replace(source, destination)

                with patch.object(download, "COVERAGE", project), patch.object(download, "DESKTOP_COVERAGE", desktop), \
                        patch.object(download.os, "replace", side_effect=replace_with_failure):
                    if fail_desktop:
                        with self.assertRaisesRegex(PermissionError, "desktop index"):
                            download.publish(batch, data, state, cards, relations, {date(2026, 10, 24): [tx]}, coverage)
                    else:
                        download.publish(batch, data, state, cards, relations, {date(2026, 10, 24): [tx]}, coverage)
                if fail_desktop:
                    self.assertEqual(old_cards.read_text(), "old cards")
                    self.assertEqual(old_relations.read_text(), "old relations")
                    self.assertFalse(list(data.glob("三方金融卡-交易记录-*")))
                    self.assertEqual(project.read_text(), "old coverage")
                    self.assertEqual(desktop.read_text(), "old coverage")
                else:
                    self.assertEqual((data / "金融卡三方 - 用户卡片最新.csv").read_text(), "new cards")
                    self.assertEqual(old_relations.read_text(), "new relations")
                    self.assertEqual(project.read_text(), content)
                    self.assertEqual(desktop.read_text(), content)

    def test_relationship_overlay_uses_latest_uid(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "代理关系查询-用户代理关系.csv"
            pd.DataFrame([{"用户UID": "1", "总代UID": "10", "上一级UID": "10", "注册时间": "2026-10-15 08:00:00"}]).to_csv(source, index=False)
            changes = root / "代理关系增量.jsonl"
            changes.write_text(json.dumps({"用户UID": "1", "总代UID": "20", "上一级UID": "20", "注册时间": "2026-10-15 08:00:00"}) + "\n", encoding="utf-8")
            spec = importlib.util.spec_from_file_location("upw_pipeline", ROOT / "tools/upw-daily-pipeline/backfill_wallet_history.py")
            assert spec and spec.loader
            pipeline = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(pipeline)
            rows = pipeline.read_relationship_with_updates(source)
            self.assertEqual(rows.iloc[-1]["总代UID"], "20")
            self.assertEqual(rows.iloc[-1]["用户UID"], "1")
