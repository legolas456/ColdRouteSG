import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

import traffic_profile
from app.config import Settings
from app.main import app
from app.routers import traffic as traffic_router
from app.services import typical
from app.services.traffic import SGT
from app.services.typical import build_profile, build_slot, day_type, profile_key, reading_time, slot_of

# Thursday 29 Oct 2026, 23:00 in Singapore
NOW = datetime(2026, 10, 29, 23, 0, tzinfo=SGT)


class FakeS3:
    """A bucket in memory: list (in pages), get and put."""

    def __init__(self, page_size: int = 1000):
        self.objects: dict[str, bytes] = {}
        self.page_size = page_size
        self.gets = 0

    def put_object(self, Bucket, Key, Body, **_):
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        self.gets += 1
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        body = self.objects[Key]

        class Body:
            def read(inner):
                return body

        return {"Body": Body()}

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start : start + self.page_size]
        more = start + self.page_size < len(keys)
        return {"Contents": [{"Key": k} for k in page], "IsTruncated": more, **({"NextContinuationToken": str(start + self.page_size)} if more else {})}


def keep(s3: FakeS3, at: datetime, cells) -> None:
    """A kept reading, as traffic_refresh files it."""
    record = {"version": 1, "measuredAt": at.isoformat(), "index": "i", "bands": "", "cells": cells}
    s3.objects[f"traffic/history/{at:%Y/%m/%d/%H%M}.json.gz"] = gzip.compress(json.dumps(record).encode())


# ---- slots ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "at,day,slot",
    [
        (datetime(2026, 10, 29, 8, 52, tzinfo=SGT), "weekday", "0845"),
        (datetime(2026, 10, 29, 8, 45, tzinfo=SGT), "weekday", "0845"),
        (datetime(2026, 10, 31, 23, 59, tzinfo=SGT), "weekend", "2345"),
        (datetime(2026, 11, 1, 0, 14, tzinfo=SGT), "weekend", "0000"),
        # 00:52 UTC on Friday is 08:52 in Singapore
        (datetime(2026, 10, 30, 0, 52, tzinfo=timezone.utc), "weekday", "0845"),
        # 17:00 UTC on Friday is already Saturday in Singapore
        (datetime(2026, 10, 30, 17, 0, tzinfo=timezone.utc), "weekend", "0100"),
    ],
)
def test_day_type_and_slot_are_singapore_time(at, day, slot):
    assert day_type(at) == day and slot_of(at) == slot


def test_reading_time_comes_from_the_key():
    assert reading_time("traffic/history/2026/10/29/0845.json.gz") == datetime(2026, 10, 29, 8, 45, tzinfo=SGT)
    assert reading_time("traffic/history/2026/10/29/notatime.json.gz") is None


def test_a_slot_takes_each_cells_median():
    readings = [
        [[30, 18, 1.0, 0.4], [31, 17, 3.0, 0.3]],
        # one jammed morning does not make the slot jammed: the median, not the mean (1.7)
        [[30, 18, 3.0, 0.4], [31, 17, 2.5, 0.3]],
        [[30, 18, 1.1, 0.4], [31, 17, 2.0, 0.3]],
    ]
    grid = build_slot(readings, "weekday", "0845", days=3, built_at=NOW)
    assert grid["cells"] == [[30, 18, 1.1, 0.4], [31, 17, 2.5, 0.3]]
    assert grid["readings"] == 3 and grid["days"] == 3
    assert grid["dayType"] == "weekday" and grid["slot"] == "0845" and grid["slotMinutes"] == 15
    # only the second cell is slow (SLOW_FACTOR, 1.2, or worse)
    assert grid["slowShare"] == pytest.approx(0.3 / 0.7, abs=0.001)


def test_a_cell_needs_three_readings_of_its_own():
    readings = [
        [[30, 18, 1.0, 0.4], [31, 17, 3.0, 0.3]],
        [[30, 18, 1.2, 0.4], [31, 17, 3.0, 0.3]],
        [[30, 18, 1.1, 0.4]],  # the jammed cell is in only two readings
    ]
    grid = build_slot(readings, "weekday", "0845", days=3, built_at=NOW)
    assert grid["cells"] == [[30, 18, 1.1, 0.4]]
    assert grid["roadKm"] == 0.4 and grid["slowShare"] == 0.0
    # the console's grid parser needs a time and a grid origin
    assert grid["fetchedAt"] == "2026-10-29T23:00:00+08:00" and grid["origin"] == [103.55, 1.15]


# ---- the nightly build ----------------------------------------------------------------


def test_the_profile_is_built_per_day_type_and_slot():
    s3 = FakeS3()
    # Monday to Thursday rush hour: three readings a day in the 08:45 slot
    rush = {26: 1.4, 27: 2.0, 28: 1.8, 29: 1.6}
    for day, factor in rush.items():
        for minute in (45, 50, 55):
            keep(s3, datetime(2026, 10, day, 8, minute, tzinfo=SGT), [[30, 18, factor, 0.4]])
    # Saturday: only two readings in that slot, too few
    for minute in (45, 50):
        keep(s3, datetime(2026, 10, 24, 8, minute, tzinfo=SGT), [[30, 18, 1.1, 0.4]])
    # an old-format reading without cells is ignored
    s3.objects["traffic/history/2026/10/29/0900.json.gz"] = gzip.compress(json.dumps({"version": 1}).encode())

    index = build_profile(s3, "bucket", NOW)
    grid = json.loads(s3.objects[profile_key("weekday", "0845")])
    assert grid["readings"] == 12 and grid["days"] == 4
    assert grid["cells"] == [[30, 18, 1.7, 0.4]]  # median of 1.4 x3, 1.6 x3, 1.8 x3, 2.0 x3
    assert profile_key("weekend", "0845") not in s3.objects
    assert index["slots"] == {"weekday": {"0845": {"readings": 12, "days": 4, "slowShare": 1.0}}, "weekend": {}}
    assert json.loads(s3.objects[typical.INDEX_KEY]) == index


def test_only_the_last_four_weeks_count():
    s3 = FakeS3()
    for back in (1, 2, 3):
        keep(s3, NOW - timedelta(days=7 * back), [[30, 18, 1.2, 0.4]])
    # five weeks back: outside the window
    for minute in range(3):
        keep(s3, NOW - timedelta(days=35, minutes=minute), [[30, 18, 3.0, 0.4]])
    build_profile(s3, "bucket", NOW)
    grid = json.loads(s3.objects[profile_key("weekday", slot_of(NOW))])
    assert grid["readings"] == 3 and grid["cells"] == [[30, 18, 1.2, 0.4]]


def test_listing_follows_every_page():
    s3 = FakeS3(page_size=2)
    for minute in (45, 50, 55, 59):
        keep(s3, datetime(2026, 10, 29, 8, minute, tzinfo=SGT), [[30, 18, 1.5, 0.4]])
    build_profile(s3, "bucket", NOW)
    assert json.loads(s3.objects[profile_key("weekday", "0845")])["readings"] == 4


def test_the_nightly_handler(monkeypatch):
    s3 = FakeS3()
    for minute in (0, 5, 10):
        keep(s3, datetime(2026, 10, 29, 17, minute, tzinfo=SGT), [[30, 18, 2.0, 0.4]])
    monkeypatch.setattr(traffic_profile, "get_settings", lambda: Settings(traffic_bucket="bucket"))
    monkeypatch.setattr(typical, "PROFILE_DAYS", 400)  # the readings are from a fixed date
    summary = traffic_profile.handler({}, None, s3=s3)
    assert summary["slots"] == {"weekday": 1, "weekend": 0}
    with pytest.raises(RuntimeError, match="TRAFFIC_BUCKET"):
        monkeypatch.setattr(traffic_profile, "get_settings", lambda: Settings(traffic_bucket=""))
        traffic_profile.handler({}, None, s3=s3)


# ---- serving it -------------------------------------------------------------------------


def _index(**slots):
    """The index a nightly build writes, listing these slots per day type."""
    return json.dumps({"slots": {"weekday": {}, "weekend": {}} | {day: {s: {} for s in names} for day, names in slots.items()}}).encode()


def test_a_slot_is_read_once_an_hour(monkeypatch):
    s3 = FakeS3()
    s3.objects[profile_key("weekday", "0845")] = json.dumps({"slot": "0845"}).encode()
    s3.objects[typical.INDEX_KEY] = _index(weekday=["0845"])
    monkeypatch.setattr(typical, "_cached", {})
    monkeypatch.setattr(typical, "get_settings", lambda: Settings(traffic_bucket="bucket"), raising=False)
    import app.config

    monkeypatch.setattr(app.config, "get_settings", lambda: Settings(traffic_bucket="bucket"))
    at = datetime(2026, 10, 30, 8, 47, tzinfo=SGT)
    assert typical.typical_grid(at, s3=s3) == {"slot": "0845"}
    assert typical.typical_grid(at + timedelta(minutes=5), s3=s3) == {"slot": "0845"}
    # the index and the slot, once
    assert s3.gets == 2
    # a slot with none yet is remembered too
    assert typical.typical_grid(datetime(2026, 10, 31, 3, 0, tzinfo=SGT), s3=s3) is None


def test_only_the_slots_the_last_build_published_are_served():
    # an older build published 08:45; the last one had too few recent readings for it
    s3 = FakeS3()
    s3.objects[profile_key("weekday", "0845")] = json.dumps({"slot": "0845"}).encode()
    s3.objects[profile_key("weekday", "0900")] = json.dumps({"slot": "0900"}).encode()
    s3.objects[typical.INDEX_KEY] = _index(weekday=["0900"])
    assert typical.read_typical_grid(s3, "bucket", datetime(2026, 10, 30, 8, 47, tzinfo=SGT)) is None
    assert typical.read_typical_grid(s3, "bucket", datetime(2026, 10, 30, 9, 5, tzinfo=SGT)) == {"slot": "0900"}
    # a weekend departure in the same slot has none
    assert typical.read_typical_grid(s3, "bucket", datetime(2026, 10, 31, 9, 5, tzinfo=SGT)) is None
    # before the first build there is no index, so nothing is served
    del s3.objects[typical.INDEX_KEY]
    assert typical.read_typical_grid(s3, "bucket", datetime(2026, 10, 30, 9, 5, tzinfo=SGT)) is None


def test_a_built_profile_is_served():
    s3 = FakeS3()
    for day in (27, 28, 29):
        for minute in (45, 50):
            keep(s3, datetime(2026, 10, day, 8, minute, tzinfo=SGT), [[30, 18, 1.5, 0.4]])
    build_profile(s3, "bucket", NOW)
    assert typical.read_typical_grid(s3, "bucket", datetime(2026, 10, 30, 8, 47, tzinfo=SGT))["slot"] == "0845"


def test_the_api_serves_the_departures_slot(monkeypatch):
    seen = []

    def fake(at):
        seen.append(at)
        return {"slot": slot_of(at), "cells": []} if slot_of(at) == "0845" else None

    monkeypatch.setattr(traffic_router, "typical_grid", fake)
    client = TestClient(app)
    response = client.get("/api/traffic/typical", params={"at": "2026-10-30T08:47:00+08:00"})
    assert response.status_code == 200 and response.json()["slot"] == "0845"
    # without an offset the time is Singapore's
    assert client.get("/api/traffic/typical", params={"at": "2026-10-30T08:47:00"}).json()["slot"] == "0845"
    assert seen[-1].utcoffset() == timedelta(hours=8)
    missing = client.get("/api/traffic/typical", params={"at": "2026-10-31T03:05:00+08:00"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "No typical traffic for a weekend at 03:00 yet: it needs at least 3 kept readings in that slot."
    assert client.get("/api/traffic/typical", params={"at": "soon"}).status_code == 422


def test_the_api_says_when_there_is_no_traffic_service(monkeypatch):
    def fake(at):
        raise LookupError("Typical traffic needs the scheduled traffic service (TRAFFIC_BUCKET is not set).")

    monkeypatch.setattr(traffic_router, "typical_grid", fake)
    response = TestClient(app).get("/api/traffic/typical", params={"at": "2026-10-30T08:47:00+08:00"})
    assert response.status_code == 503 and "TRAFFIC_BUCKET" in response.json()["detail"]


TYPICAL_READINGS = [
    [[30, 15, 1.0, 1.0], [31, 17, 2.4, 0.3]],
    [[30, 15, 2.2, 1.0], [31, 17, 2.6, 0.3]],
    [[30, 15, 1.8, 1.0], [31, 17, 2.5, 0.3]],
]


def test_typical_grid_matches_the_reviewed_snapshot():
    # frontend/src/lib/__tests__/traffic.test.ts and conditions.test.ts read the same file,
    # so the Python builder and the browser parser cannot drift apart
    expected = json.loads((Path(__file__).parent / "fixtures" / "typical_grid_expected.json").read_text())
    built = build_slot(TYPICAL_READINGS, "weekday", "0845", days=3, built_at=datetime(2026, 10, 29, 2, 30, tzinfo=SGT))
    assert built == expected
