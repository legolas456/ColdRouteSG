"""Scheduled Lambda: build typical traffic from the kept LTA readings.

An EventBridge schedule runs it once a night. It reads the last weeks of
readings in traffic/history/ and publishes a grid for each weekday and weekend
slot to traffic/typical/ (see app/services/typical.py). Needs TRAFFIC_BUCKET;
the function's role needs to list and read traffic/history/ and write
traffic/typical/.
"""
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.services.typical import build_profile


def handler(event: Any = None, context: Any = None, s3: Any = None) -> dict[str, Any]:
    settings = get_settings()
    if not settings.traffic_bucket:
        raise RuntimeError("TRAFFIC_BUCKET is not set")
    if s3 is None:
        import boto3  # in the Lambda runtime; not needed locally

        s3 = boto3.client("s3")
    index = build_profile(s3, settings.traffic_bucket, datetime.now(timezone.utc))
    return {"builtAt": index["builtAt"], "slots": {day: len(slots) for day, slots in index["slots"].items()}}
