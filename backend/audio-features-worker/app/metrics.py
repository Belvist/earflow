import threading
import time
from typing import Dict


def _safe_label(value: str, fallback: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return fallback
    out = []
    for ch in raw[:80]:
        if ch.isalnum() or ch in ("_", ":", "-"):
            out.append(ch)
        else:
            out.append("_")
    return "".join(out) or fallback


def _escape_label(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(values: Dict[str, str]) -> str:
    return ",".join(f'{k}="{_escape_label(v)}"' for k, v in values.items())


class WorkerMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.active_jobs = 0
        self.last_poll_at = 0.0
        self.pending_last = 0
        self.iterations_total = 0
        self.iteration_failures_total = 0
        self.jobs_started_total = 0
        self.jobs_completed_total = 0
        self.jobs_failed: Dict[str, int] = {}
        self.http: Dict[str, Dict[str, object]] = {}

    def mark_poll(self, pending_count: int) -> None:
        with self._lock:
            self.iterations_total += 1
            self.last_poll_at = time.time()
            self.pending_last = max(0, int(pending_count))

    def mark_iteration_failed(self) -> None:
        with self._lock:
            self.iteration_failures_total += 1

    def mark_job_started(self) -> None:
        with self._lock:
            self.jobs_started_total += 1
            self.active_jobs += 1

    def mark_job_completed(self) -> None:
        with self._lock:
            self.jobs_completed_total += 1
            self.active_jobs = max(0, self.active_jobs - 1)

    def mark_job_failed(self, outcome: str) -> None:
        key = _safe_label(outcome, "failed")
        with self._lock:
            self.jobs_failed[key] = self.jobs_failed.get(key, 0) + 1
            self.active_jobs = max(0, self.active_jobs - 1)

    def record_http(self, method: str, route: str, status: int, duration_seconds: float) -> None:
        method_label = _safe_label(method, "unknown").upper()
        route_label = _safe_label(route, "unknown")
        key = f"{method_label}\n{route_label}"
        code = str(int(status) if isinstance(status, int) else 500)
        duration = duration_seconds if duration_seconds >= 0 else 0.0
        with self._lock:
            item = self.http.setdefault(key, {"count": 0, "duration": 0.0, "statuses": {}})
            item["count"] = int(item["count"]) + 1
            item["duration"] = float(item["duration"]) + duration
            statuses = item["statuses"]
            assert isinstance(statuses, dict)
            statuses[code] = int(statuses.get(code, 0)) + 1

    def prometheus_text(self) -> str:
        with self._lock:
            jobs_failed = dict(self.jobs_failed)
            http = {
                key: {
                    "count": int(value["count"]),
                    "duration": float(value["duration"]),
                    "statuses": dict(value["statuses"]),
                }
                for key, value in self.http.items()
            }
            lines = [
                "# HELP audio_features_worker_up Worker readiness state.",
                "# TYPE audio_features_worker_up gauge",
                "audio_features_worker_up 1",
                "# HELP audio_features_worker_uptime_seconds Worker uptime in seconds.",
                "# TYPE audio_features_worker_uptime_seconds gauge",
                f"audio_features_worker_uptime_seconds {int(time.time() - self.started_at)}",
                "# HELP audio_features_worker_active_jobs Active feature extraction jobs.",
                "# TYPE audio_features_worker_active_jobs gauge",
                f"audio_features_worker_active_jobs {self.active_jobs}",
                "# HELP audio_features_worker_pending_last Last pending batch size.",
                "# TYPE audio_features_worker_pending_last gauge",
                f"audio_features_worker_pending_last {self.pending_last}",
                "# HELP audio_features_worker_last_poll_timestamp_seconds Last successful poll timestamp.",
                "# TYPE audio_features_worker_last_poll_timestamp_seconds gauge",
                f"audio_features_worker_last_poll_timestamp_seconds {int(self.last_poll_at)}",
                "# HELP audio_features_worker_iterations_total Worker poll iterations.",
                "# TYPE audio_features_worker_iterations_total counter",
                f"audio_features_worker_iterations_total {self.iterations_total}",
                "# HELP audio_features_worker_iteration_failures_total Worker poll iteration failures.",
                "# TYPE audio_features_worker_iteration_failures_total counter",
                f"audio_features_worker_iteration_failures_total {self.iteration_failures_total}",
                "# HELP audio_features_worker_jobs_started_total Feature extraction jobs started.",
                "# TYPE audio_features_worker_jobs_started_total counter",
                f"audio_features_worker_jobs_started_total {self.jobs_started_total}",
                "# HELP audio_features_worker_jobs_completed_total Feature extraction jobs completed.",
                "# TYPE audio_features_worker_jobs_completed_total counter",
                f"audio_features_worker_jobs_completed_total {self.jobs_completed_total}",
                "# HELP audio_features_worker_jobs_failed_total Feature extraction jobs failed by outcome.",
                "# TYPE audio_features_worker_jobs_failed_total counter",
            ]

            if jobs_failed:
                for outcome, count in jobs_failed.items():
                    lines.append(f"audio_features_worker_jobs_failed_total{{{_labels({'outcome': outcome})}}} {count}")
            else:
                lines.append(f"audio_features_worker_jobs_failed_total{{{_labels({'outcome': 'none'})}}} 0")

            lines.extend(
                [
                    "# HELP audio_features_worker_http_requests_total HTTP requests by method, route, and status.",
                    "# TYPE audio_features_worker_http_requests_total counter",
                ]
            )
            for key, item in http.items():
                method, route = (key.split("\n", 1) + ["unknown"])[:2]
                for status, count in item["statuses"].items():
                    lines.append(
                        f"audio_features_worker_http_requests_total{{{_labels({'method': method, 'route': route, 'status': status})}}} {count}"
                    )

            lines.extend(
                [
                    "# HELP audio_features_worker_http_request_duration_seconds HTTP request duration summary.",
                    "# TYPE audio_features_worker_http_request_duration_seconds summary",
                ]
            )
            for key, item in http.items():
                method, route = (key.split("\n", 1) + ["unknown"])[:2]
                label_set = _labels({"method": method, "route": route})
                lines.append(f"audio_features_worker_http_request_duration_seconds_sum{{{label_set}}} {item['duration']}")
                lines.append(f"audio_features_worker_http_request_duration_seconds_count{{{label_set}}} {item['count']}")

            lines.append("")
            return "\n".join(lines)
