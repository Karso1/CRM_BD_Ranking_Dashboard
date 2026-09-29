import importlib.util
from pathlib import Path
import unittest
import pandas as pd

spec = importlib.util.spec_from_file_location("wallet_owner", Path(__file__).resolve().parents[1] / "tools/upw-daily-pipeline/backfill_wallet_history.py")
wallet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wallet)


class WalletOwnerExceptionTests(unittest.TestCase):
    def test_only_specified_victor_population_moves_and_metrics_are_preserved(self):
        original = pd.DataFrame([
            {"parent_uid": "34716037", "master_bd": "Victor", "bd": "Victor", "agent": "Agent A", "consumption": 10},
            {"parent_uid": "34716037", "master_bd": "VICTOR", "bd": "Victor", "agent": "Agent A", "consumption": -2},
            {"parent_uid": "other", "master_bd": "Victor", "bd": "Victor", "agent": "Agent A", "consumption": 20},
            {"parent_uid": "34716037", "master_bd": "Katrina", "bd": "Katrina", "agent": "Agent B", "consumption": 30},
            {"parent_uid": "34716037", "master_bd": "Victor", "bd": "Mike", "agent": "Subagent", "consumption": 40},
            {"parent_uid": "34716037", "master_bd": None, "bd": None, "agent": None, "consumption": 50},
        ])
        result = wallet.apply_owner_exceptions(original)
        self.assertEqual(result.bd.iloc[:5].tolist(), ["UPay", "UPay", "Victor", "Katrina", "Mike"])
        self.assertTrue(pd.isna(result.bd.iloc[5]))
        pd.testing.assert_frame_equal(result.drop(columns="bd"), original.drop(columns="bd"))
        self.assertEqual(original.bd.iloc[0], "Victor")
