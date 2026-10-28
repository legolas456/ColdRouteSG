import asyncio
import gzip
import json
import sys
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

import traffic_refresh
from app.config import Settings
from app.main import app
from app.routers import traffic as traffic_router
from app.services import traffic
from app.services.geo import haversine_km
from app.services.traffic import (
    BAND_KMH,
    PAGE_SIZE,
    SGT,
    Stretch,
    TrafficUnavailable,
    build_baseline,
    build_grid,
    cell_of,
    fetch_speed_bands,
    grid_from_rows,
    load_baseline,
    Reading,
    parse_stretch,
    read_live_grid,
    read_published_grid,
)

FIXTURES = Path(__file__).parent / "fixtures"
ROWS = json.loads((FIXTURES / "lta_speed_bands_sample.json").read_text())
FETCHED_AT = datetime(2026, 10, 27, 8, 30, tzinfo=SGT)
# Night bands for the reviewed snapshot, away from the cells the frontend test checks:
# the PIE at 20-29 km/h now and at night, Fort Canning Tunnel at 70+ at night, and
# Jalan Besar, a minor arterial, which stays out of the grid whatever its night speed.
FIXTURE_BASELINE = {"103000001": 3, "103000060": 8, "103000030": 2}


@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch):
    monkeypatch.setattr(traffic, "RETRY_SECONDS", 0)


# ---- parsing and delay factors ----------------------------------------------

# (row index in the fixture, expected factor; None when the row is rejected,
# "skip" when it parses but is not a road whose band tracks traffic)
# factor = free-flow km/h for the road category / middle of the band's range, capped at 3
EXPECTED = [
    (0, 1.0),  # expressway at 70+ km/h: free flow
    (1, 3.0),  # expressway at 20-29 km/h: 75 / 25
    (2, 75 / 45),  # expressway at 40-49 km/h
    (3, 3.0),  # major arterial at 10-19 km/h: 55 / 15 = 3.67, capped
    (4, 1.0),  # major arterial at 50-59 km/h
    (5, 3.0),  # the sample record in LTA's guide: arterial at 10-19 km/h
    (6, "skip"),  # minor arterial: stop-start between junctions, not traffic
    (7, "skip"),  # small road: likewise
    (8, 55 / 45),  # slip road at 40-49 km/h
    (9, 1.0),  # short tunnel at 60-69 km/h, above its 45 km/h free flow
    (10, 75 / 35),  # numbers sent as strings
    (11, 75 / 35),  # older letter category "A" is an expressway
    (12, "skip"),  # unknown category "G"
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
    elif factor == "skip":
        assert stretch is not None and not stretch.for_routing
    else:
        assert stretch is not None and stretch.for_routing
        assert stretch.factor == pytest.approx(factor)


def test_only_roads_whose_bands_track_traffic_feed_the_grid():
    grid = grid_from_rows(ROWS, FETCHED_AT)
    assert grid["stretches"] == sum(1 for _, f in EXPECTED if f not in (None, "skip"))
    cells = {(i, j): factor for i, j, factor, _ in grid["cells"]}
    # the minor arterial and the unknown road had cells of their own; now they have none
    assert cell_of(*parse_stretch(ROWS[6]).mid) not in cells
    assert cell_of(*parse_stretch(ROWS[12]).mid) not in cells
    # the small road shares its cell with the PIE and its slip road, which still count
    small_road_cell = cell_of(*parse_stretch(ROWS[7]).mid)
    assert small_road_cell == cell_of(*parse_stretch(ROWS[0]).mid)
    assert small_road_cell in cells
    with pytest.raises(TrafficUnavailable, match="no usable"):
        grid_from_rows([ROWS[6], ROWS[7], ROWS[12]], FETCHED_AT)


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


def test_cell_factor_compares_length_weighted_speeds():
    # both midpoints fall in the same cell: a long expressway stretch at 20-29 km/h and a short
    # one at 70+, both 75 km/h in free flow; the long one weighs three times the short one
    jammed = _stretch(103.8510, 1.3010, 0.0027, 1, 3)
    clear = _stretch(103.8540, 1.3010, 0.0009, 1, 8)
    assert cell_of(*jammed.mid) == cell_of(*clear.mid)
    grid = build_grid([jammed, clear], FETCHED_AT)
    [[i, j, factor, km]] = grid["cells"]
    assert (i, j) == cell_of(*jammed.mid)
    expected = (75 * jammed.km + 75 * clear.km) / (25 * jammed.km + 75 * clear.km)
    assert factor == pytest.approx(expected, abs=0.005)
    assert km == pytest.approx(jammed.km + clear.km, abs=0.005)


def test_night_flicker_cancels_within_a_cell():
    # two stretches that ran at 50-59 km/h at night, one reading a band slower now and one a band
    # faster: their own factors would call the cell 11% slow; their speeds average out
    slower = replace(_stretch(103.8510, 1.3010, 0.0020, 2, 5), night_band=6)
    faster = replace(_stretch(103.8540, 1.3010, 0.0020, 2, 7), night_band=6)
    assert (slower.factor + faster.factor) / 2 == pytest.approx((55 / 45 + 1) / 2)
    grid = build_grid([slower, faster], FETCHED_AT)
    [[_, _, factor, _]] = grid["cells"]
    assert factor == 1.0
    assert grid["slowShare"] == 0.0


def test_a_jam_still_shows_capped_at_three_times_free_flow():
    # three stretches in one cell, 70+ km/h at night and under 10 km/h now: 75 / 5 = 15
    jam = [replace(_stretch(103.8510 + 0.001 * n, 1.3010, 0.0005, 2, 1), night_band=8) for n in range(3)]
    grid = build_grid(jam, FETCHED_AT)
    [[_, _, factor, _]] = grid["cells"]
    assert factor == 3.0
    assert grid["slowShare"] == 1.0


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
    assert grid_from_rows(ROWS, FETCHED_AT, baseline=FIXTURE_BASELINE) == expected


def test_no_usable_rows_is_unavailable():
    with pytest.raises(TrafficUnavailable, match="no usable"):
        grid_from_rows(ROWS[13:], FETCHED_AT)


# ---- night baseline -------------------------------------------------------------

# (row index in the fixture, its band at night, expected factor)
# factor = middle of the night band's range / middle of the current band's, capped at 3
NIGHT = [
    (1, 3, 1.0),  # expressway at 20-29 km/h, as at night: a bend or a junction, not traffic
    (1, 5, 45 / 25),  # the same stretch, at 40-49 km/h at night
    (5, 3, 25 / 15),  # arterial at 10-19 km/h, 20-29 at night
    (3, 8, 3.0),  # major arterial at 10-19 km/h, 70+ at night: 75 / 15 = 5, capped
    (4, 3, 1.0),  # faster now than at night is still free flow
    (9, 8, 75 / 65),  # short tunnel at 60-69 km/h, faster at night than its category's 45
]


@pytest.mark.parametrize("index,night_band,factor", NIGHT)
def test_free_flow_is_the_stretchs_own_night_speed(index, night_band, factor):
    stretch = replace(parse_stretch(ROWS[index]), night_band=night_band)
    assert stretch.factor == pytest.approx(factor)


def test_a_stretch_the_baseline_does_not_know_uses_its_category():
    grid = grid_from_rows(ROWS, FETCHED_AT, baseline={})
    assert grid["nightShare"] == 0.0
    assert grid["slowShare"] > grid_from_rows(ROWS, FETCHED_AT, baseline=FIXTURE_BASELINE)["slowShare"]


def test_a_night_reading_against_its_own_baseline_is_free_flow():
    grid = grid_from_rows(ROWS, FETCHED_AT, baseline=build_baseline([ROWS]))
    assert grid["nightShare"] == 1.0
    assert grid["slowShare"] == 0.0
    assert {factor for _, _, factor, _ in grid["cells"]} == {1.0}


def test_baseline_takes_each_stretchs_lower_quartile_night_band():
    pie, serangoon, minor = ROWS[0], ROWS[5], ROWS[6]
    readings = [
        [{**pie, "SpeedBand": 8}, serangoon, minor],
        [{**pie, "SpeedBand": 3}, minor],  # one slow moment does not set the baseline
        [{**pie, "SpeedBand": 7}, {**serangoon, "SpeedBand": 4}],
        [{**pie, "SpeedBand": 8}],
        [{**pie, "SpeedBand": 8}, ROWS[13], ROWS[14]],  # rejected rows add nothing
    ]
    # PIE: 3, 7, 8, 8, 8 -> the second slowest, 7. Serangoon Road: 2 and 4 -> 2. Minor roads stay out.
    assert build_baseline(readings) == {"103000000": 7, "1": 2}


@pytest.mark.parametrize(
    "bands,expected",
    [([5], 5), ([6, 4], 4), ([8, 3, 7], 3), ([8, 3, 7, 8], 7), ([8, 3, 7, 8, 8], 7), ([1, 2, 3, 4, 5, 6, 7, 8, 8], 3)],
)
def test_lower_quartile_by_nearest_rank(bands, expected):
    assert traffic._quantile(bands, traffic.NIGHT_QUANTILE) == expected


def test_baseline_command_writes_what_the_grid_reads(tmp_path, monkeypatch):
    raw = []
    for n, band in enumerate((8, 3, 7, 8, 8)):
        raw.append(tmp_path / f"night{n}.json")
        raw[-1].write_text(json.dumps([{**ROWS[0], "SpeedBand": band}, ROWS[5]]))
    out = tmp_path / "speed_baseline.json"
    monkeypatch.setattr(sys, "argv", ["traffic", "--baseline", *map(str, raw), "--out", str(out)])
    traffic.main()
    assert json.loads(out.read_text())["readings"] == 5
    assert load_baseline(out) == {"103000000": 7, "1": 2}


def test_baseline_file_is_optional_and_checked(tmp_path):
    assert load_baseline(tmp_path / "missing.json") == {}
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"bands": {"1": 3, "2": 0, "3": 9, "4": "8"}}))
    assert load_baseline(path) == {"1": 3, "4": 8}


def test_shipped_baseline_covers_the_routing_roads():
    shipped = load_baseline()
    # 42,904 routing stretches on 29 Oct 2026
    assert len(shipped) > 40_000
    assert set(shipped.values()) <= set(BAND_KMH)


# ---- fetching -----------------------------------------------------------------


def _lta(total: int, seen: list[httpx.Request] | None = None, status: int = 200, body=None, updated=None, failures=None):
    """A fake LTA that serves `total` records in pages of PAGE_SIZE.

    `failures` maps a $skip to the statuses (or exceptions) its first attempts get.
    """
    failures = {skip: list(answers) for skip, answers in (failures or {}).items()}

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status != 200:
            return httpx.Response(status, json={"fault": "test"})
        if body is not None:
            return httpx.Response(200, json=body)
        skip = int(request.url.params["$skip"])
        if failures.get(skip):
            answer = failures[skip].pop(0)
            if isinstance(answer, Exception):
                raise answer
            return httpx.Response(answer, json={"fault": "test"})
        rows = [{"LinkID": str(n)} for n in range(skip, min(skip + PAGE_SIZE, total))]
        payload = {"odata.metadata": "test", "value": rows}
        if updated is not None:
            payload["lastUpdatedTime"] = updated
        return httpx.Response(200, json=payload)

    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


@pytest.mark.parametrize("total", [0, 1, 499, 500, 1234, 4000, 4500, 9001, 16 * PAGE_SIZE + 1])
def test_fetch_reads_every_record_exactly_once(total):
    reading = asyncio.run(fetch_speed_bands("key", _lta(total)))
    assert [r["LinkID"] for r in reading.rows] == [str(n) for n in range(total)]


def test_measured_time_comes_from_lta():
    reading = asyncio.run(fetch_speed_bands("key", _lta(1234, updated="2026-10-27 10:25:00")))
    assert reading.measured_at == datetime(2026, 10, 27, 10, 25, tzinfo=SGT)
    grid = build_grid([parse_stretch(ROWS[0])], FETCHED_AT, reading.measured_at)
    assert grid["measuredAt"] == "2026-10-27T10:25:00+08:00"
    assert grid["fetchedAt"] == "2026-10-27T08:30:00+08:00"


@pytest.mark.parametrize("updated", [None, "", "yesterday", "2026-10-27T10:25:00Z"])
def test_missing_or_unexpected_lta_time_is_left_out(updated):
    assert asyncio.run(fetch_speed_bands("key", _lta(10, updated=updated))).measured_at is None
    assert build_grid([parse_stretch(ROWS[0])], FETCHED_AT)["measuredAt"] is None


@pytest.mark.parametrize(
    "answers",
    [[500], [500, 500], [502, 503, 504], [429], [httpx.ConnectError("dropped")], [httpx.ReadTimeout("slow")]],
)
def test_a_page_that_fails_for_a_moment_is_retried(answers):
    seen: list[httpx.Request] = []
    reading = asyncio.run(fetch_speed_bands("key", _lta(1234, seen, failures={500: answers})))
    assert [r["LinkID"] for r in reading.rows] == [str(n) for n in range(1234)]
    assert sum(1 for r in seen if r.url.params["$skip"] == "500") == len(answers) + 1


def test_a_page_that_keeps_failing_gives_up_after_every_attempt():
    seen: list[httpx.Request] = []
    failing = {500: [500] * traffic.PAGE_ATTEMPTS}
    with pytest.raises(TrafficUnavailable, match="did not respond"):
        asyncio.run(read_live_grid("key", client=_lta(1234, seen, failures=failing)))
    assert sum(1 for r in seen if r.url.params["$skip"] == "500") == traffic.PAGE_ATTEMPTS


@pytest.mark.parametrize("status", [400, 404])
def test_a_client_error_is_not_retried(status):
    seen: list[httpx.Request] = []
    with pytest.raises(TrafficUnavailable, match="did not respond"):
        asyncio.run(read_live_grid("key", client=_lta(1234, seen, failures={500: [status]})))
    assert sum(1 for r in seen if r.url.params["$skip"] == "500") == 1


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
    """Keeps every object put, and refuses to replace one when asked If-None-Match, as S3 does."""

    def __init__(self, body: bytes | None = None):
        self.body = body
        self.objects: dict[str, dict] = {}
        self.puts = 0

    def get_object(self, Bucket, Key):
        if self.body is None:
            raise KeyError(Key)

        class Body:
            def read(inner):
                return self.body

        return {"Body": Body()}

    def put_object(self, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and kwargs["Key"] in self.objects:
            raise ClientError({"Error": {"Code": "PreconditionFailed", "Message": "exists"}}, "PutObject")
        self.puts += 1
        self.objects[kwargs["Key"]] = kwargs


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


MEASURED_AT = datetime(2026, 10, 27, 8, 25, tzinfo=SGT)


def _refresh(monkeypatch, s3: FakeS3, rows=ROWS, measured_at=MEASURED_AT) -> dict:
    async def fake_read(key):
        assert key == "lta-key"
        return Reading(rows, measured_at)

    monkeypatch.setattr(traffic_refresh, "get_settings", lambda: Settings(lta_account_key="lta-key", traffic_bucket="bucket", traffic_key="traffic/grid.json"))
    monkeypatch.setattr(traffic_refresh, "read_live", fake_read)
    return traffic_refresh.handler({}, None, s3=s3)


def test_refresh_publishes_the_grid_to_s3(monkeypatch):
    s3 = FakeS3()
    summary = _refresh(monkeypatch, s3)
    put = s3.objects["traffic/grid.json"]
    assert put["Bucket"] == "bucket"
    assert put["ContentType"] == "application/json"
    assert "max-age=60" in put["CacheControl"]
    grid = json.loads(put["Body"])
    assert grid["measuredAt"] == "2026-10-27T08:25:00+08:00"
    assert grid["cells"] == grid_from_rows(ROWS, FETCHED_AT)["cells"]
    assert summary["stretches"] == grid["stretches"] and summary["cells"] == len(grid["cells"])


def test_refresh_keeps_the_reading(monkeypatch):
    s3 = FakeS3()
    summary = _refresh(monkeypatch, s3)
    # filed under LTA's own time, in Singapore time
    assert summary["kept"] == "traffic/history/2026/10/27/0825.json.gz"
    record = json.loads(gzip.decompress(s3.objects[summary["kept"]]["Body"]))
    index = json.loads(s3.objects[record["index"]]["Body"])
    assert record["index"].startswith(traffic.HISTORY_INDEX_PREFIX)
    assert record["measuredAt"] == "2026-10-27T08:25:00+08:00"
    # one band digit per routing stretch, in the index's LinkID order, with where each one is
    routing = [s for s in map(parse_stretch, ROWS) if s and s.for_routing]
    assert index["links"] == sorted(s.link_id for s in routing)
    assert len(record["bands"]) == len(index["links"])
    for s in routing:
        n = index["links"].index(s.link_id)
        assert record["bands"][n] == str(s.band)
        assert index["cell"][n] == list(cell_of(*s.mid))
        assert index["category"][n] == s.category
        assert index["km"][n] == pytest.approx(max(s.km, 0.01), abs=0.001)


def test_the_index_is_written_once_and_readings_by_time(monkeypatch):
    s3 = FakeS3()
    first = _refresh(monkeypatch, s3)
    # the next run sees the same LTA reading again: the same key, and the index is not rewritten
    again = _refresh(monkeypatch, s3)
    assert again["kept"] == first["kept"]
    assert s3.puts == 3 + 2  # grid, index, reading; then grid and reading
    later = _refresh(monkeypatch, s3, measured_at=MEASURED_AT + timedelta(minutes=5))
    assert later["kept"] == "traffic/history/2026/10/27/0830.json.gz"
    assert sum(1 for key in s3.objects if key.startswith(traffic.HISTORY_INDEX_PREFIX)) == 1


def test_a_stretch_missing_from_a_reading_is_a_zero():
    routing = [s for s in map(parse_stretch, ROWS) if s and s.for_routing]
    index = traffic.history_index(routing)
    without_pie = [s for s in routing if s.link_id != ROWS[0]["LinkID"]]
    key, record = traffic.history_record(without_pie, index, "index-key", FETCHED_AT, None)
    n = index["links"].index(ROWS[0]["LinkID"])
    assert record["bands"][n] == "0" and record["bands"].count("0") == 1
    # without LTA's own time, the reading is filed under when it was fetched
    assert key == "traffic/history/2026/10/27/0830.json.gz" and record["measuredAt"] is None


def test_a_reading_with_other_stretches_gets_its_own_index(monkeypatch):
    s3 = FakeS3()
    first = _refresh(monkeypatch, s3)
    later = _refresh(monkeypatch, s3, rows=[r for r in ROWS if r is not ROWS[0]], measured_at=MEASURED_AT + timedelta(minutes=5))
    first_index = json.loads(gzip.decompress(s3.objects[first["kept"]]["Body"]))["index"]
    later_index = json.loads(gzip.decompress(s3.objects[later["kept"]]["Body"]))["index"]
    assert first_index != later_index
    assert ROWS[0]["LinkID"] not in json.loads(s3.objects[later_index]["Body"])["links"]


def test_an_index_that_cannot_be_written_is_an_error(monkeypatch):
    class Broken(FakeS3):
        def put_object(self, **kwargs):
            if kwargs.get("IfNoneMatch"):
                raise ClientError({"Error": {"Code": "AccessDenied", "Message": "no"}}, "PutObject")
            super().put_object(**kwargs)

    with pytest.raises(ClientError):
        _refresh(monkeypatch, Broken())


def test_refresh_needs_a_bucket(monkeypatch):
    monkeypatch.setattr(traffic_refresh, "get_settings", lambda: Settings(traffic_bucket=""))
    with pytest.raises(RuntimeError, match="TRAFFIC_BUCKET"):
        traffic_refresh.handler({}, None, s3=FakeS3())
