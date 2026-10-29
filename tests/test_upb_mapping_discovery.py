import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/daily-operations/90-系统维护"))
sys.path.insert(0, str(ROOT / "tools/upb-daily-pipeline"))

import pipeline
from build_business_history import configuration_file


class UpbMappingDiscoveryTests(unittest.TestCase):
    def test_accepts_unique_workbook_and_ignores_excel_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "BD代理关系目标"
            folder.mkdir()
            selected = folder / "BD代理关系目标.xlsx"
            selected.touch()
            (folder / "~$BD代理关系.xlsx").touch()
            self.assertEqual(pipeline.upb_mapping_file(root), selected)
            self.assertEqual(configuration_file(root), selected)

    def test_rejects_ambiguous_workbooks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "BD代理关系目标"
            folder.mkdir()
            (folder / "first.xlsx").touch()
            (folder / "second.xlsx").touch()
            with self.assertRaisesRegex(ValueError, "恰好有一份"):
                pipeline.upb_mapping_file(root)
            with self.assertRaisesRegex(ValueError, "恰好有一份"):
                configuration_file(root)


if __name__ == "__main__":
    unittest.main()
