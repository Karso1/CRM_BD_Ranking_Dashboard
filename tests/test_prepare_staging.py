"""Offline safety checks for public real-data staging preparation."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "prepare_staging", ROOT / "tools" / "daily-operations" / "90-系统维护" / "prepare_staging.py"
)
prepare_staging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_staging)


class PrepareStagingTests(unittest.TestCase):
    def test_public_real_data_requires_explicit_ack_before_copying(self):
        with patch.object(prepare_staging, "mirror_directory") as mirror:
            with self.assertRaisesRegex(RuntimeError, "公开访问"):
                prepare_staging.prepare("upb")
        mirror.assert_not_called()


if __name__ == "__main__":
    unittest.main()
