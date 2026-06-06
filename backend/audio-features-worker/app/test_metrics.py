import unittest

try:
    from .metrics import WorkerMetrics
except ImportError:  # unittest discovery can import this module outside the package context.
    from metrics import WorkerMetrics


class WorkerMetricsTest(unittest.TestCase):
    def test_prometheus_text_includes_worker_counters(self) -> None:
        metrics = WorkerMetrics()
        metrics.mark_poll(3)
        metrics.mark_job_started()
        metrics.mark_job_completed()
        metrics.mark_job_started()
        metrics.mark_job_failed("download_failed")
        metrics.record_http("GET", "metrics", 200, 0.01)

        text = metrics.prometheus_text()
        self.assertIn("audio_features_worker_up 1", text)
        self.assertIn("audio_features_worker_pending_last 3", text)
        self.assertIn("audio_features_worker_jobs_started_total 2", text)
        self.assertIn("audio_features_worker_jobs_completed_total 1", text)
        self.assertIn('outcome="download_failed"', text)
        self.assertIn('route="metrics"', text)


if __name__ == "__main__":
    unittest.main()
