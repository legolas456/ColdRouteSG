"""Route history and the admin view, through the Lambda handler as API Gateway calls it.

API Gateway checks the Cognito token and passes the verified claims in the
request context; these tests send such events, with an in-memory table in
place of DynamoDB.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

import lambda_handler
from app.models import PlannedRun, RouteRequest, RouteResponse
from app.services import dynamodb

DRIVER = {"sub": "driver-1", "email": "driver@example.com", "cognito:username": "driver-1"}
OTHER = {"sub": "driver-2", "email": "other@example.com", "cognito:username": "driver-2"}
# API Gateway passes a list claim as one string
ADMIN = {"sub": "admin-1", "email": "manager@example.com", "cognito:groups": "[admin]"}


class FakeTable:
    def __init__(self):
        self.items: dict[tuple[str, str], dict] = {}

    def put_item(self, Item):
        self.items[(Item["user_id"], Item["route_id"])] = Item

    def query(self, KeyConditionExpression, ScanIndexForward=True, Limit=None):
        user_id = KeyConditionExpression.get_expression()["values"][1]
        rows = sorted((v for (u, _), v in self.items.items() if u == user_id), key=lambda i: i["route_id"])
        if not ScanIndexForward:
            rows.reverse()
        return {"Items": rows[:Limit]}

    def get_item(self, Key):
        item = self.items.get((Key["user_id"], Key["route_id"]))
        return {"Item": item} if item else {}

    def delete_item(self, Key):
        self.items.pop((Key["user_id"], Key["route_id"]), None)

    def scan(self, **_):
        return {"Items": list(self.items.values())}


@pytest.fixture
def table(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(dynamodb, "_table", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def event_loop():
    """Mangum runs each request on asyncio's current loop, which a Lambda process
    has; other tests' asyncio.run() leaves none behind."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield
    asyncio.set_event_loop(None)
    loop.close()


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    """Each save a second after the last, as real saves are; route ids sort by time."""

    class Clock(datetime):
        current = datetime(2026, 10, 29, 3, 0, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz=None):
            cls.current += timedelta(seconds=1)
            return cls.current

    monkeypatch.setattr(dynamodb, "datetime", Clock)


def call(method: str, path: str, claims: dict | None = None, body=None, query: str = "") -> tuple[int, object]:
    """One request as an API Gateway HTTP API (payload 2.0) event."""
    context = {
        "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "203.0.113.1", "userAgent": "pytest"},
        "requestId": "test",
        "routeKey": f"{method} {path}",
        "stage": "$default",
        "accountId": "123456789012",
        "apiId": "api",
        "domainName": "api.example.com",
        "domainPrefix": "api",
        "time": "29/Oct/2026:03:00:00 +0000",
        "timeEpoch": 0,
    }
    if claims is not None:
        context["authorizer"] = {"jwt": {"claims": claims, "scopes": None}}
    event = {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": query,
        "headers": {"content-type": "application/json", "host": "api.example.com"},
        "requestContext": context,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
    }
    response = lambda_handler.handler(event, None)
    text = response.get("body") or ""
    return response["statusCode"], json.loads(text) if text else None


def run(**changes) -> dict:
    """A run as the console sends it after planning: two stops, the plan and the shortest route."""
    body = {
        "depot": {"lat": 1.3329, "lng": 103.7436},
        "depot_name": "Jurong Cold Store",
        "depot_address": "21 Fishery Port Road",
        "departure_time": "08:45",
        "profile": "pharma",
        "data_mode": "live",
        "stops": [
            {"id": "nuh", "name": "NUH Pharmacy", "lat": 1.2937, "lng": 103.7831, "window_start": "09:30",
             "window_end": "10:30", "service_minutes": 12, "cargo": "PHARMA"},
            {"id": "amk", "name": "AMK Hub FairPrice", "lat": 1.3691, "lng": 103.8484, "window_start": "10:00",
             "window_end": "12:30", "service_minutes": 8, "cargo": "FROZEN"},
        ],
        "plan": {"order": ["nuh", "amk"], "total_distance_km": 31.2, "total_travel_minutes": 48, "total_service_minutes": 20,
                 "total_lateness_minutes": 0, "late_stops": 0, "exposure_minutes": 141, "rain_stops": 0},
        "shortest": {"order": ["amk", "nuh"], "total_distance_km": 29.8, "total_travel_minutes": 45, "total_service_minutes": 20,
                     "total_lateness_minutes": 22, "late_stops": 1, "exposure_minutes": 150, "rain_stops": 0},
    }
    body.update(changes)
    return body


# ---- saving and reading a user's runs ---------------------------------------------


def test_a_planned_run_is_saved_for_the_signed_in_user(table):
    status, body = call("POST", "/api/routes/history", DRIVER, run())
    assert status == 201
    [item] = table.items.values()
    assert item["route_id"] == body["route_id"]
    assert item["user_id"] == "driver-1" and item["user_email"] == "driver@example.com"
    assert item["depot_name"] == "Jurong Cold Store" and item["departure_time"] == "08:45"
    assert item["stop_count"] == 2
    # the admin metrics count cold-chain priority from the stops: pharma is 1, frozen 2
    assert [s["cold_chain_priority"] for s in item["request"]["stops"]] == [1, 2]
    assert item["result"]["source"] == "console"
    assert item["result"]["order"] == ["nuh", "amk"]
    assert item["result"]["shortest"]["late_stops"] == 1


def test_a_user_lists_reopens_and_deletes_only_their_own_runs(table):
    _, first = call("POST", "/api/routes/history", DRIVER, run())
    _, second = call("POST", "/api/routes/history", DRIVER, run(departure_time="13:00"))
    call("POST", "/api/routes/history", OTHER, run())

    status, listed = call("GET", "/api/routes/history", DRIVER, query="limit=10")
    assert status == 200
    assert [r["route_id"] for r in listed["routes"]] == [second["route_id"], first["route_id"]]  # newest first

    status, item = call("GET", f"/api/routes/history/{first['route_id']}", DRIVER)
    assert status == 200 and item["request"]["departure_time"] == "08:45"
    # another driver's run is not found, rather than forbidden: its existence is not revealed
    assert call("GET", f"/api/routes/history/{first['route_id']}", OTHER)[0] == 404

    assert call("DELETE", f"/api/routes/history/{first['route_id']}", DRIVER)[0] == 204
    assert [r["route_id"] for r in call("GET", "/api/routes/history", DRIVER)[1]["routes"]] == [second["route_id"]]


def test_without_verified_claims_nothing_is_read_or_saved(table):
    # API Gateway refuses these first; the backend refuses them too if a route is ever left open
    assert call("POST", "/api/routes/history", None, run())[0] == 401
    assert call("GET", "/api/routes/history", None)[0] == 401
    assert table.items == {}


@pytest.mark.parametrize(
    "change",
    [
        {"stops": []},
        {"departure_time": "25:99"},
        {"profile": "cheapest"},
        {"depot": {"lat": 51.5, "lng": -0.1}},  # outside Singapore
        # the same stop twice, with plans that visit it twice
        {
            "stops": [run()["stops"][0], run()["stops"][0]],
            "plan": {**run()["plan"], "order": ["nuh", "nuh"]},
            "shortest": {**run()["shortest"], "order": ["nuh", "nuh"]},
        },
        {"stops": [{**run()["stops"][0], "cargo": "AMBIENT"}, run()["stops"][1]]},
        {"stops": [{**run()["stops"][0], "window_end": "9:30"}, run()["stops"][1]]},
        {"plan": {**run()["plan"], "order": ["nuh"]}},  # a plan that skips a stop
        {"shortest": {**run()["shortest"], "order": ["nuh", "nuh"]}},
    ],
)
def test_a_malformed_run_is_rejected(table, change):
    status, body = call("POST", "/api/routes/history", DRIVER, run(**change))
    assert status == 422, body
    assert table.items == {}


def test_too_many_stops_are_rejected(table):
    stops = [{**run()["stops"][0], "id": f"s{n}"} for n in range(16)]
    order = [s["id"] for s in stops]
    body = run(stops=stops, plan={**run()["plan"], "order": order}, shortest={**run()["shortest"], "order": order})
    assert call("POST", "/api/routes/history", DRIVER, body)[0] == 422


def test_storage_failure_says_the_run_was_not_saved(monkeypatch):
    def broken():
        raise ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "no table"}}, "PutItem")

    monkeypatch.setattr(dynamodb, "_table", broken)
    status, body = call("POST", "/api/routes/history", DRIVER, run())
    assert status == 503 and "not saved" in body["detail"]


def test_without_a_table_configured_history_is_unavailable(monkeypatch):
    monkeypatch.setattr(dynamodb.settings, "dynamodb_routes_table", "")
    assert call("POST", "/api/routes/history", DRIVER, run())[0] == 503


# ---- the admin view ------------------------------------------------------------------


def test_admin_performance_counts_runs_planned_in_the_console(table):
    call("POST", "/api/routes/history", DRIVER, run())
    call("POST", "/api/routes/history", DRIVER, run())
    call("POST", "/api/routes/history", OTHER, run())

    status, body = call("GET", "/api/admin/performance", ADMIN)
    assert status == 200
    summary = body["summary"]
    assert summary["total_drivers"] == 2 and summary["total_routes"] == 3
    assert summary["total_delivery_stops"] == 6
    assert summary["high_priority_deliveries"] == 3  # one pharma stop per run
    assert summary["total_planned_distance_km"] == pytest.approx(3 * 31.2)
    assert summary["average_planned_travel_minutes"] == 48
    drivers = {d["email"]: d["routes"] for d in body["drivers"]}
    assert drivers == {"driver@example.com": 2, "other@example.com": 1}


def test_admin_routes_need_the_admin_group(table):
    assert call("GET", "/api/admin/performance", DRIVER)[0] == 403
    assert call("GET", f"/api/admin/drivers/{DRIVER['sub']}/routes", DRIVER)[0] == 403
    status, body = call("GET", f"/api/admin/drivers/{DRIVER['sub']}/routes", ADMIN)
    assert status == 200 and body["count"] == 0


# ---- the optimise endpoint's records keep their shape ----------------------------------------


def test_optimised_runs_are_stored_as_before():
    request = RouteRequest(
        depot={"lat": 1.3329, "lng": 103.7436},
        stops=[{"id": "a", "name": "A", "lat": 1.30, "lng": 103.80, "cold_chain_priority": 1}],
    )
    response = RouteResponse(
        generated_at=datetime(2026, 10, 29, tzinfo=timezone.utc),
        data_mode="mock",
        total_distance_km=5.0,
        total_travel_minutes=10.0,
        total_service_minutes=10,
        total_lateness_minutes=0.0,
        composite_score=1.0,
        ordered_stop_ids=["a"],
        legs=[],
        route_geometry=[[103.8, 1.3], [103.81, 1.31]],
    )
    item = dynamodb.build_route_history_item(user_id="u", user_email="u@example.com", route_request=request, route_response=response)
    assert item["route_id"].startswith(item["created_at"])
    assert item["result"]["route_id"] == item["route_id"]
    assert "route_geometry" not in item["result"]
    assert item["stop_count"] == 1 and item["depot_name"] == "Depot"


def test_planned_run_model_round_trips():
    parsed = PlannedRun.model_validate(run())
    assert parsed.stops[1].cargo == "FROZEN" and parsed.shortest.late_stops == 1


def test_the_console_sample_run_is_accepted(table):
    # frontend/src/lib/__tests__/history.test.ts checks the console sends exactly this
    sample = json.loads((Path(__file__).parent / "fixtures" / "planned_run_sample.json").read_text())
    status, _ = call("POST", "/api/routes/history", DRIVER, sample)
    assert status == 201
    [item] = table.items.values()
    assert item["stop_count"] == 7
    assert item["result"]["order"] == ["HV", "NUH", "TPG", "AMK", "WHC", "TAM", "MBFC"]
    pharma = sum(1 for s in sample["stops"] if s["cargo"] == "PHARMA")
    assert sum(1 for s in item["request"]["stops"] if s["cold_chain_priority"] == 1) == pharma
