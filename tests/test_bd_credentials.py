import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bd_credentials", Path(__file__).resolve().parents[1] / "tools/site-access/add_bd_account.py")
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)


class BdCredentialTests(unittest.TestCase):
    def test_edit_username_and_password_without_exposing_password_in_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "bd.local.txt"
            record.write_text(json.dumps([{"username": "Katrina", "password": "old-password-123", "owner": "Katrina"}]))
            with patch.object(bd, "RECORD", record), patch("sys.argv", ["add_bd_account.py", "--edit"]), \
                 patch("builtins.input", side_effect=["", "new-katrina"]), \
                 patch.object(bd.getpass, "getpass", side_effect=["new-password-123", "new-password-123"]), \
                 patch.object(bd.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                bd.main()
            uploaded = json.loads(run.call_args_list[0].kwargs["input"])
            account = json.loads(uploaded["DASHBOARD_BD_ACCOUNTS"])[0]
            self.assertEqual(account, {"username": "new-katrina", "password": "new-password-123", "owner": "Katrina"})
            self.assertNotIn("new-password-123", str(run.call_args_list[0].args))
            self.assertEqual(json.loads(record.read_text())[0], account)
            self.assertEqual(record.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(run.call_args_list[1].kwargs["input"]),
                             {"username": "new-katrina", "password": "new-password-123"})

    def test_password_mismatch_does_not_update_cloudflare_or_local_record(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "bd.local.txt"
            previous = json.dumps([{"username": "Katrina", "password": "old-password-123", "owner": "Katrina"}])
            record.write_text(previous)
            with patch.object(bd, "RECORD", record), patch("sys.argv", ["add_bd_account.py", "--edit"]), \
                 patch("builtins.input", side_effect=["", ""]), \
                 patch.object(bd.getpass, "getpass", side_effect=["new-password-123", "different"]), \
                 patch.object(bd.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    bd.main()
            run.assert_not_called()
            self.assertEqual(record.read_text(), previous)

    def test_interactive_add_binds_exact_existing_bd_and_preserves_old_account(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "bd.local.txt"
            previous = {"username": "Katrina", "password": "old-password-123", "owner": "Katrina"}
            record.write_text(json.dumps([previous]))
            with patch.object(bd, "RECORD", record), patch("sys.argv", ["add_bd_account.py", "--add"]), \
                 patch.object(bd, "available_owners", return_value=["Katrina", "Victor"]), \
                 patch("builtins.input", side_effect=["victor", "victor-login"]), \
                 patch.object(bd.getpass, "getpass", side_effect=["new-password-123", "new-password-123"]), \
                 patch.object(bd.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                bd.main()
            accounts = json.loads(json.loads(run.call_args_list[0].kwargs["input"])["DASHBOARD_BD_ACCOUNTS"])
            self.assertEqual(accounts[0], previous)
            self.assertEqual(accounts[1], {"username": "victor-login", "password": "new-password-123", "owner": "Victor"})

    def test_bd_choices_come_from_selected_environment_live_data(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "admin.local.txt"
            record.write_text("用户名：upay\n访问密码：private-password\n")
            login = SimpleNamespace(status=303, getheader=lambda *_: "session=secret; Path=/", read=lambda: b"")
            business = SimpleNamespace(status=200, read=lambda: json.dumps({"environment": "production", "business": {
                "periods": [{"overall": [{"name": "Katrina"}, {"name": "UPay"}]}]}}).encode())
            wallet = SimpleNamespace(status=200, read=lambda: json.dumps({"environment": "production", "wallet": {
                "periods": [{"overall": [{"name": "Marketing"}]}]}}).encode())
            with patch.object(bd.http.client, "HTTPSConnection") as connection_class:
                connection = connection_class.return_value
                connection.getresponse.side_effect = [login, business, wallet]
                self.assertEqual(bd.available_owners("production", record), ["Katrina", "Marketing"])
                self.assertEqual(connection_class.call_args.args[0], "upay-bd-ranking.karsol.workers.dev")


if __name__ == "__main__":
    unittest.main()
