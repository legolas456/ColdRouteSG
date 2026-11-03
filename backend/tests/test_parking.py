import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.routers import parking as parking_router
from app.services import parking
from app.services.parking import PARKING_KEY, carpark_feed, fetch_carparks, parse_carpark
from app.services.traffic import TrafficUnavailable
from tests.test_traffic import CARPARK_ROWS, FETCHED_AT, MEASURED_AT, FakeS3, _refresh

URA, MALL, HDB = CARPARK_ROWS


@pytest.mark.parametrize(
    "row,expected",
    [
        (URA, {"id": "URA-A0007", "agency": "URA", "name": "ANGULLIA PARK OFF ST", "lat": 1.3053, "lng": 103.8296, "free": 224}),
        (MALL, {"id": "LTA-1", "agency": "LTA", "name": "Suntec City", "lat": 1.29375, "lng": 103.85718, "free": 2917}),
        (HDB, None),  # data.gov.sg has HDB carparks with their size
        ({**URA, "LotType": "Y"}, None),  # motorcycle lots
        ({**URA, "LotType": "H"}, None),  # heavy vehicles
        ({**URA, "Location": ""}, None),
        ({**URA, "Location": "north"}, None),
        ({**URA, "Location": "1.45 104.5"}, None),  # in Johor
        ({**URA, "AvailableLots": "many"}, None),
        ({**URA, "AvailableLots": -3}, {"id": "URA-A0007", "agency": "URA", "name": "ANGULLIA PARK OFF ST", "lat": 1.3053, "lng": 103.8296, "free": 0}),
        ({**URA, "Development": "  "}, {"id": "URA-A0007", "agency": "URA", "name": "A0007", "lat": 1.3053, "lng": 103.8296, "free": 224}),
    ],
)
def test_parse_carpark(row, expected):
    assert parse_carpark(row) == expected


def test_the_feed_keeps_urban_and_mall_car_lots_in_order():
    feed = carpark_feed(CARPARK_ROWS, FETCHED_AT)
    assert [c["id"] for c in feed["carparks"]] == ["LTA-1", "URA-A0007"]
    assert feed["fetchedAt"] == "2026-10-27T08:30:00+08:00"


def _lta(rows: list[dict], seen: list[httpx.Request], answer: int = 200):
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if answer != 200:
            return httpx.Response(answer, json={"fault": {"detail": {"errorcode": "policies.ratelimit.QuotaViolation"}}})
        skip = int(request.url.params["$skip"])
        return httpx.Response(200, json={"value": rows[skip : skip + parking.PAGE_SIZE]})

    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


@pytest.mark.parametrize("total", [0, 3, 500, 2615])
def test_fetch_reads_every_page_once(total):
    rows = [{**URA, "CarParkID": str(n)} for n in range(total)]
    seen: list[httpx.Request] = []
    assert asyncio.run(fetch_carparks("key", _lta(rows, seen))) == rows
    assert [r.url.params["$skip"] for r in seen] == [str(n * 500) for n in range(total // 500 + 1)]
    assert all(r.headers["AccountKey"] == "key" for r in seen)


def test_a_used_up_quota_is_said_and_not_retried():
    seen: list[httpx.Request] = []
    with pytest.raises(TrafficUnavailable, match="quota"):
        asyncio.run(fetch_carparks("key", _lta([], seen, answer=500)))
    assert len(seen) == 1


def test_no_key_makes_no_call():
    seen: list[httpx.Request] = []
    with pytest.raises(TrafficUnavailable, match="AccountKey"):
        asyncio.run(fetch_carparks("", _lta([], seen)))
    assert seen == []


def test_the_refresh_publishes_the_carparks(monkeypatch):
    s3 = FakeS3()
    summary = _refresh(monkeypatch, s3)
    assert summary["carparks"] == 2
    put = s3.objects[PARKING_KEY]
    assert put["ContentType"] == "application/json" and "max-age=60" in put["CacheControl"]
    assert [c["id"] for c in json.loads(put["Body"])["carparks"]] == ["LTA-1", "URA-A0007"]


def test_a_carpark_failure_does_not_stop_the_traffic(monkeypatch):
    s3 = FakeS3()
    summary = _refresh(monkeypatch, s3, carparks=TrafficUnavailable("LTA DataMall's call quota for this AccountKey is used up; carparks return when it resets."))
    assert summary["carparks"].startswith("not refreshed: LTA DataMall's call quota")
    assert "traffic/grid.json" in s3.objects and PARKING_KEY not in s3.objects
    assert summary["kept"] == f"traffic/history/{MEASURED_AT:%Y/%m/%d/%H%M}.json.gz"


def test_a_page_that_is_not_json_is_a_carpark_failure():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>busy</html>")))
    with pytest.raises(TrafficUnavailable, match="not JSON"):
        asyncio.run(fetch_carparks("key", client))
    odd = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=["value"])))
    with pytest.raises(TrafficUnavailable, match="unexpected"):
        asyncio.run(fetch_carparks("key", odd))


def test_rows_that_are_not_objects_are_skipped():
    assert carpark_feed(["URA", None, 3, URA], FETCHED_AT)["carparks"][0]["id"] == "URA-A0007"


def test_a_carpark_publish_failure_does_not_stop_the_traffic(monkeypatch):
    class RefusesCarparks(FakeS3):
        def put_object(self, **kw):
            if kw["Key"] == PARKING_KEY:
                raise RuntimeError("AccessDenied")
            return super().put_object(**kw)

    s3 = RefusesCarparks()
    summary = _refresh(monkeypatch, s3)
    assert summary["carparks"] == "not refreshed: The carparks could not be published (RuntimeError)."
    assert "traffic/grid.json" in s3.objects and PARKING_KEY not in s3.objects


def test_the_api_serves_the_published_carparks(monkeypatch):
    feed = carpark_feed(CARPARK_ROWS, FETCHED_AT)
    reads = []

    def fake_read(s3, bucket):
        reads.append(bucket)
        return feed

    monkeypatch.setattr(parking_router, "_cached", None)
    monkeypatch.setattr(parking_router, "get_settings", lambda: Settings(traffic_bucket="bucket"))
    monkeypatch.setattr(parking_router, "read_published_carparks", fake_read)
    client = TestClient(app)
    assert client.get("/api/parking/carparks").json() == feed
    assert client.get("/api/parking/carparks").json() == feed
    assert reads == ["bucket"]  # the second answer came from the cache


def test_the_api_says_why_there_are_no_carparks(monkeypatch):
    monkeypatch.setattr(parking_router, "_cached", None)
    monkeypatch.setattr(parking_router, "get_settings", lambda: Settings(traffic_bucket=""))
    response = TestClient(app).get("/api/parking/carparks")
    assert response.status_code == 503 and "TRAFFIC_BUCKET" in response.json()["detail"]

    def broken(s3, bucket):
        raise TrafficUnavailable("The published carparks could not be read (KeyError).")

    monkeypatch.setattr(parking_router, "get_settings", lambda: Settings(traffic_bucket="bucket"))
    monkeypatch.setattr(parking_router, "read_published_carparks", broken)
    response = TestClient(app).get("/api/parking/carparks")
    assert response.status_code == 503 and "could not be read" in response.json()["detail"]
