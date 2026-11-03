"""Typical traffic for any time of the week, built from the readings the refresh keeps.

Every reading in traffic/history/ carries its grid's cell factors. Each night
traffic_profile.py groups the last PROFILE_DAYS days of readings by day type
(weekday or weekend) and SLOT_MINUTES slot of Singapore time, and publishes one
grid per slot: each cell's median factor over the slot's readings. A plan that
leaves too long after the latest live reading uses the typical grid for its
departure instead of assuming free-flowing traffic.
"""
from __future__ import annotations

import gzip
import json
import statistics
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any, Optional

from app.services.traffic import CELL_DEG, GRID_ORIGIN, HISTORY_PREFIX, MAX_FACTOR, SGT, SLOW_FACTOR

SLOT_MINUTES = 15
PROFILE_DAYS = 28
# a slot needs this many readings, or one odd day would set it
MIN_READINGS = 3
PROFILE_PREFIX = "traffic/typical/"
INDEX_KEY = f"{PROFILE_PREFIX}index.json"
# kept readings are small; read them in parallel
FETCH_WORKERS = 16


def day_type(at: datetime) -> str:
    """Weekday or weekend in Singapore. Public holidays count as weekdays for now."""
    return "weekend" if at.astimezone(SGT).weekday() >= 5 else "weekday"


def slot_of(at: datetime) -> str:
    """The slot a time falls in, as HHMM of its start in Singapore time: 08:52 is 0845."""
    local = at.astimezone(SGT)
    minute = (local.hour * 60 + local.minute) // SLOT_MINUTES * SLOT_MINUTES
    return f"{minute // 60:02d}{minute % 60:02d}"


def profile_key(day: str, slot: str) -> str:
    return f"{PROFILE_PREFIX}{day}/{slot}.json"


def reading_time(key: str) -> Optional[datetime]:
    """When a kept reading was measured, from its key: traffic/history/YYYY/MM/DD/HHMM.json.gz."""
    stamp = key[len(HISTORY_PREFIX) :].removesuffix(".json.gz")
    try:
        return datetime.strptime(stamp, "%Y/%m/%d/%H%M").replace(tzinfo=SGT)
    except ValueError:
        return None


def build_slot(readings: list[list[list[float]]], day: str, slot: str, days: int, built_at: datetime) -> dict[str, Any]:
    """One slot's grid, in the live grid's format: per cell, the median factor over the readings that have it."""
    factors: dict[tuple[int, int], list[float]] = defaultdict(list)
    road_km: dict[tuple[int, int], float] = {}
    for cells in readings:
        for i, j, factor, km in cells:
            factors[(int(i), int(j))].append(float(factor))
            road_km[(int(i), int(j))] = float(km)
    cells_out = [
        [i, j, round(min(MAX_FACTOR, max(1.0, statistics.median(values))), 2), road_km[(i, j)]]
        for (i, j), values in sorted(factors.items())
        # each cell needs MIN_READINGS of its own, or one jam would set it
        if len(values) >= MIN_READINGS
    ]
    total = sum(km for *_, km in cells_out)
    slow = sum(km for _, _, factor, km in cells_out if factor >= SLOW_FACTOR)
    built = built_at.astimezone(SGT).isoformat(timespec="seconds")
    return {
        "version": 1,
        "source": "Typical traffic from kept LTA readings",
        "dayType": day,
        "slot": slot,
        "slotMinutes": SLOT_MINUTES,
        "readings": len(readings),
        "days": days,
        # the console's grid parser wants a time; a typical grid's is when it was built
        "fetchedAt": built,
        "measuredAt": None,
        "origin": list(GRID_ORIGIN),
        "cellDeg": CELL_DEG,
        "roadKm": round(total, 1),
        "slowShare": round(slow / total, 3) if total else 0.0,
        "cells": cells_out,
    }


def _history_keys(s3: Any, bucket: str, now: datetime) -> list[str]:
    """The kept readings of the last PROFILE_DAYS days, listed day by day."""
    keys: list[str] = []
    today = now.astimezone(SGT).date()
    for back in range(PROFILE_DAYS):
        prefix = f"{HISTORY_PREFIX}{today - timedelta(days=back):%Y/%m/%d}/"
        token: Optional[str] = None
        while True:
            page = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, **({"ContinuationToken": token} if token else {}))
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
    return keys


def _cells(s3: Any, bucket: str, key: str) -> list[list[float]]:
    record = json.loads(gzip.decompress(s3.get_object(Bucket=bucket, Key=key)["Body"].read()))
    return record.get("cells") or []


def build_profile(s3: Any, bucket: str, now: datetime) -> dict[str, Any]:
    """Publish a grid per day type and slot with enough readings, and an index of them; returns the index."""
    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for key in _history_keys(s3, bucket, now):
        at = reading_time(key)
        if at is not None:
            groups[(day_type(at), slot_of(at))].append(key)

    slots: dict[str, dict[str, Any]] = {"weekday": {}, "weekend": {}}
    with ThreadPoolExecutor(FETCH_WORKERS) as pool:
        for (day, slot), keys in sorted(groups.items()):
            if len(keys) < MIN_READINGS:
                continue
            readings = [cells for cells in pool.map(lambda k: _cells(s3, bucket, k), keys) if cells]
            if len(readings) < MIN_READINGS:
                continue
            days = len({reading_time(k).date() for k in keys})  # type: ignore[union-attr]
            grid = build_slot(readings, day, slot, days, now)
            s3.put_object(
                Bucket=bucket,
                Key=profile_key(day, slot),
                Body=json.dumps(grid, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )
            slots[day][slot] = {"readings": grid["readings"], "days": days, "slowShare": grid["slowShare"]}

    index = {
        "version": 1,
        "builtAt": now.astimezone(SGT).isoformat(timespec="seconds"),
        "slotMinutes": SLOT_MINUTES,
        "profileDays": PROFILE_DAYS,
        "minReadings": MIN_READINGS,
        "slots": slots,
    }
    s3.put_object(Bucket=bucket, Key=INDEX_KEY, Body=json.dumps(index, separators=(",", ":")).encode("utf-8"), ContentType="application/json")
    return index


CACHE_SECONDS = 3600
_cached: dict[str, tuple[float, Optional[dict[str, Any]]]] = {}


def typical_grid(at: datetime, s3: Any = None) -> Optional[dict[str, Any]]:
    """The typical grid for a departure, read from the traffic bucket at most once an hour per slot."""
    import time

    from app.config import get_settings

    settings = get_settings()
    if not settings.traffic_bucket:
        raise LookupError("Typical traffic needs the scheduled traffic service (TRAFFIC_BUCKET is not set).")
    if at.tzinfo is None:
        at = at.replace(tzinfo=SGT)
    key = profile_key(day_type(at), slot_of(at))
    hit = _cached.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    if s3 is None:
        import boto3  # in the Lambda runtime and requirements.txt

        s3 = boto3.client("s3")
    grid = read_typical_grid(s3, settings.traffic_bucket, at)
    _cached[key] = (time.monotonic(), grid)
    return grid


def read_typical_grid(s3: Any, bucket: str, at: datetime) -> Optional[dict[str, Any]]:
    """The typical grid for a departure time, or None if that slot has none.

    The latest nightly build's index decides: a slot it left out (too few recent
    readings) is not served, although its older grid is still in the bucket.
    """
    index = _read_json(s3, bucket, INDEX_KEY)
    day, slot = day_type(at), slot_of(at)
    if not index or slot not in (index.get("slots") or {}).get(day, {}):
        return None
    return _read_json(s3, bucket, profile_key(day, slot))


def _read_json(s3: Any, bucket: str, key: str) -> Optional[dict[str, Any]]:
    from botocore.exceptions import ClientError  # with boto3: in the Lambda runtime and requirements.txt

    try:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except ClientError as exc:
        # the API's role may list the prefix, so a missing object is a 404, not a 403
        if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            return None
        raise
    return json.loads(body)
