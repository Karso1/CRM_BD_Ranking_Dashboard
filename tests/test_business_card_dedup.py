"""Guard against repeated paid card orders in overlapping exports."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "business_history", Path(os.environ.get(
        "UPB_PIPELINE_SOURCE", ROOT / "tools" / "upb-daily-pipeline" / "build_business_history.py"
    ))
)
BUSINESS = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUSINESS
SPEC.loader.exec_module(BUSINESS)


class BusinessCardDedupTests(unittest.TestCase):
    def test_inserted_contact_columns_do_not_change_public_bd_list(self):
        frame = pd.DataFrame([{'BD':'Mike','Categories':'Agent','client':'Demo','合作模式':'',
            '邮箱':'demo@example.test','合作开始日期':'2024-12-02','月份':'202609',
            '充值/消费量目标':'1000','开卡目标':'99','BD.1':'Mike'}])
        with patch.object(BUSINESS,'read_matching_sheet',return_value=(frame,'Sheet2')):
            mapping,targets,allowed=BUSINESS.load_configuration(Path('test.xlsx'))
        self.assertEqual(allowed,['Mike'])
        self.assertEqual(mapping['demo'].bd,'Mike')
        self.assertEqual(set(targets.bd),{'Mike','UPay'})

    def test_overlapping_paid_order_counts_once_and_free_card_still_maps(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / "开卡"
            folder.mkdir()
            rows = [
                {"订单号": "paid-1", "所属代理商": "Demo Agent", "历史代理商": "Demo Agent", "实/虚卡": "虚拟卡", "卡ID": "card-1", "卡唯一ID": "uuid-1", "开卡费": 10, "申请时间": "2026-09-01", "卡状态": "开卡成功", "开卡成功时间": "2026-09-01"},
                {"订单号": "free-1", "所属代理商": "Demo Agent", "历史代理商": "Demo Agent", "实/虚卡": "实体卡", "卡ID": "card-2", "卡唯一ID": "uuid-2", "开卡费": 0, "申请时间": "2026-09-02", "卡状态": "开卡成功", "开卡成功时间": "2026-09-02"},
            ]
            frame = pd.DataFrame(rows)
            frame.to_excel(folder / "export-1.xlsx", index=False)
            frame.iloc[[0]].to_excel(folder / "export-2.xlsx", index=False)
            client = BUSINESS.Client("Demo Agent", "代理商", "Demo BD", "recharge")
            coverage, unmapped = [], []
            cards, card_map, conflicts = BUSINESS.load_card_data(
                root, {"demo agent": client}, coverage, unmapped
            )
            self.assertEqual(int(cards.open_card_virtual.sum()), 1)
            self.assertEqual(int(cards.open_card_physical.sum()), 0)
            self.assertEqual(card_map["card-2"], client)
            self.assertEqual(coverage[-1]["duplicate_rows_removed"], 1)
            self.assertEqual(conflicts, [])

    def test_newer_reporting_month_replaces_conflicting_older_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_folder = root / "开卡" / "2026" / "Q1"
            new_folder = root / "开卡" / "2026" / "Q3"
            old_folder.mkdir(parents=True)
            new_folder.mkdir(parents=True)
            old = old_folder / "卡片申请历史2026-03.xlsx"
            new = new_folder / "卡片申请历史2026-07.xlsx"
            base = {
                "订单号": "updated-order", "所属代理商": "Demo Agent", "历史代理商": "Demo Agent",
                "实/虚卡": "实体卡", "卡ID": "card-1", "卡唯一ID": "uuid-1", "开卡费": 10,
                "申请时间": "2026-07-12", "卡状态": "开卡成功", "开卡成功时间": "2026-07-12",
            }
            pd.DataFrame([base]).to_excel(old, index=False)
            updated = {**base, "申请时间": "2026-07-13", "开卡成功时间": "2026-07-13"}
            pd.DataFrame([updated]).to_excel(new, index=False)
            # Even if the old workbook's filesystem timestamp is newer, its
            # older reporting month must not override the July snapshot.
            os.utime(old, ns=(2_000_000_000, 2_000_000_000))
            os.utime(new, ns=(1_000_000_000, 1_000_000_000))

            client = BUSINESS.Client("Demo Agent", "代理商", "Demo BD", "recharge")
            cards, _, _ = BUSINESS.load_card_data(root, {"demo agent": client}, [], [])
            self.assertEqual(int(cards.open_card_physical.sum()), 1)
            self.assertEqual(int(cards.open_card_virtual.sum()), 0)
            self.assertEqual(cards.iloc[0].date.strftime("%Y-%m-%d"), "2026-07-13")

    def test_newer_status_change_removes_stale_success_from_card_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / "开卡"
            folder.mkdir()
            old = {
                "订单号": "status-change", "所属代理商": "Demo Agent", "历史代理商": "Demo Agent",
                "实/虚卡": "虚拟卡", "卡ID": "card-1", "卡唯一ID": "uuid-1", "开卡费": 10,
                "申请时间": "2026-08-01", "卡状态": "开卡成功", "开卡成功时间": "2026-08-01",
            }
            newer = {**old, "卡状态": "开卡失败", "开卡费": 0}
            pd.DataFrame([old]).to_excel(folder / "export-1.xlsx", index=False)
            pd.DataFrame([newer]).to_excel(folder / "export-2.xlsx", index=False)
            client = BUSINESS.Client("Demo Agent", "代理商", "Demo BD", "recharge")
            cards, _, _ = BUSINESS.load_card_data(root, {"demo agent": client}, [], [])
            self.assertTrue(cards.empty)


if __name__ == "__main__":
    unittest.main()
