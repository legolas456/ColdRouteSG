"""Live road speeds from LTA DataMall Traffic Speed Bands, summarised for routing.

LTA publishes a speed band for every stretch of expressway and arterial road
every 5 minutes. The console cannot read it directly: the API needs an
AccountKey, which must stay on the server. This module fetches every page,
turns each stretch into a delay factor (its free-flow speed over its current
speed) and averages the factors onto cells of about 1 km. The browser scales
each planned leg by the cells along its corridor (frontend/src/lib/traffic.ts).

Run `python -m app.services.traffic --out grid.json` to save a snapshot.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from app.config import Settings, get_settings
from app.services.geo import haversine_km

SPEED_BANDS_URL = "https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands"
# LTA returns at most 500 records per call; $skip pages through the rest.
PAGE_SIZE = 500
PAGES_PER_BATCH = 8
# 200,000 records, far more than LTA has; only stops a runaway loop.
MAX_PAGES = 400

SGT = timezone(timedelta(hours=8))
# Cells are 0.01 degree (about 1.1 km) from a corner south-west of Tuas.
GRID_ORIGIN = (103.55, 1.15)
CELL_DEG = 0.01
LNG_RANGE = (103.55, 104.15)
LAT_RANGE = (1.15, 1.50)

# Speed bands are 10 km/h ranges: 1 is under 10 km/h, 8 is 70 km/h or more.
# Each band stands for the middle of its range.
BAND_KMH = {1: 5.0, 2: 15.0, 3: 25.0, 4: 35.0, 5: 45.0, 6: 55.0, 7: 65.0, 8: 75.0}
# Free-flow speed by LTA road category: 1 expressways, 2 major arterial,
# 3 arterial, 4 minor arterial, 5 small roads, 6 slip roads, 8 short tunnels.
FREE_FLOW_KMH = {1: 75.0, 2: 55.0, 3: 45.0, 4: 45.0, 5: 35.0, 6: 45.0, 8: 65.0}
DEFAULT_FREE_FLOW_KMH = 45.0
# Older API versions used letters for the road category.
LETTER_CATEGORY = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6}
# A crawl at 5 km/h would read as 15 times free flow; cap it so a single
# jammed stretch cannot dominate a cell.
MAX_FACTOR = 3.0
# A stretch counts as slow from 1.5 times its free-flow travel time.
SLOW_FACTOR = 1.5
CACHE_SECONDS = 300


class TrafficUnavailable(Exception):
    """Live road speeds cannot be read; the message says why, in plain words."""


@dataclass(frozen=True)
class Stretch:
    link_id: str
    road: str
    category: int
    band: int
    start: tuple[float, float]  # lng, lat
    end: tuple[float, float]

    @property
    def km(self) -> float:
        return haversine_km(self.start[1], self.start[0], self.end[1], self.end[0])

    @property
    def mid(self) -> tuple[float, float]:
        return ((self.start[0] + self.end[0]) / 2, (self.start[1] + self.end[1]) / 2)

    @property
    def factor(self) -> float:
        free = FREE_FLOW_KMH.get(self.category, DEFAULT_FREE_FLOW_KMH)
        return min(MAX_FACTOR, max(1.0, free / BAND_KMH[self.band]))


def _category(value: Any) -> int:
    text = str(value).strip().upper()
    if text in LETTER_CATEGORY:
        return LETTER_CATEGORY[text]
    try:
        return int(float(text))
    except ValueError:
        return 0


def parse_stretch(row: dict[str, Any]) -> Optional[Stretch]:
    """One LTA record, or None if it lacks a valid band or Singapore coordinates."""
    try:
        band = int(float(row["SpeedBand"]))
        lng1, lat1, lng2, lat2 = (float(row[k]) for k in ("StartLon", "StartLat", "EndLon", "EndLat"))
    except (KeyError, TypeError, ValueError):
        return None
    if band not in BAND_KMH:
        return None
    for lng, lat in ((lng1, lat1), (lng2, lat2)):
        if not (LNG_RANGE[0] <= lng < LNG_RANGE[1] and LAT_RANGE[0] <= lat < LAT_RANGE[1]):
            return None
    return Stretch(
        link_id=str(row.get("LinkID", "")),
        road=str(row.get("RoadName", "")),
        category=_category(row.get("RoadCategory")),
        band=band,
        start=(lng1, lat1),
        end=(lng2, lat2),
    )


def cell_of(lng: float, lat: float) -> tuple[int, int]:
    # math.floor of the same division as Math.floor in traffic.ts, so both sides agree
    return math.floor((lng - GRID_ORIGIN[0]) / CELL_DEG), math.floor((lat - GRID_ORIGIN[1]) / CELL_DEG)


def build_grid(stretches: list[Stretch], fetched_at: datetime) -> dict[str, Any]:
    """Length-weighted mean delay factor per cell, keyed by each stretch's midpoint."""
    sums: dict[tuple[int, int], list[float]] = {}
    total_km = slow_km = 0.0
    for s in stretches:
        # a zero-length stretch still reports a speed; give it a token length
        km = max(s.km, 0.01)
        acc = sums.setdefault(cell_of(*s.mid), [0.0, 0.0])
        acc[0] += s.factor * km
        acc[1] += km
        total_km += km
        if s.factor >= SLOW_FACTOR:
            slow_km += km
    return {
        "version": 1,
        "source": "LTA DataMall Traffic Speed Bands v4",
        "fetchedAt": fetched_at.astimezone(SGT).isoformat(timespec="seconds"),
        "origin": list(GRID_ORIGIN),
        "cellDeg": CELL_DEG,
        "stretches": len(stretches),
        "roadKm": round(total_km, 1),
        "slowShare": round(slow_km / total_km, 3) if total_km else 0.0,
        "freeFlowKmh": {str(k): v for k, v in FREE_FLOW_KMH.items()},
        # [i, j, factor, road km]
        "cells": [[i, j, round(f / km, 2), round(km, 2)] for (i, j), (f, km) in sorted(sums.items())],
    }


async def fetch_speed_bands(account_key: str, client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Every record, a batch of pages at a time, until a page comes back short."""
    if not account_key:
        raise TrafficUnavailable("No LTA DataMall AccountKey is configured (set LTA_ACCOUNT_KEY).")
    headers = {"AccountKey": account_key, "accept": "application/json"}

    async def page(skip: int) -> list[dict[str, Any]]:
        # LTA's examples use a literal "$skip"; keep it out of params so it is not encoded
        response = await client.get(f"{SPEED_BANDS_URL}?$skip={skip}", headers=headers)
        if response.status_code in (401, 403):
            raise TrafficUnavailable("LTA DataMall rejected the AccountKey.")
        response.raise_for_status()
        rows = response.json().get("value")
        if not isinstance(rows, list):
            raise TrafficUnavailable("LTA DataMall returned an unexpected response.")
        return rows

    rows: list[dict[str, Any]] = []
    for first in range(0, MAX_PAGES, PAGES_PER_BATCH):
        pages = await asyncio.gather(*(page((first + k) * PAGE_SIZE) for k in range(PAGES_PER_BATCH)))
        for rows_on_page in pages:
            rows.extend(rows_on_page)
        if any(len(rows_on_page) < PAGE_SIZE for rows_on_page in pages):
            return rows
    raise TrafficUnavailable("LTA DataMall kept returning full pages, so the fetch was stopped.")


async def read_live_grid(
    account_key: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    owned = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=get_settings().request_timeout_seconds)
    try:
        rows = await fetch_speed_bands(account_key, client)
    except httpx.HTTPError as exc:
        raise TrafficUnavailable(f"LTA DataMall did not respond ({exc.__class__.__name__}).") from exc
    finally:
        if owned:
            await client.aclose()
    return grid_from_rows(rows, now or datetime.now(timezone.utc))


def grid_from_rows(rows: list[dict[str, Any]], fetched_at: datetime) -> dict[str, Any]:
    stretches = [s for s in map(parse_stretch, rows) if s]
    if not stretches:
        raise TrafficUnavailable("LTA DataMall returned no usable road speeds.")
    return build_grid(stretches, fetched_at)


def read_published_grid(settings: Settings, s3: Any = None) -> dict[str, Any]:
    """The grid the scheduled job (traffic_refresh.py) last wrote to S3."""
    try:
        if s3 is None:
            import boto3  # in the Lambda runtime; not needed for local runs

            s3 = boto3.client("s3")
        body = s3.get_object(Bucket=settings.traffic_bucket, Key=settings.traffic_key)["Body"].read()
        return json.loads(body)
    except Exception as exc:  # noqa: BLE001 - any S3 or parse failure means no grid
        raise TrafficUnavailable(f"The published road-speed grid could not be read ({exc.__class__.__name__}).") from exc


_cached: Optional[tuple[float, dict[str, Any]]] = None
_lock = asyncio.Lock()


async def traffic_grid() -> dict[str, Any]:
    """The current grid, read at most once per CACHE_SECONDS (LTA updates every 5 minutes)."""
    global _cached
    settings = get_settings()
    async with _lock:
        if _cached and time.monotonic() - _cached[0] < CACHE_SECONDS:
            return _cached[1]
        if settings.traffic_bucket:
            grid = await asyncio.to_thread(read_published_grid, settings)
        else:
            grid = await read_live_grid(settings.lta_account_key)
        _cached = (time.monotonic(), grid)
        return grid


def main() -> None:
    parser = argparse.ArgumentParser(description="Save the current LTA road-speed grid as JSON.")
    parser.add_argument("--out", required=True, help="where to write the grid")
    parser.add_argument("--raw", help="also save the raw LTA records here")
    args = parser.parse_args()
    settings = get_settings()

    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            return await fetch_speed_bands(settings.lta_account_key, client)

    rows = asyncio.run(fetch())
    if args.raw:
        with open(args.raw, "w", encoding="utf-8") as f:
            json.dump(rows, f)
    grid = grid_from_rows(rows, datetime.now(timezone.utc))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(grid, f, separators=(",", ":"))
    print(f"{len(rows)} records, {grid['stretches']} usable, {len(grid['cells'])} cells, {grid['slowShare']:.1%} slow, at {grid['fetchedAt']}")


if __name__ == "__main__":
    main()
