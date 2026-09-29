import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("promote_accounts", Path(__file__).resolve().parents[1] / "tools/site-access/promote_accounts.py")
promote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promote)


class PromoteAccountsTests(unittest.TestCase):
    def test_records_validate_count_and_duplicates_without_upload(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / "测试网站访问密码.local.txt").write_text("用户名：upay\n访问密码：primary-password\n")
            (directory / "BD账号.local.txt").write_text(json.dumps([{"username": "kat", "password": "bd-password", "owner": "Katrina"}]))
            (directory / "其他管理员账号.local.txt").write_text(json.dumps([{"username": "manager", "password": "admin-password"}]))
            with patch.object(promote, "STAGING", directory):
                primary, bd, other = promote.records()
                self.assertEqual((len(bd), len(other)), (1, 1))
                self.assertEqual(primary["username"], "upay")
                (directory / "其他管理员账号.local.txt").write_text(json.dumps([{"username": "KAT", "password": "admin-password"}]))
                with self.assertRaises(ValueError):
                    promote.records()

    def test_secret_upload_passes_values_only_through_stdin(self):
        with patch.object(promote.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            promote.upload({"DASHBOARD_BD_ACCOUNTS": "private-record"})
        self.assertNotIn("private-record", str(run.call_args.args))
        self.assertEqual(json.loads(run.call_args.kwargs["input"])["DASHBOARD_BD_ACCOUNTS"], "private-record")


if __name__ == "__main__":
    unittest.main()
