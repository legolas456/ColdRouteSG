"""Scheduled Lambda: publish the LTA road-speed grid to S3.

An EventBridge schedule runs it every 5 minutes, LTA's update interval. The
console reads the published JSON, so no request ever waits on LTA's ~100 pages.
Needs LTA_ACCOUNT_KEY and TRAFFIC_BUCKET (and optionally TRAFFIC_KEY); the
function's role needs s3:PutObject on that key. See docs/deployment.md.
"""
import asyncio
import json
from typing import Any

from app.config import get_settings
from app.services.traffic import read_live_grid


def handler(event: Any = None, context: Any = None, s3: Any = None) -> dict[str, Any]:
    settings = get_settings()
    if not settings.traffic_bucket:
        raise RuntimeError("TRAFFIC_BUCKET is not set")
    grid = asyncio.run(read_live_grid(settings.lta_account_key))
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
    return {"fetchedAt": grid["fetchedAt"], "stretches": grid["stretches"], "cells": len(grid["cells"])}
