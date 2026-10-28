from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.models import CARGO_PRIORITY, PlannedRun, RouteRequest, RouteResponse

logger = logging.getLogger(__name__)
settings = get_settings()


def _table():
    table_name = settings.dynamodb_routes_table.strip()
    if not table_name:
        raise RuntimeError("DYNAMODB_ROUTES_TABLE is not configured.")

    kwargs: dict[str, Any] = {}
    if settings.aws_region:
        kwargs["region_name"] = settings.aws_region

    return boto3.resource("dynamodb", **kwargs).Table(table_name)


def _dynamodb_safe(value: Any) -> Any:
    """Convert floats to Decimal recursively because DynamoDB rejects Python float."""
    return json.loads(json.dumps(value), parse_float=Decimal)


def _json_safe(value: Any) -> Any:
    """Convert DynamoDB Decimals back to JSON-native int/float values."""
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


def _history_item(
    *,
    user_id: str,
    user_email: str,
    depot_name: str,
    departure_time: str,
    request_data: dict[str, Any],
    result_data: dict[str, Any],
) -> dict[str, Any]:
    """One saved run; the route id starts with the time, so a user's runs list newest first."""
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    route_id = f"{created_at}#{uuid4()}"
    result_data["route_id"] = route_id

    item = {
        "user_id": user_id,
        "route_id": route_id,
        "created_at": created_at,
        "user_email": user_email,
        "depot_name": depot_name,
        "departure_time": departure_time,
        "stop_count": len(request_data.get("stops") or []),
        "request": request_data,
        "result": result_data,
    }
    return _dynamodb_safe(item)


def build_route_history_item(
    *,
    user_id: str,
    user_email: str,
    route_request: RouteRequest,
    route_response: RouteResponse,
) -> dict[str, Any]:
    response_data = route_response.model_dump(mode="json")
    request_data = route_request.model_dump(mode="json")

    # Route geometry can contain many coordinate pairs and is not required for
    # the route-history list. Omitting it keeps DynamoDB items compact.
    response_data.pop("route_geometry", None)

    return _history_item(
        user_id=user_id,
        user_email=user_email,
        depot_name=route_request.depot_name,
        departure_time=route_request.departure_time,
        request_data=request_data,
        result_data=response_data,
    )


def build_planned_run_item(*, user_id: str, user_email: str, run: PlannedRun) -> dict[str, Any]:
    """A run the console planned, with the fields the admin metrics read from optimised runs."""
    request_data = run.model_dump(mode="json", exclude={"plan", "shortest"})
    for stop in request_data["stops"]:
        stop["cold_chain_priority"] = CARGO_PRIORITY[stop["cargo"]]
    result_data = {"source": "console", **run.plan.model_dump(mode="json"), "shortest": run.shortest.model_dump(mode="json")}

    return _history_item(
        user_id=user_id,
        user_email=user_email,
        depot_name=run.depot_name,
        departure_time=run.departure_time,
        request_data=request_data,
        result_data=result_data,
    )


def save_planned_run(*, user_id: str, user_email: str, run: PlannedRun) -> str:
    item = build_planned_run_item(user_id=user_id, user_email=user_email, run=run)
    _table().put_item(Item=item)
    return str(item["route_id"])


def save_route_history(
    *,
    user_id: str,
    user_email: str,
    route_request: RouteRequest,
    route_response: RouteResponse,
) -> str:
    item = build_route_history_item(
        user_id=user_id,
        user_email=user_email,
        route_request=route_request,
        route_response=route_response,
    )
    _table().put_item(Item=item)
    return str(item["route_id"])


def list_route_history(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    response = _table().query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return [_json_safe(item) for item in response.get("Items", [])]


def get_route_history_item(user_id: str, route_id: str) -> dict[str, Any] | None:
    response = _table().get_item(Key={"user_id": user_id, "route_id": route_id})
    item = response.get("Item")
    return _json_safe(item) if item else None


def delete_route_history_item(user_id: str, route_id: str) -> None:
    _table().delete_item(Key={"user_id": user_id, "route_id": route_id})



def scan_all_route_history() -> list[dict[str, Any]]:
    """Return all route-history records for admin analytics.

    This deliberately uses DynamoDB Scan because the current table is keyed by
    user_id + route_id and has no cross-user analytics index. Scan pagination is
    handled so the endpoint continues to work once the table exceeds 1 MB.
    """
    table = _table()
    items: list[dict[str, Any]] = []
    scan_kwargs: dict[str, Any] = {}

    while True:
        response = table.scan(**scan_kwargs)
        items.extend(_json_safe(item) for item in response.get("Items", []))

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    return items

def is_aws_storage_error(exc: Exception) -> bool:
    return isinstance(exc, (BotoCoreError, ClientError, RuntimeError))
