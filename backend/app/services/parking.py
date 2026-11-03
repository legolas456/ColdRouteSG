"""Free car lots in URA and mall carparks, from LTA DataMall Carpark Availability.

The console reads HDB carparks from data.gov.sg without a key, but most of the
city centre has none within a walk. LTA's feed adds URA street carparks and
malls (about 130 with car lots), with coordinates, but needs the AccountKey, so
the scheduled refresh reads it (traffic_refresh.py) and publishes it to S3, and
the API serves it. It reports free lots, not a carpark's size.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

import httpx

from app.services.traffic import SGT, TrafficUnavailable

CARPARKS_URL = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2"
PARKING_KEY = "parking/carparks.json"
PAGE_SIZE = 500
# 2,615 records on 29 Oct 2026: six pages; this only stops a runaway loop
MAX_PAGES = 40
# HDB carparks come from data.gov.sg with their size; vans use car lots
AGENCIES = ("URA", "LTA")


def parse_carpark(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """A URA or LTA carpark's car lots, or None for HDB, other lot types and bad rows."""
    if not isinstance(row, dict) or row.get("Agency") not in AGENCIES or row.get("LotType") != "C":
        return None
    try:
        lat, lng = (float(x) for x in str(row.get("Location") or "").split())
        free = max(0, int(row["AvailableLots"]))
    except (KeyError, TypeError, ValueError):
        return None
    if not (1.15 <= lat < 1.5 and 103.55 <= lng < 104.15):
        return None
    return {
        "id": f"{row['Agency']}-{row.get('CarParkID', '')}",
        "agency": row["Agency"],
        "name": str(row.get("Development") or "").strip() or str(row.get("CarParkID", "")),
        "lat": lat,
        "lng": lng,
        "free": free,
    }


async def fetch_carparks(account_key: str, client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Every record, a page at a time (six of them), stopping at the first short page."""
    if not account_key:
        raise TrafficUnavailable("No LTA DataMall AccountKey is configured (set LTA_ACCOUNT_KEY).")
    headers = {"AccountKey": account_key, "accept": "application/json"}
    rows: list[dict[str, Any]] = []
    for page in range(MAX_PAGES):
        response = await client.get(f"{CARPARKS_URL}?$skip={page * PAGE_SIZE}", headers=headers)
        if response.status_code >= 400 and b"QuotaViolation" in response.content:
            raise TrafficUnavailable("LTA DataMall's call quota for this AccountKey is used up; carparks return when it resets.")
        response.raise_for_status()
        try:
            body = response.json()
        except ValueError as exc:
            raise TrafficUnavailable("LTA DataMall returned a carpark page that is not JSON.") from exc
        value = body.get("value") if isinstance(body, dict) else None
        if not isinstance(value, list):
            raise TrafficUnavailable("LTA DataMall returned an unexpected carpark response.")
        rows.extend(value)
        if len(value) < PAGE_SIZE:
            return rows
    raise TrafficUnavailable("LTA DataMall kept returning full carpark pages, so the fetch was stopped.")


def carpark_feed(rows: list[dict[str, Any]], fetched_at: datetime) -> dict[str, Any]:
    carparks = [c for c in map(parse_carpark, rows) if c]
    return {
        "version": 1,
        "source": "LTA DataMall Carpark Availability",
        "fetchedAt": fetched_at.astimezone(SGT).isoformat(timespec="seconds"),
        "carparks": sorted(carparks, key=lambda c: c["id"]),
    }


def publish_carparks(s3: Any, bucket: str, feed: dict[str, Any]) -> None:
    try:
        s3.put_object(
            Bucket=bucket,
            Key=PARKING_KEY,
            Body=json.dumps(feed, separators=(",", ":")).encode("utf-8"),
            ContentType="application/json",
            CacheControl="public, max-age=60",
        )
    except Exception as exc:  # noqa: BLE001 - S3 refused it; the previous feed stays
        raise TrafficUnavailable(f"The carparks could not be published ({exc.__class__.__name__}).") from exc


def read_published_carparks(s3: Any, bucket: str) -> dict[str, Any]:
    try:
        return json.loads(s3.get_object(Bucket=bucket, Key=PARKING_KEY)["Body"].read())
    except Exception as exc:  # noqa: BLE001 - any S3 or parse failure means no carparks
        raise TrafficUnavailable(f"The published carparks could not be read ({exc.__class__.__name__}).") from exc
