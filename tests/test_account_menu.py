import importlib.util
from pathlib import Path
import unittest

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


if __name__ == "__main__":
    unittest.main()
