import asyncio
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.services.parking import read_published_carparks
from app.services.traffic import TrafficUnavailable

router = APIRouter(prefix="/api/parking", tags=["parking"])

CACHE_SECONDS = 120
_cached: Optional[tuple[float, dict[str, Any]]] = None


@router.get("/carparks")
async def carparks():
    """Free car lots in URA and mall carparks (LTA DataMall), as the scheduled refresh last published them."""
    global _cached
    if _cached and time.monotonic() - _cached[0] < CACHE_SECONDS:
        return _cached[1]
    settings = get_settings()
    if not settings.traffic_bucket:
        raise HTTPException(status_code=503, detail="LTA carparks need the scheduled refresh (TRAFFIC_BUCKET is not set).")
    try:
        import boto3  # in the Lambda runtime and requirements.txt

        feed = await asyncio.to_thread(read_published_carparks, boto3.client("s3"), settings.traffic_bucket)
    except TrafficUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    _cached = (time.monotonic(), feed)
    return feed
