"""Regression tests for the cold-chain priority look-ahead heuristic.

All external services are mocked; tests never use the live public APIs.
"""

import asyncio

from app.models import RouteRequest
from app.services import optimization


def _request(*, high_priority=1, low_priority=3, high_service=10, low_service=10, cold_weight=1.0, weather_weight=0.0):
    return RouteRequest.model_validate({
        "depot": {"lat": 1.30, "lng": 103.80},
        "departure_time": "08:30",
        "stops": [
            {"id": "low", "name": "Low priority", "lat": 1.31, "lng": 103.81,
             "cold_chain_priority": low_priority, "service_minutes": low_service},
            {"id": "high", "name": "High priority", "lat": 1.32, "lng": 103.82,
             "cold_chain_priority": high_priority, "service_minutes": high_service},
        ],
        "weights": {"travel": 1.0, "weather": weather_weight,
                    "parking": 0.0, "cold_chain": cold_weight, "lateness": 0.0},
    })


def _run(monkeypatch, request, durations, weather_risks=(0.0, 0.0)):
    async def matrix(_coords):
        return durations, [[0.0 if i == j else durations[i][j] / 2 for j in range(3)] for i in range(3)], "mock"

    async def nearest_weather(_lat, lng):
        risk = weather_risks[0] if abs(lng - 103.81) < 0.001 else weather_risks[1]
        return {"area": "Singapore", "forecast": "Test", "risk": risk, "source": "mock"}

    async def nearest_carpark(_lat, _lng):
        return {"risk": 0.0, "source": "mock"}

    async def route_geometry(_coords):
        return [], "mock"

    monkeypatch.setattr(optimization, "osrm_matrix", matrix)
    monkeypatch.setattr(optimization, "nearest_weather", nearest_weather)
    monkeypatch.setattr(optimization, "nearest_carpark", nearest_carpark)
    monkeypatch.setattr(optimization, "osrm_route_geometry", route_geometry)
    return asyncio.run(optimization.optimize_route(request))


def test_high_priority_selected_first_when_travel_conditions_equal(monkeypatch):
    # Both destinations are 10 minutes from the depot and each other.
    # Low priority is deliberately listed FIRST to expose previous bug.
    matrix = [[0, 10, 10], [10, 0, 10], [10, 10, 0]]
    result = _run(monkeypatch, _request(), matrix)
    assert result.ordered_stop_ids == ["high", "low"]
    assert result.legs[0].cold_chain_priority == 1
    assert result.composite_score == round(sum(leg.incremental_score for leg in result.legs), 2)


def test_cold_chain_weight_zero_disables_priority_preference(monkeypatch):
    matrix = [[0, 10, 10], [10, 0, 10], [10, 10, 0]]
    result = _run(monkeypatch, _request(cold_weight=0.0), matrix)
    assert result.ordered_stop_ids == ["low", "high"]


def test_priority_not_absolute_when_high_priority_much_farther(monkeypatch):
    # The system still trades off urgency and actual road travel time.
    matrix = [[0, 2, 30], [2, 0, 15], [30, 15, 0]]
    result = _run(monkeypatch, _request(), matrix)
    assert result.ordered_stop_ids == ["low", "high"]


def test_weather_penalty_still_influences_next_stop(monkeypatch):
    matrix = [[0, 10, 10], [10, 0, 10], [10, 10, 0]]
    # High-priority destination experiences severe weather; with very high
    # weather weight this operational constraint should still matter.
    result = _run(monkeypatch, _request(weather_weight=5.0), matrix, weather_risks=(0.0, 1.0))
    assert result.ordered_stop_ids == ["low", "high"]


def test_service_time_included_in_lookahead(monkeypatch):
    matrix = [[0, 10, 10], [10, 0, 10], [10, 10, 0]]
    # Serving the low-priority stop would keep the urgent delivery waiting.
    result = _run(monkeypatch, _request(low_service=90, high_service=0), matrix)
    assert result.ordered_stop_ids[0] == "high"
