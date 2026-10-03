from fastapi import APIRouter, Query

from app.services.public_apis import (
    fetch_carpark_availability,
    fetch_traffic_cameras,
    fetch_weather,
    nearest_carpark,
    nearest_traffic_cameras,
    search_locations,
)

router = APIRouter(prefix="/api/data", tags=["public-data"])


@router.get("/locations/search")
async def locations_search(q: str = Query(..., min_length=2, max_length=120), limit: int = Query(8, ge=1, le=12)):
    return await search_locations(q, limit=limit)


@router.get("/weather")
async def weather():
    return await fetch_weather()


@router.get("/parking")
async def parking_summary():
    data = await fetch_carpark_availability()
    availability = data["availability"]
    total_carparks = len(availability)
    total_lots = sum(row.get("total_lots", 0) or 0 for row in availability.values())
    available_lots = sum(row.get("available_lots", 0) or 0 for row in availability.values())
    return {
        "source": data["source"],
        "timestamp": data.get("timestamp"),
        "total_carparks": total_carparks,
        "total_lots": total_lots,
        "available_lots": available_lots,
        "availability_ratio": round(available_lots / total_lots, 3) if total_lots else None,
        "warning": data.get("warning"),
    }


@router.get("/parking/nearby")
async def parking_nearby(lat: float = Query(..., ge=1.0, le=1.6), lng: float = Query(..., ge=103.5, le=104.2)):
    return await nearest_carpark(lat, lng)


@router.get("/traffic-cameras")
async def traffic_cameras(limit: int = Query(8, ge=1, le=20)):
    data = await fetch_traffic_cameras()
    return {**data, "cameras": data["cameras"][:limit]}


@router.get("/traffic-cameras/nearby")
async def traffic_cameras_nearby(
    lat: float = Query(..., ge=1.0, le=1.6),
    lng: float = Query(..., ge=103.5, le=104.2),
    limit: int = Query(4, ge=1, le=12),
):
    return {"cameras": await nearest_traffic_cameras(lat, lng, limit=limit)}
