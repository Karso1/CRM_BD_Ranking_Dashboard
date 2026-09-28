"""Network failures must not resend data or turn stale data into success."""
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/daily-operations/90-系统维护"))
import sync_common as sync

class FreshnessTests(unittest.TestCase):
    def test_google_result_404_restarts_original_get_with_unique_request(self):
        endpoint = "https://script.google.com/macros/s/test/exec?key=test&platform=wallet"
        error = urllib.error.HTTPError("https://script.googleusercontent.com/macros/echo?token=test", 404, "Not Found", {}, None)
        with patch.object(sync.urllib.request, "urlopen", side_effect=[error, io.BytesIO(b'{"environment":"staging"}')]) as read, patch.object(sync.time, "sleep"):
            self.assertEqual(sync.read_json(endpoint)["environment"], "staging")
            urls = [call.args[0].full_url for call in read.call_args_list]
            self.assertEqual(len(urls), 2)
            self.assertNotEqual(urls[0], urls[1])
            self.assertTrue(all(url.startswith(endpoint + "&_sync_request=") for url in urls))

    def test_missing_deployment_404_is_not_retried(self):
        endpoint = "https://script.google.com/macros/s/missing/exec"
        error = urllib.error.HTTPError(endpoint, 404, "Not Found", {}, None)
        with patch.object(sync.urllib.request, "urlopen", side_effect=error) as read:
            with self.assertRaises(urllib.error.HTTPError):
                sync.read_json(endpoint)
            self.assertEqual(read.call_count, 1)

    def fixture(self, platform):
        row = {"date": "2026-09-24", "bd": "UPay", "agent": "Demo", "category": "API",
               "total_amount": 50, "consumption": 25, "open_card_virtual": 2, "open_card_physical": 0}
        detail = {"owner": "UPay", "name": "Demo", "type": "API" if platform == "business" else "代理商",
                  "recharge": 50 if platform == "business" else 25, "consumption": 25, "cardsVirtual": 2, "cardsPhysical": 0}
        periods = [{"id": "2026-09", "daily": [{"date": "2026-09-24", "details": [detail]}],
                    "overall": [{"name": "UPay", "target": 100}]}]
        return [row], [{"month": "2026-09", "bd": "UPay", "target": 100}], {"environment": "staging", platform: {"periods": periods}}

    def run_sync(self, platform, responses, post_error=None, verify_only=False):
        rows, targets, _ = self.fixture(platform)
        opener = MagicMock()
        if post_error:
            opener.open.side_effect = post_error
        else:
            opener.open.return_value = io.BytesIO(b'{"ok":true}')
        with patch.object(sync.urllib.request, "build_opener", return_value=opener) as build, patch.object(sync, "read_json", side_effect=responses), patch("sys.stdout", new_callable=io.StringIO):
            result = sync.sync({"endpoint": "https://example.invalid", "key": "test"}, rows, targets, platform, "staging", verify_only=verify_only)
        return result, opener, build

    def test_uploaded_data_and_website_must_both_match(self):
        for platform in ("wallet", "business"):
            _, _, current = self.fixture(platform)
            result, opener, _ = self.run_sync(platform, [current, current, current])
            self.assertEqual(result, 0)
            self.assertEqual(opener.open.call_count, 1)
            stale = deepcopy(current)
            stale[platform]["periods"][0]["daily"][0]["details"][0]["consumption"] = 24
            self.assertEqual(self.run_sync(platform, [current, stale])[0], 1)
            self.assertEqual(self.run_sync(platform, [current, current, stale])[0], 1)

    def test_verify_only_never_posts(self):
        for platform in ("wallet", "business"):
            _, _, current = self.fixture(platform)
            result, _, build = self.run_sync(platform, [current, current], verify_only=True)
            self.assertEqual(result, 0)
            build.assert_not_called()

    def test_uncertain_post_is_verified_without_resending(self):
        for platform in ("wallet", "business"):
            _, _, current = self.fixture(platform)
            error = urllib.error.HTTPError("https://example.invalid", 502, "Bad Gateway", {}, None)
            result, opener, _ = self.run_sync(platform, [current, current, current], error)
            self.assertEqual(result, 0)
            self.assertEqual(opener.open.call_count, 1)

    def test_targets_and_same_date_amount_changes_are_detected(self):
        rows, targets, current = self.fixture("business")
        periods = current["business"]["periods"]
        sync.assert_source(periods, rows, targets, "business")
        targets[0]["target"] = 101
        with self.assertRaisesRegex(ValueError, "月目标"):
            sync.assert_source(periods, rows, targets, "business")
        targets[0]["target"] = 100
        rows[0]["open_card_virtual"] = 3
        with self.assertRaisesRegex(ValueError, "卡数"):
            sync.assert_source(periods, rows, targets, "business")

    def test_read_retries_transient_502_only(self):
        error = urllib.error.HTTPError("https://example.invalid", 502, "Bad Gateway", {}, None)
        with patch.object(sync.urllib.request, "urlopen", side_effect=[error, io.BytesIO(b'{"environment":"staging"}')]) as read, patch.object(sync.time, "sleep"):
            self.assertEqual(sync.read_json("https://example.invalid")["environment"], "staging")
            self.assertEqual(read.call_count, 2)
        error = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", {}, None)
        with patch.object(sync.urllib.request, "urlopen", side_effect=error) as read:
            with self.assertRaises(urllib.error.HTTPError):
                sync.read_json("https://example.invalid")
            self.assertEqual(read.call_count, 1)

    def test_production_website_requires_exact_content_and_environment(self):
        rows, targets, source = self.fixture("wallet")
        source["environment"] = "production"
        website = deepcopy(source)
        with patch.object(sync, "read_json", side_effect=[source, website]), patch.object(sync.urllib.request, "build_opener") as post:
            self.assertEqual(sync.sync({"endpoint": "https://example.invalid", "key": "test"}, rows, targets,
                "wallet", "production", verify_only=True), 0)
            post.assert_not_called()
        website.pop("environment")
        with patch.object(sync, "read_json", side_effect=[source, website]):
            self.assertEqual(sync.sync({"endpoint": "https://example.invalid", "key": "test"}, rows, targets,
                "wallet", "production", verify_only=True), 1)

if __name__ == "__main__":
    unittest.main()
