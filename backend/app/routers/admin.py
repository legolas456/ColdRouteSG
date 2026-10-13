from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from app.services.auth import require_admin
from app.services.dynamodb import is_aws_storage_error, list_route_history, scan_all_route_history
from app.services.cognito_users import resolve_email_for_sub

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/me")
def admin_me(request: Request):
    """Small protected endpoint used to verify Cognito admin-group access."""
    admin = require_admin(request)

    return {
        "role": "admin",
        "user_id": admin["user_id"],
        "email": admin["email"],
        "username": admin["username"],
        "groups": admin["groups"],
        "message": "Admin access confirmed.",
    }


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _route_metrics(item: dict[str, Any]) -> dict[str, Any]:
    request_data = item.get("request") or {}
    result = item.get("result") or {}
    stops = request_data.get("stops") or []

    high_priority = sum(
        1
        for stop in stops
        if isinstance(stop, dict) and stop.get("cold_chain_priority") == 1
    )

    return {
        "stop_count": int(item.get("stop_count") or len(stops) or 0),
        "high_priority_deliveries": high_priority,
        "distance_km": _number(result.get("total_distance_km")),
        "travel_minutes": _number(result.get("total_travel_minutes")),
        "service_minutes": _number(result.get("total_service_minutes")),
        "lateness_minutes": _number(result.get("total_lateness_minutes")),
    }


@router.get("/performance")
def admin_performance(request: Request):
    """Aggregate existing route-history data for the admin dashboard.

    These are planning/activity metrics derived from saved route plans. They are
    intentionally not labelled as completed-delivery or actual driver KPIs yet.
    """
    require_admin(request)

    try:
        routes = scan_all_route_history()
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin performance data is temporarily unavailable.",
        ) from exc

    by_driver: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "driver_id": "",
            "email": "",
            "routes": 0,
            "stops": 0,
            "high_priority_deliveries": 0,
            "total_distance_km": 0.0,
            "total_travel_minutes": 0.0,
            "last_route_at": None,
        }
    )

    total_stops = 0
    total_high_priority = 0
    total_distance = 0.0
    total_travel = 0.0
    total_service = 0.0
    total_lateness = 0.0

    for item in routes:
        driver_id = str(item.get("user_id") or "unknown")
        metrics = _route_metrics(item)
        created_at = item.get("created_at")

        total_stops += metrics["stop_count"]
        total_high_priority += metrics["high_priority_deliveries"]
        total_distance += metrics["distance_km"]
        total_travel += metrics["travel_minutes"]
        total_service += metrics["service_minutes"]
        total_lateness += metrics["lateness_minutes"]

        driver = by_driver[driver_id]
        driver["driver_id"] = driver_id
        if item.get("user_email"):
            driver["email"] = str(item.get("user_email"))
        driver["routes"] += 1
        driver["stops"] += metrics["stop_count"]
        driver["high_priority_deliveries"] += metrics["high_priority_deliveries"]
        driver["total_distance_km"] += metrics["distance_km"]
        driver["total_travel_minutes"] += metrics["travel_minutes"]
        if created_at and (not driver["last_route_at"] or created_at > driver["last_route_at"]):
            driver["last_route_at"] = created_at

    # Historical route records may not contain user_email. Resolve any missing
    # emails from Cognito using the stable user_id/sub already stored in DynamoDB.
    for driver_id, driver in by_driver.items():
        if not driver.get("email"):
            driver["email"] = resolve_email_for_sub(driver_id)

    drivers = []
    for driver in by_driver.values():
        route_count = driver["routes"]
        driver["average_stops_per_route"] = round(driver["stops"] / route_count, 1) if route_count else 0
        driver["average_distance_km"] = round(driver["total_distance_km"] / route_count, 2) if route_count else 0
        driver["average_travel_minutes"] = round(driver["total_travel_minutes"] / route_count, 1) if route_count else 0
        driver["total_distance_km"] = round(driver["total_distance_km"], 2)
        driver["total_travel_minutes"] = round(driver["total_travel_minutes"], 1)
        drivers.append(driver)

    drivers.sort(key=lambda row: (-row["routes"], row.get("email") or row["driver_id"]))

    recent_routes = sorted(
        routes,
        key=lambda item: str(item.get("created_at") or ""),
        reverse=True,
    )[:10]

    recent = []
    for item in recent_routes:
        metrics = _route_metrics(item)
        recent.append(
            {
                "route_id": item.get("route_id"),
                "driver_id": item.get("user_id"),
                "email": (
                    item.get("user_email")
                    or by_driver.get(str(item.get("user_id") or "unknown"), {}).get("email")
                    or ""
                ),
                "created_at": item.get("created_at"),
                "depot_name": item.get("depot_name") or "Depot",
                "stop_count": metrics["stop_count"],
                "distance_km": round(metrics["distance_km"], 2),
                "travel_minutes": round(metrics["travel_minutes"], 1),
            }
        )

    route_count = len(routes)
    return {
        "summary": {
            "total_drivers": len(by_driver),
            "total_routes": route_count,
            "total_delivery_stops": total_stops,
            "average_stops_per_route": round(total_stops / route_count, 1) if route_count else 0,
            "high_priority_deliveries": total_high_priority,
            "total_planned_distance_km": round(total_distance, 2),
            "average_planned_travel_minutes": round(total_travel / route_count, 1) if route_count else 0,
            "total_planned_service_minutes": round(total_service, 1),
            "total_planned_lateness_minutes": round(total_lateness, 1),
        },
        "drivers": drivers,
        "recent_routes": recent,
        "metric_scope": "Saved route-planning activity; actual completed-delivery performance is not yet tracked.",
    }


@router.get("/drivers/{driver_id}/routes")
def admin_driver_routes(driver_id: str, request: Request, limit: int = 100):
    """Return a driver's saved route history for the admin drill-down view."""
    require_admin(request)
    safe_limit = max(1, min(limit, 100))

    try:
        routes = list_route_history(driver_id, safe_limit)
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Driver route history is temporarily unavailable.",
        ) from exc

    resolved_email = next(
        (str(route.get("user_email")) for route in routes if route.get("user_email")),
        "",
    ) or resolve_email_for_sub(driver_id)

    if resolved_email:
        for route in routes:
            if not route.get("user_email"):
                route["user_email"] = resolved_email

    return {
        "driver_id": driver_id,
        "email": resolved_email,
        "routes": routes,
        "count": len(routes),
    }
