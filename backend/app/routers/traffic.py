import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.services.traffic import SGT, TrafficUnavailable, traffic_grid
from app.services.typical import MIN_READINGS, day_type, slot_of, typical_grid

router = APIRouter(prefix="/api/traffic", tags=["traffic"])


@router.get("/grid")
async def speed_grid():
    """Live road speeds (LTA Traffic Speed Bands) as delay factors on ~1 km cells."""
    try:
        return await traffic_grid()
    except TrafficUnavailable as exc:
        # the console plans with normal drive times and says why
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/typical")
async def typical(at: datetime = Query(..., description="Departure time, ISO 8601; without an offset it is Singapore time")):
    """Typical traffic for a departure: the grid of the weekday or weekend slot it falls in."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=SGT)
    try:
        grid = await asyncio.to_thread(typical_grid, at)
    except LookupError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if grid is None:
        local = at.astimezone(SGT)
        slot = slot_of(local)
        raise HTTPException(
            status_code=404,
            detail=f"No typical traffic for a {day_type(local)} at {slot[:2]}:{slot[2:]} yet: "
            f"it needs at least {MIN_READINGS} kept readings in that slot.",
        )
    return grid
