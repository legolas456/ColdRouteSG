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
from app.models import RouteRequest, RouteResponse

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


def build_route_history_item(
    *,
    user_id: str,
    user_email: str,
    route_request: RouteRequest,
    route_response: RouteResponse,
) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    route_id = f"{created_at}#{uuid4()}"

    response_data = route_response.model_dump(mode="json")
    request_data = route_request.model_dump(mode="json")

    # Route geometry can contain many coordinate pairs and is not required for
    # the route-history list. Omitting it keeps DynamoDB items compact.
    response_data.pop("route_geometry", None)
    response_data["route_id"] = route_id

    item = {
        "user_id": user_id,
        "route_id": route_id,
        "created_at": created_at,
        "user_email": user_email,
        "depot_name": route_request.depot_name,
        "departure_time": route_request.departure_time,
        "stop_count": len(route_request.stops),
        "request": request_data,
        "result": response_data,
    }
    return _dynamodb_safe(item)


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
