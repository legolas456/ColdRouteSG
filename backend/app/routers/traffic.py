from fastapi import APIRouter, HTTPException

from app.services.traffic import TrafficUnavailable, traffic_grid

router = APIRouter(prefix="/api/traffic", tags=["traffic"])


@router.get("/grid")
async def speed_grid():
    """Live road speeds (LTA Traffic Speed Bands) as delay factors on ~1 km cells."""
    try:
        return await traffic_grid()
    except TrafficUnavailable as exc:
        # the console plans with normal drive times and says why
        raise HTTPException(status_code=503, detail=str(exc)) from exc
