"""Live road speeds from LTA DataMall Traffic Speed Bands, summarised for routing.

LTA publishes a speed band for every stretch of expressway and arterial road
every 5 minutes. The console cannot read it directly: the API needs an
AccountKey, which must stay on the server. This module fetches every page and,
for each cell of about 1 km, compares how fast its roads ran at night with how
fast they run now: the cell's delay factor. The browser scales each planned
leg by the cells along its corridor (frontend/src/lib/traffic.ts).

Run `python -m app.services.traffic --out grid.json` to save a snapshot, and
`python -m app.services.traffic --baseline night1.json night2.json --out
app/data/speed_baseline.json` to rebuild the night baseline from raw readings
saved with --raw.
"""
from __future__ import annotations

import argparse
import asyncio
import functools
import gzip
import hashlib
import json
import math
import time
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, NamedTuple, Optional

import httpx

from app.config import Settings, get_settings
from app.services.geo import haversine_km

SPEED_BANDS_URL = "https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands"
# LTA returns at most 500 records per call; $skip pages through the rest.
PAGE_SIZE = 500
PAGES_PER_BATCH = 16
# 300,000 records, about twice what LTA has (143,787 on 27 Oct 2026); only stops a runaway loop.
MAX_PAGES = 600
# LTA sometimes answers one page with a 500 when many are asked for at once.
# Retry that page with backoff rather than lose the whole reading.
PAGE_ATTEMPTS = 4
RETRY_SECONDS = 0.5

SGT = timezone(timedelta(hours=8))
# Cells are 0.01 degree (about 1.1 km) from a corner south-west of Tuas.
GRID_ORIGIN = (103.55, 1.15)
CELL_DEG = 0.01
LNG_RANGE = (103.55, 104.15)
LAT_RANGE = (1.15, 1.50)

# Speed bands are 10 km/h ranges: 1 is under 10 km/h, 8 is 70 km/h or more.
# Each band stands for the middle of its range.
BAND_KMH = {1: 5.0, 2: 15.0, 3: 25.0, 4: 35.0, 5: 45.0, 6: 55.0, 7: 65.0, 8: 75.0}
# A stretch's free-flow speed is its own band at night (BASELINE_PATH): the
# lower quartile of readings taken while the roads are empty, five on 29 Oct
# 2026 from 02:50 to 04:20, so one slow moment does not set it. One speed per
# road category does not work: at 02:50, with the roads empty, a quarter of
# arterial and slip-road km still read 1.5 times slower than their category's
# speed (junctions and bends, not traffic), adding 31% to the sample run.
# Night bands flicker (all five agreed on 28% of road km); against the median
# they leave 4% of phantom slowdown, against the lower quartile 0.4%, at the
# cost of daytime slowdowns reading about 5% smaller.
NIGHT_QUANTILE = 0.25
BASELINE_PATH = Path(__file__).resolve().parent.parent / "data" / "speed_baseline.json"
# The road categories whose bands track traffic: 1 expressways, 2 major
# arterial, 3 arterial, 6 slip roads, 8 short tunnels, each with the free-flow
# speed for a stretch the night baseline does not know (a road opened since):
# the category's 85th-percentile band speed in two daytime readings (27 Oct
# 2026, 07:16 and 10:33). Minor arterials (4) and small roads (5) are left
# out: their bands were the same at both times (a third of small roads under
# 10 km/h), so they show stop-start between junctions, which OSRM's times
# already include, not traffic.
FREE_FLOW_KMH = {1: 75.0, 2: 55.0, 3: 45.0, 6: 55.0, 8: 45.0}
# Older API versions used letters for the road category.
LETTER_CATEGORY = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6}
# A crawl at 5 km/h would read as 15 times free flow; cap it so one jam cannot
# stretch a leg without limit.
MAX_FACTOR = 3.0
# Road counts as slow from 1.5 times its free-flow travel time.
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
    # its band in the night baseline, if the baseline has it
    night_band: Optional[int] = None

    @property
    def km(self) -> float:
        return haversine_km(self.start[1], self.start[0], self.end[1], self.end[0])

    @property
    def mid(self) -> tuple[float, float]:
        return ((self.start[0] + self.end[0]) / 2, (self.start[1] + self.end[1]) / 2)

    @property
    def for_routing(self) -> bool:
        return self.category in FREE_FLOW_KMH

    @property
    def free_flow_kmh(self) -> float:
        return BAND_KMH[self.night_band] if self.night_band is not None else FREE_FLOW_KMH[self.category]

    @property
    def factor(self) -> float:
        """This stretch's own slowdown: the factor of a cell with no other stretch."""
        return min(MAX_FACTOR, max(1.0, self.free_flow_kmh / BAND_KMH[self.band]))


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


def lta_time(value: Any) -> Optional[datetime]:
    """LTA's lastUpdatedTime, e.g. '2026-10-27 10:25:00', which is Singapore time."""
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SGT)
    except ValueError:
        return None


def build_grid(stretches: list[Stretch], fetched_at: datetime, measured_at: Optional[datetime] = None) -> dict[str, Any]:
    """Per cell, its roads' length-weighted free-flow speed over their speed now.

    Keyed by each stretch's midpoint. Averaging speeds rather than each
    stretch's own factor matters: bands flicker a step up or down between
    readings, and a stretch's factor counts a slower step as traffic but
    cannot go below 1 for a faster one, so on empty roads cells read 6% slow;
    with averaged speeds the steps cancel (0.4%).
    """
    # per cell: free-flow speed x km, speed now x km, km
    sums: dict[tuple[int, int], list[float]] = {}
    night_km = 0.0
    for s in stretches:
        # a zero-length stretch still reports a speed; give it a token length
        km = max(s.km, 0.01)
        acc = sums.setdefault(cell_of(*s.mid), [0.0, 0.0, 0.0])
        acc[0] += s.free_flow_kmh * km
        acc[1] += BAND_KMH[s.band] * km
        acc[2] += km
        if s.night_band is not None:
            night_km += km
    cells = [(i, j, min(MAX_FACTOR, max(1.0, free / now)), km) for (i, j), (free, now, km) in sorted(sums.items())]
    total_km = sum(km for *_, km in cells)
    slow_km = sum(km for _, _, factor, km in cells if factor >= SLOW_FACTOR)
    return {
        "version": 1,
        "source": "LTA DataMall Traffic Speed Bands v4",
        "fetchedAt": fetched_at.astimezone(SGT).isoformat(timespec="seconds"),
        # when LTA measured these speeds; the console prefers it to fetchedAt
        "measuredAt": measured_at.astimezone(SGT).isoformat(timespec="seconds") if measured_at else None,
        "origin": list(GRID_ORIGIN),
        "cellDeg": CELL_DEG,
        "stretches": len(stretches),
        "roadKm": round(total_km, 1),
        # share of road km in cells running at SLOW_FACTOR or worse
        "slowShare": round(slow_km / total_km, 3) if total_km else 0.0,
        # share of road km measured against its own night speed; the rest uses freeFlowKmh
        "nightShare": round(night_km / total_km, 3) if total_km else 0.0,
        "freeFlowKmh": {str(k): v for k, v in FREE_FLOW_KMH.items()},
        # [i, j, factor, road km]
        "cells": [[i, j, round(factor, 2), round(km, 2)] for i, j, factor, km in cells],
    }


class Reading(NamedTuple):
    rows: list[dict[str, Any]]
    # LTA's own time for the speeds, from the first page, if it sent one
    measured_at: Optional[datetime]


async def fetch_speed_bands(account_key: str, client: httpx.AsyncClient) -> Reading:
    """Every record, a batch of pages at a time, until a page comes back short."""
    if not account_key:
        raise TrafficUnavailable("No LTA DataMall AccountKey is configured (set LTA_ACCOUNT_KEY).")
    headers = {"AccountKey": account_key, "accept": "application/json"}
    measured_at: Optional[datetime] = None

    async def page(skip: int) -> list[dict[str, Any]]:
        nonlocal measured_at
        for attempt in range(1, PAGE_ATTEMPTS + 1):
            try:
                # LTA's examples use a literal "$skip"; keep it out of params so it is not encoded
                response = await client.get(f"{SPEED_BANDS_URL}?$skip={skip}", headers=headers)
                if response.status_code in (401, 403):
                    raise TrafficUnavailable("LTA DataMall rejected the AccountKey.")
                # a used-up quota comes back as a 500; retrying it only spends more of the quota
                if response.status_code >= 400 and b"QuotaViolation" in response.content:
                    raise TrafficUnavailable("LTA DataMall's call quota for this AccountKey is used up; road speeds return when it resets.")
                response.raise_for_status()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                transient = isinstance(exc, httpx.TransportError) or exc.response.status_code in (429, 500, 502, 503, 504)
                if not transient or attempt == PAGE_ATTEMPTS:
                    raise
                await asyncio.sleep(RETRY_SECONDS * 2 ** (attempt - 1))
                continue
            body = response.json()
            rows = body.get("value")
            if not isinstance(rows, list):
                raise TrafficUnavailable("LTA DataMall returned an unexpected response.")
            if skip == 0:
                measured_at = lta_time(body.get("lastUpdatedTime"))
            return rows
        raise AssertionError("unreachable: the last attempt returns or raises")

    rows: list[dict[str, Any]] = []
    for first in range(0, MAX_PAGES, PAGES_PER_BATCH):
        pages = await asyncio.gather(*(page((first + k) * PAGE_SIZE) for k in range(PAGES_PER_BATCH)))
        for rows_on_page in pages:
            rows.extend(rows_on_page)
        if any(len(rows_on_page) < PAGE_SIZE for rows_on_page in pages):
            return Reading(rows, measured_at)
    raise TrafficUnavailable("LTA DataMall kept returning full pages, so the fetch was stopped.")


async def read_live(account_key: str, *, client: Optional[httpx.AsyncClient] = None) -> Reading:
    """Every record LTA has now; a network or server failure becomes TrafficUnavailable."""
    owned = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=get_settings().request_timeout_seconds)
    try:
        return await fetch_speed_bands(account_key, client)
    except httpx.HTTPError as exc:
        raise TrafficUnavailable(f"LTA DataMall did not respond ({exc.__class__.__name__}).") from exc
    finally:
        if owned:
            await client.aclose()


async def read_live_grid(
    account_key: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    reading = await read_live(account_key, client=client)
    return grid_from_rows(reading.rows, now or datetime.now(timezone.utc), reading.measured_at)


def routing_stretches(rows: list[dict[str, Any]], baseline: Optional[dict[str, int]] = None) -> list[Stretch]:
    """The stretches whose bands track traffic, with their night band from `baseline` (the shipped one if None)."""
    night = load_baseline() if baseline is None else baseline
    return [replace(s, night_band=night.get(s.link_id)) for s in map(parse_stretch, rows) if s and s.for_routing]


def grid_from_rows(
    rows: list[dict[str, Any]],
    fetched_at: datetime,
    measured_at: Optional[datetime] = None,
    baseline: Optional[dict[str, int]] = None,
) -> dict[str, Any]:
    """The grid for one reading, against `baseline` (LinkID to night band; the shipped one if None)."""
    stretches = routing_stretches(rows, baseline)
    if not stretches:
        raise TrafficUnavailable("LTA DataMall returned no usable road speeds.")
    return build_grid(stretches, fetched_at, measured_at)


# ---- history ----------------------------------------------------------------------

# The scheduled refresh also keeps every reading, so typical traffic for any
# time of the week can be built from weeks of them. A reading is one band digit
# per stretch, in the order of an index that says which stretch, which cell and
# how long; the index only changes when LTA adds or drops stretches.
HISTORY_PREFIX = "traffic/history/"
# outside HISTORY_PREFIX, which expires: newer readings still point at an old index
HISTORY_INDEX_PREFIX = "traffic/history-index/"


def history_index(stretches: list[Stretch]) -> dict[str, Any]:
    """The stretches a reading's bands refer to, in LinkID order, with where each one is."""
    ordered = sorted(stretches, key=lambda s: s.link_id)
    return {
        "version": 1,
        "links": [s.link_id for s in ordered],
        "category": [s.category for s in ordered],
        "cell": [list(cell_of(*s.mid)) for s in ordered],
        "km": [round(max(s.km, 0.01), 3) for s in ordered],
    }


def history_index_key(index: dict[str, Any]) -> str:
    digest = hashlib.sha1("\n".join(index["links"]).encode("utf-8")).hexdigest()[:12]
    return f"{HISTORY_INDEX_PREFIX}{digest}.json"


def history_record(
    stretches: list[Stretch], index: dict[str, Any], index_key: str, fetched_at: datetime, measured_at: Optional[datetime]
) -> tuple[str, dict[str, Any]]:
    """Where a reading is kept, and the reading: its bands as digits, "0" for a stretch it lacks.

    Keyed by LTA's own time, so a reading the refresh sees twice is kept once.
    """
    at = (measured_at or fetched_at).astimezone(SGT)
    position = {link: n for n, link in enumerate(index["links"])}
    bands = bytearray(b"0" * len(position))
    for s in stretches:
        n = position.get(s.link_id)
        if n is not None:
            bands[n] = ord(str(s.band))
    record = {
        "version": 1,
        "measuredAt": measured_at.astimezone(SGT).isoformat(timespec="seconds") if measured_at else None,
        "fetchedAt": fetched_at.astimezone(SGT).isoformat(timespec="seconds"),
        "index": index_key,
        "bands": bands.decode("ascii"),
    }
    return f"{HISTORY_PREFIX}{at:%Y/%m/%d/%H%M}.json.gz", record


def keep_reading(s3: Any, bucket: str, reading: Reading, fetched_at: datetime) -> str:
    """Store one reading in the history (and its index if it is new); returns its key."""
    from botocore.exceptions import ClientError  # with boto3: in the Lambda runtime and requirements.txt

    stretches = routing_stretches(reading.rows, baseline={})
    index = history_index(stretches)
    index_key = history_index_key(index)
    try:
        # written once: If-None-Match makes S3 refuse to replace an index that exists
        s3.put_object(
            Bucket=bucket,
            Key=index_key,
            Body=json.dumps(index, separators=(",", ":")).encode("utf-8"),
            ContentType="application/json",
            IfNoneMatch="*",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in ("PreconditionFailed", "ConditionalRequestConflict"):
            raise
    key, record = history_record(stretches, index, index_key, fetched_at, reading.measured_at)
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=gzip.compress(json.dumps(record, separators=(",", ":")).encode("utf-8")),
        ContentType="application/gzip",
    )
    return key


def build_baseline(readings: list[list[dict[str, Any]]]) -> dict[str, int]:
    """Each routing stretch's lower-quartile band over night readings (NIGHT_QUANTILE)."""
    bands: dict[str, list[int]] = {}
    for rows in readings:
        for s in map(parse_stretch, rows):
            if s and s.for_routing and s.link_id:
                bands.setdefault(s.link_id, []).append(s.band)
    return {link: _quantile(seen, NIGHT_QUANTILE) for link, seen in sorted(bands.items())}


def _quantile(bands: list[int], q: float) -> int:
    """The band at quantile q, nearest rank: of five readings, the lower quartile is the second slowest."""
    ordered = sorted(bands)
    return ordered[round(q * (len(ordered) - 1))]


@functools.lru_cache(maxsize=1)
def load_baseline(path: Path = BASELINE_PATH) -> dict[str, int]:
    """The night baseline; empty without the file, so every stretch falls back to its category."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {str(link): int(band) for link, band in data["bands"].items() if int(band) in BAND_KMH}


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
    parser = argparse.ArgumentParser(description="Save the current LTA road-speed grid as JSON, or build the night baseline.")
    parser.add_argument("--out", required=True, help="where to write the grid (or the baseline)")
    parser.add_argument("--raw", help="also save the raw LTA records here")
    parser.add_argument(
        "--baseline",
        nargs="+",
        metavar="RAW",
        help="instead, build the night baseline from raw readings saved with --raw while the roads are empty (2 to 5 am)",
    )
    args = parser.parse_args()
    if args.baseline:
        readings = [json.loads(Path(p).read_text(encoding="utf-8")) for p in args.baseline]
        bands = build_baseline(readings)
        baseline = {"version": 1, "source": "LTA DataMall Traffic Speed Bands v4", "readings": len(readings), "bands": bands}
        Path(args.out).write_text(json.dumps(baseline, separators=(",", ":")), encoding="utf-8")
        print(f"{len(bands)} stretches from {len(readings)} readings")
        return
    settings = get_settings()

    async def fetch() -> Reading:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            return await fetch_speed_bands(settings.lta_account_key, client)

    reading = asyncio.run(fetch())
    if args.raw:
        with open(args.raw, "w", encoding="utf-8") as f:
            json.dump(reading.rows, f)
    grid = grid_from_rows(reading.rows, datetime.now(timezone.utc), reading.measured_at)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(grid, f, separators=(",", ":"))
    print(
        f"{len(reading.rows)} records, {grid['stretches']} on routing roads, {len(grid['cells'])} cells, "
        f"{grid['slowShare']:.1%} slow, measured {grid['measuredAt']}"
    )


if __name__ == "__main__":
    main()
