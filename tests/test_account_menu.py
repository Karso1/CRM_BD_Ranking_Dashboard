import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("account_menu", Path(__file__).resolve().parents[1] / "tools/site-access/account_menu.py")
menu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(menu)


class AccountMenuTests(unittest.TestCase):
    def test_all_actions_route_to_staging_only(self):
        expected = {
            ("1", "1"): ["python3", "tools/site-access/add_admin_account.py"],
            ("1", "2"): ["python3", "tools/site-access/add_bd_account.py", "--add"],
            ("2", "1"): ["python3", "tools/site-access/change_password.py"],
            ("2", "2"): ["python3", "tools/site-access/add_admin_account.py", "--edit"],
            ("2", "3"): ["python3", "tools/site-access/add_bd_account.py", "--edit"],
        }
        for choices, command in expected.items():
            self.assertEqual(menu.command_for(*choices), command)
            self.assertNotIn("production", " ".join(command))
        with self.assertRaises(ValueError):
            menu.command_for("1", "3")

    def test_inventory_masks_passwords_until_explicit_confirmation(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / "测试网站访问密码.local.txt").write_text("用户名：upay\n访问密码：primary-secret\n")
            (directory / "其他管理员账号.local.txt").write_text(json.dumps([{"username": "manager", "password": "manager-secret"}]))
            (directory / "BD账号.local.txt").write_text(json.dumps([{"username": "kat", "password": "bd-secret", "owner": "Katrina"}]))
            hidden = io.StringIO()
            with patch("builtins.input", return_value=""), redirect_stdout(hidden):
                menu.show_accounts(directory)
            self.assertIn("3 个", hidden.getvalue())
            self.assertIn("kat ｜ BD ｜ Katrina", hidden.getvalue())
            self.assertNotIn("primary-secret", hidden.getvalue())
            self.assertNotIn("manager-secret", hidden.getvalue())
            self.assertNotIn("bd-secret", hidden.getvalue())
            revealed = io.StringIO()
            with patch("builtins.input", return_value="显示"), redirect_stdout(revealed):
                menu.show_accounts(directory)
            self.assertIn("密码：primary-secret", revealed.getvalue())
            self.assertIn("密码：manager-secret", revealed.getvalue())
            self.assertIn("密码：bd-secret", revealed.getvalue())


if __name__ == "__main__":
    unittest.main()
