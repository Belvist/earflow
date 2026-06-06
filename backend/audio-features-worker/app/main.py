import json
import logging
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Iterable, Optional, Tuple

import boto3
import requests

from .metrics import WorkerMetrics


def _configure_logging() -> logging.Logger:
    level_name = _env_str("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return logging.getLogger("audio-features-worker")


def _parse_positive_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        n = int(str(value).strip())
    except Exception:
        return None
    if n <= 0:
        return None
    return n


def _env_str(name: str, default: str = "") -> str:
    v = os.getenv(name)
    if v is None:
        return default
    return str(v)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw is not None else default
    except Exception:
        return default


def _clamp01(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return float(v)


def _safe_key_string(key: Optional[str], scale: Optional[str]) -> Optional[str]:
    if not key:
        return None
    k = str(key).strip()
    if not k:
        return None
    s = (str(scale).strip().lower() if scale else "")
    if s == "minor":
        return (k + "m")[:10]
    return k[:10]


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _text_response(handler: BaseHTTPRequestHandler, status: int, body: str, content_type: str) -> None:
    raw = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        started_at = time.monotonic()
        status = 500
        route = "other"
        try:
            if self.path == "/health":
                route = "health"
                status = 200
                _json_response(
                    self,
                    status,
                    {
                        "status": "ok",
                        "service": "audio-features-worker",
                        "uptime_seconds": time.time() - self.server.start_time,  # type: ignore[attr-defined]
                    },
                )
                return

            if self.path == "/metrics":
                route = "metrics"
                status = 200
                _text_response(
                    self,
                    status,
                    self.server.metrics.prometheus_text(),  # type: ignore[attr-defined]
                    "text/plain; version=0.0.4; charset=utf-8",
                )
                return

            status = 404
            _json_response(self, status, {"error": "Not found"})
        finally:
            self.server.metrics.record_http(  # type: ignore[attr-defined]
                self.command,
                route,
                status,
                time.monotonic() - started_at,
            )

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def _start_health_server(port: int, metrics: WorkerMetrics) -> HTTPServer:
    httpd = HTTPServer(("0.0.0.0", port), _HealthHandler)
    httpd.start_time = time.time()  # type: ignore[attr-defined]
    httpd.metrics = metrics  # type: ignore[attr-defined]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def _make_s3_client() -> Any:
    endpoint = _env_str("MINIO_ENDPOINT", "minio")
    port = _env_int("MINIO_PORT", 9000)
    use_ssl = _env_str("MINIO_USE_SSL", "false").lower() == "true"
    access_key = _env_str("MINIO_ACCESS_KEY")
    secret_key = _env_str("MINIO_SECRET_KEY")

    if not access_key or not secret_key:
        raise RuntimeError("MinIO credentials are not configured")

    scheme = "https" if use_ssl else "http"
    endpoint_url = f"{scheme}://{endpoint}:{port}"

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
    )


def _candidate_audio_keys(file_path: str) -> Iterable[str]:
    p = (file_path or "").lstrip("/")
    if p:
        yield p
    if p and not p.startswith("audio/"):
        yield f"audio/{p}"
    base = os.path.basename(p)
    if base and base != p:
        yield base
        yield f"audio/{base}"
        yield f"audio/library/{base}"


def _infer_suffix(file_path: str, key: str) -> str:
    for source in (key, file_path):
        _root, ext = os.path.splitext(str(source or ""))
        ext = ext.strip().lower()
        if 1 <= len(ext) <= 10 and ext.startswith(".") and ext[1:].isalnum():
            return ext
    return ".mp3"


def _download_audio(s3: Any, bucket: str, file_path: str) -> Tuple[str, str]:
    last_err: Optional[Exception] = None
    for key in _candidate_audio_keys(file_path):
        try:
            suffix = _infer_suffix(file_path, key)
            tmp = tempfile.NamedTemporaryFile(prefix="audio_", suffix=suffix, delete=False)
            tmp.close()
            s3.download_file(bucket, key, tmp.name)
            return tmp.name, key
        except Exception as e:
            last_err = e
            try:
                if "tmp" in locals() and os.path.exists(tmp.name):
                    os.unlink(tmp.name)
            except Exception:
                pass

    raise RuntimeError(f"Failed to download audio for {file_path}") from last_err


def _get_service_token(db_service_url: str, service_key: str, timeout_s: int) -> str:
    resp = requests.post(
        f"{db_service_url}/auth/service-token",
        json={"serviceName": "audio-features-worker", "serviceKey": service_key},
        timeout=timeout_s,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"service-token request failed: status={resp.status_code} body={resp.text[:500]}")
    data = resp.json()
    token = str(data.get("token") or "")
    if not token:
        raise RuntimeError("Token not returned")
    return token


def _fetch_pending(db_service_url: str, token: str, limit: int, timeout_s: int) -> Iterable[Dict[str, Any]]:
    resp = requests.get(
        f"{db_service_url}/api/song-features/pending",
        headers={"X-Service-Token": token},
        params={"limit": str(limit)},
        timeout=timeout_s,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"pending request failed: status={resp.status_code} body={resp.text[:500]}")
    data = resp.json()
    items = data.get("items")
    if not isinstance(items, list):
        return []
    return items


def _upsert_features(db_service_url: str, token: str, payload: Dict[str, Any], timeout_s: int) -> None:
    resp = requests.post(
        f"{db_service_url}/api/song-features/upsert",
        headers={"X-Service-Token": token, "Content-Type": "application/json"},
        json=payload,
        timeout=timeout_s,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"upsert failed: status={resp.status_code} body={resp.text[:500]}")


def _safe_float(features: Any, key: str) -> Optional[float]:
    try:
        v = float(features[key])
        return v if (v == v) else None
    except Exception:
        return None


def _safe_float_mean(features: Any, key: str) -> Optional[float]:
    try:
        raw = features[key]
        try:
            import numpy as np
            arr = np.asarray(raw, dtype=float).ravel()
            if arr.size == 0:
                return None
            v = float(arr.mean())
        except Exception:
            v = float(raw)
        return v if (v == v) else None
    except Exception:
        return None


def _extract_features(audio_path: str) -> Dict[str, Any]:
    import essentia.standard as es

    extractor = es.MusicExtractor(
        lowlevelStats=["mean", "stdev"],
        rhythmStats=["mean"],
        tonalStats=["mean"],
    )
    features, _frames = extractor(audio_path)

    bpm_value = _safe_float(features, "rhythm.bpm")

    dance_raw = _safe_float(features, "rhythm.danceability")
    danceability = _clamp01(dance_raw / 3.0 if dance_raw is not None else None)

    key_name: Optional[str] = None
    key_scale: Optional[str] = None
    try:
        key_name = str(features["tonal.key_krumhansl.key"])
        key_scale = str(features["tonal.key_krumhansl.scale"])
    except Exception:
        pass

    bpm_int: Optional[int] = None
    if bpm_value is not None and bpm_value > 0:
        bpm_int = int(round(bpm_value))

    energy_raw = _safe_float(features, "lowlevel.loudness_ebu128.integrated.mean")
    energy: Optional[float] = None
    if energy_raw is not None:
        energy = _clamp01((energy_raw + 70.0) / 70.0)
    else:
        rms_raw = _safe_float(features, "lowlevel.average_loudness")
        energy = _clamp01(rms_raw)

    valence_raw = _safe_float(features, "tonal.chords_changes_rate")
    valence: Optional[float] = None
    if valence_raw is not None:
        valence = _clamp01(valence_raw * 10.0)

    mfcc_stdev = _safe_float_mean(features, "lowlevel.mfcc.stdev")
    acousticness: Optional[float] = None
    if mfcc_stdev is not None:
        acousticness = _clamp01(1.0 - min(mfcc_stdev / 200.0, 1.0))

    hfc_raw = _safe_float(features, "lowlevel.hfc.mean")
    instrumentalness: Optional[float] = None
    if hfc_raw is not None:
        instrumentalness = _clamp01(1.0 - min(hfc_raw / 500.0, 1.0))

    zerocr_raw = _safe_float(features, "lowlevel.zerocrossingrate.mean")
    liveness: Optional[float] = None
    if zerocr_raw is not None:
        liveness = _clamp01(zerocr_raw * 10.0)

    flatness_raw = _safe_float_mean(features, "lowlevel.spectral_flatness_db.mean")
    speechiness: Optional[float] = None
    if flatness_raw is not None:
        speechiness = _clamp01((flatness_raw + 60.0) / 60.0)

    payload: Dict[str, Any] = {
        "tempo": bpm_value,
        "bpm": bpm_int,
        "danceability": danceability,
        "key": _safe_key_string(key_name, key_scale),
        "energy": energy,
        "valence": valence,
        "acousticness": acousticness,
        "instrumentalness": instrumentalness,
        "liveness": liveness,
        "speechiness": speechiness,
        "mood": None,
    }

    return payload


def main() -> None:
    logger = _configure_logging()
    metrics = WorkerMetrics()
    health_port = _env_int("HEALTH_PORT", 3051)
    _start_health_server(health_port, metrics)

    db_service_url = _env_str("DB_SERVICE_URL", "").strip().rstrip("/")
    if not db_service_url:
        db_service_url = _env_str("DATABASE_SERVICE_URL", "").strip().rstrip("/")
    if not db_service_url:
        db_service_url = "http://database-service:3003"
    service_key = _env_str("SERVICE_KEY_AUDIO_FEATURES_WORKER")

    minio_bucket_audio = _env_str("MINIO_BUCKET_AUDIO", "music-audio")

    poll_interval_s = max(2, _env_int("POLL_INTERVAL_SECONDS", 30))
    batch_limit = max(1, min(_env_int("BATCH_LIMIT", 25), 200))
    request_timeout_s = max(2, _env_int("REQUEST_TIMEOUT_SECONDS", 20))

    if not service_key:
        raise RuntimeError("SERVICE_KEY_AUDIO_FEATURES_WORKER is not set")

    s3 = _make_s3_client()

    while True:
        try:
            token = _get_service_token(db_service_url, service_key, request_timeout_s)
            pending = list(_fetch_pending(db_service_url, token, batch_limit, request_timeout_s))
            metrics.mark_poll(len(pending))

            if not pending:
                time.sleep(poll_interval_s)
                continue

            for item in pending:
                song_id = _parse_positive_int(item.get("id"))
                file_path = item.get("file_path")

                if song_id is None or not file_path:
                    logger.warning("skip item with invalid id or file_path")
                    metrics.mark_job_failed("invalid_item")
                    continue

                audio_path: Optional[str] = None
                used_key: Optional[str] = None
                metrics.mark_job_started()
                try:
                    audio_path, used_key = _download_audio(s3, minio_bucket_audio, str(file_path))
                    features_payload = _extract_features(audio_path)
                    features_payload["songId"] = song_id
                    _upsert_features(db_service_url, token, features_payload, request_timeout_s)
                    metrics.mark_job_completed()
                    logger.info("features upserted")
                except Exception:
                    metrics.mark_job_failed("process_failed")
                    logger.exception(
                        "failed to process item",
                        extra={
                            "song_id": song_id,
                            "file_path": str(file_path)[:200],
                            "minio_key": (used_key or "")[:200],
                        },
                    )
                finally:
                    try:
                        if audio_path and os.path.exists(audio_path):
                            os.unlink(audio_path)
                    except Exception:
                        pass

        except Exception:
            metrics.mark_iteration_failed()
            logger.exception("iteration failed")
            time.sleep(poll_interval_s)


if __name__ == "__main__":
    main()
