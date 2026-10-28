"""Scheduled Lambda: publish the LTA road-speed grid to S3, and keep the reading.

An EventBridge schedule runs it every 10 minutes: LTA updates every 5, but a
reading is 288 calls and the key's quota is about 3,000 calls an hour. The
console reads the published JSON, so no request ever waits on LTA's pages.
Each reading is also kept in the history (traffic/history/), from which the
typical traffic for any time of the week is built. Needs LTA_ACCOUNT_KEY and
TRAFFIC_BUCKET (and optionally TRAFFIC_KEY); the function's role needs
s3:PutObject on those keys. See docs/deployment.md.
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.services.traffic import grid_from_rows, keep_reading, read_live


def handler(event: Any = None, context: Any = None, s3: Any = None) -> dict[str, Any]:
    settings = get_settings()
    if not settings.traffic_bucket:
        raise RuntimeError("TRAFFIC_BUCKET is not set")
    reading = asyncio.run(read_live(settings.lta_account_key))
    fetched_at = datetime.now(timezone.utc)
    grid = grid_from_rows(reading.rows, fetched_at, reading.measured_at)
    if s3 is None:
        import boto3  # in the Lambda runtime; not needed locally

        s3 = boto3.client("s3")
    s3.put_object(
        Bucket=settings.traffic_bucket,
        Key=settings.traffic_key,
        Body=json.dumps(grid, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
        # browsers and CDNs may reuse it for a minute; the next run replaces it
        CacheControl="public, max-age=60",
    )
    kept = keep_reading(s3, settings.traffic_bucket, reading, fetched_at, grid["cells"])
    return {"fetchedAt": grid["fetchedAt"], "stretches": grid["stretches"], "cells": len(grid["cells"]), "kept": kept}
