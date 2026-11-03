import logging

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.models import PlannedRun, RouteRequest, RouteResponse
from app.services.auth import get_current_user
from app.services.dynamodb import (
    delete_route_history_item,
    get_route_history_item,
    is_aws_storage_error,
    route_history_page,
    save_planned_run,
    save_route_history,
)
from app.services.optimization import optimize_route

router = APIRouter(prefix="/api/routes", tags=["route-optimization"])
logger = logging.getLogger(__name__)


@router.post("/optimize", response_model=RouteResponse)
async def optimize(payload: RouteRequest, request: Request):
    current_user = get_current_user(request)
    result = await optimize_route(payload)

    try:
        route_id = save_route_history(
            user_id=current_user["user_id"],
            user_email=current_user["email"],
            route_request=payload,
            route_response=result,
        )
        result.route_id = route_id
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        logger.exception("Route optimisation succeeded but DynamoDB persistence failed.")
        result.warnings.append(
            "Route optimisation succeeded, but this run could not be saved to route history."
        )

    return result


@router.post("/history", status_code=status.HTTP_201_CREATED)
def save_planned(payload: PlannedRun, request: Request):
    """Save a run the console planned in the browser to the user's route history."""
    current_user = get_current_user(request)
    try:
        route_id = save_planned_run(user_id=current_user["user_id"], user_email=current_user["email"], run=payload)
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        logger.exception("Saving a planned run to DynamoDB failed.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route history is temporarily unavailable, so this run was not saved.",
        ) from exc
    return {"route_id": route_id}


@router.get("/history")
def history(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    after: str | None = Query(None, max_length=200, description="The `next` of the previous page"),
):
    current_user = get_current_user(request)

    try:
        items, next_after = route_history_page(current_user["user_id"], limit=limit, after=after)
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        logger.exception("Unable to read route history from DynamoDB.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route history is temporarily unavailable.",
        ) from exc

    return {"routes": items, "count": len(items), "next": next_after}


@router.get("/history/{route_id}")
def history_item(route_id: str, request: Request):
    current_user = get_current_user(request)

    try:
        item = get_route_history_item(current_user["user_id"], route_id)
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        logger.exception("Unable to read route history item from DynamoDB.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route history is temporarily unavailable.",
        ) from exc

    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found.")
    return item


@router.delete("/history/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_history_item(route_id: str, request: Request):
    current_user = get_current_user(request)

    try:
        # Because user_id is part of the DynamoDB key, one user cannot delete
        # another user's route by guessing a route_id.
        delete_route_history_item(current_user["user_id"], route_id)
    except Exception as exc:
        if not is_aws_storage_error(exc):
            raise
        logger.exception("Unable to delete route history item from DynamoDB.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Route history is temporarily unavailable.",
        ) from exc
