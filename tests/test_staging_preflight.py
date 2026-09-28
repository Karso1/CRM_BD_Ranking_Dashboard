"""Wrong target environments must never reach POST."""
import io
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/daily-operations/90-系统维护"))
import sync_common as sync

class StagingPreflightTests(unittest.TestCase):
    def test_rejects_wrong_environment_without_post(self):
        for platform in ("wallet", "business"):
            for payload in ({"environment": "production"}, {}, {"environment": "staging", "error": "Unauthorized"}):
                with self.subTest(platform=platform, payload=payload), patch.object(sync, "read_json", return_value=payload), patch.object(sync.urllib.request, "build_opener") as post:
                    self.assertEqual(sync.sync({"endpoint": "https://example.invalid", "key": "test"}, [{"date": "2026-09-24"}], [], platform, "staging"), 1)
                    post.assert_not_called()

    def test_rejects_production_refresh_url_for_staging_before_network(self):
        with patch.object(sync.urllib.request, "urlopen") as network:
            self.assertEqual(sync.sync({"endpoint": "https://example.invalid", "key": "test"}, [{}], [], "wallet", "staging",
                "https://upay-bd-ranking.karsol.workers.dev/api/dashboard"), 1)
            network.assert_not_called()

    def test_default_staging_refresh_stays_in_staging(self):
        self.assertIn("ranking-staging.", sync.dashboard_url("staging", "wallet"))

if __name__ == "__main__":
    unittest.main()
