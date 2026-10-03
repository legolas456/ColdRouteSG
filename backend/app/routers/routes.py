from fastapi import APIRouter

from app.models import RouteRequest, RouteResponse
from app.services.optimization import optimize_route

router = APIRouter(prefix="/api/routes", tags=["route-optimization"])


@router.post("/optimize", response_model=RouteResponse)
async def optimize(request: RouteRequest):
    return await optimize_route(request)
