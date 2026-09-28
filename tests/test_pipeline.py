import sys
from pathlib import Path
import tempfile
import unittest
import json
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/daily-operations/90-系统维护"))
import pipeline


class PipelineTests(unittest.TestCase):
    def test_shared_code_and_separate_data_for_both_platforms(self):
        for platform in ("upw", "upb"):
            production = pipeline.plan(platform, "production")
            staging = pipeline.plan(platform, "staging")
            for phase in ("calculate", "sync"):
                # Python executable, warnings, and code file must be identical.
                self.assertEqual(production[phase][:5], staging[phase][:5])
                self.assertIn(str(ROOT / "tools"), production[phase][4])
            self.assertNotEqual(production["settings"], staging["settings"])
            self.assertNotEqual(production["output"], staging["output"])
            self.assertIn("--expected-environment", production["sync"])
            self.assertIn("production", production["sync"])
            self.assertIn("staging", staging["sync"])
            self.assertIn("ranking-staging", staging["sync"][-1])
            if platform == "upw":
                for execution in (staging, production):
                    command = execution["calculate"]
                    self.assertEqual(command[command.index("--config") + 1], str(ROOT / "tools/upw-daily-pipeline/config.json"))

    def test_lock_serializes_platforms_and_releases_after_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, "simulated"):
                with pipeline.environment_lock("staging", directory):
                    with self.assertRaisesRegex(RuntimeError, "已有同步任务"):
                        with pipeline.environment_lock("staging", directory):
                            self.fail("second writer acquired the same environment")
                    with pipeline.environment_lock("production", directory):
                        pass
                    raise RuntimeError("simulated")
            with pipeline.environment_lock("staging", directory):
                pass

    def test_invalid_environment_is_rejected(self):
        with self.assertRaises(ValueError):
            pipeline.plan("upb", "prodution")

    def test_promotion_rejects_changed_code_or_changed_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            for name in ("business_daily_metrics.csv", "business_monthly_targets.csv"):
                (output / name).write_text("fixture")
            receipt = {"environment": "staging", "mode": "run", "status": "verified", "code_version": "tested",
                "outputs": pipeline.output_hashes(output)}
            (output / "last_success.json").write_text(json.dumps(receipt))
            with patch.object(pipeline, "plan", return_value={"output": output}), patch.object(pipeline, "code_version", return_value="tested"):
                self.assertEqual(pipeline.validated_staging("upb")["output"], output)
                (output / "business_daily_metrics.csv").write_text("changed")
                with self.assertRaisesRegex(ValueError, "输出在验收后发生变化"):
                    pipeline.validated_staging("upb")
            with patch.object(pipeline, "plan", return_value={"output": output}), patch.object(pipeline, "code_version", return_value="changed"):
                with self.assertRaisesRegex(ValueError, "代码已变化"):
                    pipeline.validated_staging("upb")


if __name__ == "__main__":
    unittest.main()
