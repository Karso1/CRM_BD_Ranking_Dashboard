import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("add_admin", Path(__file__).resolve().parents[1] / "tools/site-access/add_admin_account.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AddAdminTests(unittest.TestCase):
    def test_add_admin_uploads_only_additional_admin_secret_and_verifies(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            primary = directory / "primary.local.txt"
            primary.write_text("用户名：upay\n访问密码：hidden\n")
            bd_record = directory / "bd.local.txt"
            bd_record.write_text('[{"username":"Katrina"}]')
            record = directory / "other-admin.local.txt"
            with patch("sys.argv", ["add_admin_account.py"]), patch.object(module, "PRIMARY_RECORD", primary), patch.object(module, "BD_RECORD", bd_record), \
                 patch.object(module, "RECORD", record), patch("builtins.input", return_value="manager2"), \
                 patch.object(module.getpass, "getpass", side_effect=["password-12345", "password-12345"]), \
                 patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                module.main()
            uploaded = json.loads(run.call_args_list[0].kwargs["input"])
            self.assertEqual(json.loads(uploaded["DASHBOARD_ADDITIONAL_ADMINS"]),
                             [{"username": "manager2", "password": "password-12345"}])
            self.assertEqual(record.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(run.call_args_list[1].kwargs["input"]),
                             {"username": "manager2", "password": "password-12345"})

    def test_duplicate_bd_username_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            bd_record = directory / "bd.local.txt"
            bd_record.write_text('[{"username":"Katrina"}]')
            with patch("sys.argv", ["add_admin_account.py"]), patch.object(module, "PRIMARY_RECORD", directory / "missing"), \
                 patch.object(module, "BD_RECORD", bd_record), patch.object(module, "RECORD", directory / "missing2"), \
                 patch("builtins.input", return_value="katrina"), patch.object(module.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    module.main()
            run.assert_not_called()

    def test_edit_admin_preserves_other_accounts(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            record = directory / "other-admin.local.txt"
            record.write_text(json.dumps([{"username": "manager2", "password": "old-password-123"},
                                          {"username": "manager3", "password": "untouched-password-123"}]))
            with patch("sys.argv", ["add_admin_account.py", "--edit"]), \
                 patch.object(module, "PRIMARY_RECORD", directory / "missing"), \
                 patch.object(module, "BD_RECORD", directory / "missing2"), patch.object(module, "RECORD", record), \
                 patch("builtins.input", side_effect=["manager2", "renamed-manager"]), \
                 patch.object(module.getpass, "getpass", side_effect=["new-password-123", "new-password-123"]), \
                 patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                module.main()
            accounts = json.loads(json.loads(run.call_args_list[0].kwargs["input"])["DASHBOARD_ADDITIONAL_ADMINS"])
            self.assertEqual(accounts[0]["username"], "manager3")
            self.assertEqual(accounts[1], {"username": "renamed-manager", "password": "new-password-123"})


if __name__ == "__main__":
    unittest.main()
