import asyncio
import json
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import traffic_refresh
from app.config import Settings
from app.main import app
from app.routers import traffic as traffic_router
from app.services import traffic
from app.services.geo import haversine_km
from app.services.traffic import (
    PAGE_SIZE,
    SGT,
    Stretch,
    TrafficUnavailable,
    build_grid,
    cell_of,
    fetch_speed_bands,
    grid_from_rows,
    parse_stretch,
    read_live_grid,
    read_published_grid,
)

FIXTURES = Path(__file__).parent / "fixtures"
ROWS = json.loads((FIXTURES / "lta_speed_bands_sample.json").read_text())
FETCHED_AT = datetime(2026, 10, 27, 8, 30, tzinfo=SGT)


# ---- parsing and delay factors ----------------------------------------------

# (row index in the fixture, expected factor; None when the row is rejected)
# factor = free-flow km/h for the road category / middle of the band's range, capped at 3
EXPECTED = [
    (0, 1.0),  # expressway at 70+ km/h: free flow
    (1, 3.0),  # expressway at 20-29 km/h: 75 / 25
    (2, 75 / 45),  # expressway at 40-49 km/h
    (3, 3.0),  # major arterial at 10-19 km/h: 55 / 15 = 3.67, capped
    (4, 1.0),  # major arterial at 50-59 km/h
    (5, 3.0),  # the sample record in LTA's guide: arterial at 10-19 km/h
    (6, 45 / 35),  # minor arterial at 30-39 km/h
    (7, 1.0),  # small road at 30-39 km/h is its normal speed
    (8, 1.0),  # slip road at 40-49 km/h
    (9, 1.0),  # short tunnel at 60-69 km/h
    (10, 75 / 35),  # numbers sent as strings
    (11, 75 / 35),  # older letter category "A" is an expressway
    (12, 45 / 25),  # unknown category "G" uses the default free-flow speed
    (13, None),  # missing EndLat
    (14, None),  # band 0 is not a band
    (15, None),  # 0,0 coordinates
    (16, None),  # in Johor
]


@pytest.mark.parametrize("index,factor", EXPECTED)
def test_parse_stretch_and_factor(index, factor):
    stretch = parse_stretch(ROWS[index])
    if factor is None:
        assert stretch is None
    else:
        assert stretch is not None
        assert stretch.factor == pytest.approx(factor)


def test_every_fixture_row_is_covered():
    assert len(EXPECTED) == len(ROWS)


def test_parse_keeps_identity_and_coordinates():
    stretch = parse_stretch(ROWS[5])
    assert stretch.link_id == "1"
    assert stretch.road == "SERANGOON ROAD"
    assert stretch.category == 3
    assert stretch.start == (103.86246461405193, 1.3220591510051254)
    assert stretch.km == pytest.approx(haversine_km(1.3220591510051254, 103.86246461405193, 1.3215993547809128, 103.86315591911669))


@pytest.mark.parametrize("bad", [{}, {"SpeedBand": None}, {"SpeedBand": "fast", "StartLon": 1}, {"SpeedBand": 9, "StartLon": 103.8, "StartLat": 1.3, "EndLon": 103.81, "EndLat": 1.31}])
def test_parse_rejects_malformed_rows(bad):
    assert parse_stretch(bad) is None


# ---- grid ---------------------------------------------------------------------


def _stretch(lng: float, lat: float, length_deg: float, category: int, band: int) -> Stretch:
    return Stretch("x", "TEST ROAD", category, band, (lng, lat), (lng + length_deg, lat))


def test_cell_factor_is_the_length_weighted_mean():
    # both midpoints fall in the same cell; the long jammed stretch weighs three times the short clear one
    jammed = _stretch(103.8510, 1.3010, 0.0027, 1, 3)  # factor 3
    clear = _stretch(103.8540, 1.3010, 0.0009, 1, 8)  # factor 1
    assert cell_of(*jammed.mid) == cell_of(*clear.mid)
    grid = build_grid([jammed, clear], FETCHED_AT)
    [[i, j, factor, km]] = grid["cells"]
    assert (i, j) == cell_of(*jammed.mid)
    expected = (3 * jammed.km + 1 * clear.km) / (jammed.km + clear.km)
    assert factor == pytest.approx(expected, abs=0.005)
    assert km == pytest.approx(jammed.km + clear.km, abs=0.005)


def test_grid_summary_counts_slow_road_km():
    jammed = _stretch(103.8510, 1.3010, 0.0027, 1, 3)
    clear = _stretch(103.9510, 1.3510, 0.0027, 1, 8)
    grid = build_grid([jammed, clear], FETCHED_AT)
    assert grid["stretches"] == 2
    assert grid["slowShare"] == pytest.approx(0.5, abs=0.001)
    assert len(grid["cells"]) == 2
    assert grid["fetchedAt"] == "2026-10-27T08:30:00+08:00"
    assert grid["origin"] == [103.55, 1.15] and grid["cellDeg"] == 0.01


def test_zero_length_stretch_still_counts():
    point = Stretch("x", "TEST", 1, 3, (103.85, 1.30), (103.85, 1.30))
    [[_, _, factor, km]] = build_grid([point], FETCHED_AT)["cells"]
    assert factor == 3.0 and km == 0.01


def test_fixture_grid_matches_the_reviewed_snapshot():
    # frontend/src/lib/__tests__/traffic.test.ts reads the same file, so this pins the
    # contract between the Python builder and the browser parser
    expected = json.loads((FIXTURES / "traffic_grid_expected.json").read_text())
    assert grid_from_rows(ROWS, FETCHED_AT) == expected


def test_no_usable_rows_is_unavailable():
    with pytest.raises(TrafficUnavailable, match="no usable"):
        grid_from_rows(ROWS[13:], FETCHED_AT)


# ---- fetching -----------------------------------------------------------------


def _lta(total: int, seen: list[httpx.Request] | None = None, status: int = 200, body=None):
    """A fake LTA that serves `total` records in pages of PAGE_SIZE."""

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status != 200:
            return httpx.Response(status, json={"fault": "test"})
        if body is not None:
            return httpx.Response(200, json=body)
        skip = int(request.url.params["$skip"])
        rows = [{"LinkID": str(n)} for n in range(skip, min(skip + PAGE_SIZE, total))]
        return httpx.Response(200, json={"odata.metadata": "test", "value": rows})

    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


@pytest.mark.parametrize("total", [0, 1, 499, 500, 1234, 4000, 4500, 9001])
def test_fetch_reads_every_record_exactly_once(total):
    rows = asyncio.run(fetch_speed_bands("key", _lta(total)))
    assert [r["LinkID"] for r in rows] == [str(n) for n in range(total)]


def test_fetch_sends_the_key_and_a_literal_skip():
    seen: list[httpx.Request] = []
    asyncio.run(fetch_speed_bands("secret-key", _lta(10, seen)))
    assert seen, "no request was made"
    for request in seen:
        assert request.headers["AccountKey"] == "secret-key"
        assert "$skip=" in str(request.url)
        assert request.url.path == "/ltaodataservice/v4/TrafficSpeedBands"


def test_fetch_without_a_key_makes_no_request():
    seen: list[httpx.Request] = []
    with pytest.raises(TrafficUnavailable, match="AccountKey"):
        asyncio.run(fetch_speed_bands("", _lta(10, seen)))
    assert seen == []


@pytest.mark.parametrize("status", [401, 403])
def test_rejected_key_is_reported(status):
    with pytest.raises(TrafficUnavailable, match="rejected"):
        asyncio.run(fetch_speed_bands("bad", _lta(10, status=status)))


def test_unexpected_body_is_reported():
    with pytest.raises(TrafficUnavailable, match="unexpected"):
        asyncio.run(fetch_speed_bands("key", _lta(10, body={"error": "nope"})))


def test_server_error_becomes_unavailable():
    with pytest.raises(TrafficUnavailable, match="did not respond"):
        asyncio.run(read_live_grid("key", client=_lta(10, status=500)))


def test_network_failure_becomes_unavailable():
    def fail(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(TrafficUnavailable, match="did not respond"):
        asyncio.run(read_live_grid("key", client=httpx.AsyncClient(transport=httpx.MockTransport(fail))))


def test_runaway_paging_stops(monkeypatch):
    monkeypatch.setattr(traffic, "MAX_PAGES", 16)
    with pytest.raises(TrafficUnavailable, match="full pages"):
        asyncio.run(fetch_speed_bands("key", _lta(10**9)))


def test_read_live_grid_end_to_end():
    def handle(request: httpx.Request) -> httpx.Response:
        skip = int(request.url.params["$skip"])
        return httpx.Response(200, json={"value": ROWS[skip : skip + PAGE_SIZE]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    grid = asyncio.run(read_live_grid("key", client=client, now=FETCHED_AT))
    assert grid == grid_from_rows(ROWS, FETCHED_AT)


# ---- cache, S3 and the API ------------------------------------------------------


class FakeS3:
    def __init__(self, body: bytes | None = None):
        self.body = body
        self.put: dict | None = None

    def get_object(self, Bucket, Key):
        if self.body is None:
            raise KeyError(Key)

        class Body:
            def read(inner):
                return self.body

        return {"Body": Body()}

    def put_object(self, **kwargs):
        self.put = kwargs


def test_read_published_grid():
    settings = Settings(traffic_bucket="b", traffic_key="k")
    assert read_published_grid(settings, FakeS3(b'{"cells": []}')) == {"cells": []}
    with pytest.raises(TrafficUnavailable, match="published"):
        read_published_grid(settings, FakeS3(None))


def test_grid_is_cached_between_requests(monkeypatch):
    calls = []

    async def fake_read(key, **_):
        calls.append(key)
        return {"n": len(calls)}

    monkeypatch.setattr(traffic, "_cached", None)
    monkeypatch.setattr(traffic, "get_settings", lambda: Settings(lta_account_key="k", traffic_bucket=""))
    monkeypatch.setattr(traffic, "read_live_grid", fake_read)
    assert asyncio.run(traffic.traffic_grid()) == {"n": 1}
    assert asyncio.run(traffic.traffic_grid()) == {"n": 1}
    monkeypatch.setattr(traffic, "CACHE_SECONDS", -1)
    assert asyncio.run(traffic.traffic_grid()) == {"n": 2}
    assert calls == ["k", "k"]


def test_grid_reads_s3_when_a_bucket_is_set(monkeypatch):
    monkeypatch.setattr(traffic, "_cached", None)
    monkeypatch.setattr(traffic, "get_settings", lambda: Settings(traffic_bucket="b"))
    monkeypatch.setattr(traffic, "read_published_grid", lambda settings: {"from": settings.traffic_bucket})
    assert asyncio.run(traffic.traffic_grid()) == {"from": "b"}


def test_api_returns_the_grid(monkeypatch):
    async def fake():
        return {"cells": [[1, 2, 1.5, 0.4]]}

    monkeypatch.setattr(traffic_router, "traffic_grid", fake)
    response = TestClient(app).get("/api/traffic/grid")
    assert response.status_code == 200
    assert response.json() == {"cells": [[1, 2, 1.5, 0.4]]}


def test_api_says_why_traffic_is_unavailable(monkeypatch):
    async def fake():
        raise TrafficUnavailable("No LTA DataMall AccountKey is configured (set LTA_ACCOUNT_KEY).")

    monkeypatch.setattr(traffic_router, "traffic_grid", fake)
    response = TestClient(app).get("/api/traffic/grid")
    assert response.status_code == 503
    assert "AccountKey" in response.json()["detail"]


# ---- scheduled refresh ------------------------------------------------------------


def test_refresh_publishes_the_grid_to_s3(monkeypatch):
    grid = grid_from_rows(ROWS, FETCHED_AT)

    async def fake_read(key):
        assert key == "lta-key"
        return grid

    monkeypatch.setattr(traffic_refresh, "get_settings", lambda: Settings(lta_account_key="lta-key", traffic_bucket="bucket", traffic_key="traffic/grid.json"))
    monkeypatch.setattr(traffic_refresh, "read_live_grid", fake_read)
    s3 = FakeS3()
    summary = traffic_refresh.handler({}, None, s3=s3)
    assert s3.put["Bucket"] == "bucket" and s3.put["Key"] == "traffic/grid.json"
    assert s3.put["ContentType"] == "application/json"
    assert "max-age=60" in s3.put["CacheControl"]
    assert json.loads(s3.put["Body"]) == grid
    assert summary == {"fetchedAt": grid["fetchedAt"], "stretches": grid["stretches"], "cells": len(grid["cells"])}


def test_refresh_needs_a_bucket(monkeypatch):
    monkeypatch.setattr(traffic_refresh, "get_settings", lambda: Settings(traffic_bucket=""))
    with pytest.raises(RuntimeError, match="TRAFFIC_BUCKET"):
        traffic_refresh.handler({}, None, s3=FakeS3())
