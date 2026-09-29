import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("site_credentials", Path(__file__).resolve().parents[1] / "tools/site-access/change_password.py")
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


class CredentialToolTests(unittest.TestCase):
    def test_initial_production_account_copies_staging_credentials_with_new_session_secret(self):
        with tempfile.TemporaryDirectory() as folder:
            staging = Path(folder) / "staging.local.txt"
            production = Path(folder) / "production.local.txt"
            staging.write_text("用户名：shared-user\n访问密码：staging-password-123\n", encoding="utf-8")
            with patch.object(admin, "STAGING_FILE", staging), patch.object(admin, "PRODUCTION_FILE", production), \
                 patch("sys.argv", ["change_password.py", "--environment", "production", "--copy-staging"]), \
                 patch("builtins.input", side_effect=AssertionError("Should not prompt")), \
                 patch.object(admin.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                admin.main()
            command = run.call_args.args[0]
            uploaded = json.loads(run.call_args.kwargs["input"])
            self.assertIn("upay-bd-ranking", command)
            self.assertNotIn("upay-bd-ranking-staging", command)
            self.assertEqual(uploaded["DASHBOARD_USERNAME"], "shared-user")
            self.assertEqual(uploaded["DASHBOARD_PASSWORD"], "staging-password-123")
            self.assertGreaterEqual(len(uploaded["DASHBOARD_SESSION_SECRET"]), 40)
            self.assertEqual(production.stat().st_mode & 0o777, 0o600)

    def test_username_and_password_are_changed_together_without_argv_exposure(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "password.local.txt"
            with patch.object(admin, "STAGING_FILE", record), patch("sys.argv", ["change_password.py"]), \
                 patch("builtins.input", return_value="new-user"), \
                 patch.object(admin.getpass, "getpass", side_effect=["new-password-123", "new-password-123"]), \
                 patch.object(admin.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                admin.main()
            upload = run.call_args_list[0]
            self.assertEqual(json.loads(upload.kwargs["input"]), {"DASHBOARD_USERNAME": "new-user", "DASHBOARD_PASSWORD": "new-password-123"})
            self.assertNotIn("new-password-123", str(upload.args))
            self.assertIn("用户名：new-user", record.read_text())
            self.assertEqual(record.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(run.call_args_list[1].kwargs["input"]), {"username": "new-user", "password": "new-password-123"})

    def test_mismatched_passwords_never_update_cloudflare(self):
        with patch("sys.argv", ["change_password.py"]), patch("builtins.input", return_value="test"), \
             patch.object(admin.getpass, "getpass", side_effect=["valid-password-123", "different"]), \
             patch.object(admin.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                admin.main()
            run.assert_not_called()
