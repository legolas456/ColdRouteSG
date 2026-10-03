from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Optional

import httpx

from app.config import get_settings
from app.services.geo import haversine_km, svy21_to_wgs84
from app.services.mock_data import MOCK_CARPARKS, MOCK_TRAFFIC_CAMERAS, MOCK_WEATHER

WEATHER_URL = "https://api.data.gov.sg/v1/environment/2-hour-weather-forecast"
CARPARK_AVAILABILITY_URL = "https://api.data.gov.sg/v1/transport/carpark-availability"
TRAFFIC_IMAGES_URL = "https://api.data.gov.sg/v1/transport/traffic-images"
HDB_CARPARK_INFO_URL = "https://data.gov.sg/api/action/datastore_search"
HDB_CARPARK_RESOURCE_ID = "d_23f946fa557947f93a8043bbef41dd09"
OSRM_BASE_URL = "https://router.project-osrm.org"
PHOTON_SEARCH_URL = "https://photon.komoot.io/api"

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = asyncio.Lock()


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


async def _cache_get(key: str, ttl_seconds: int) -> Optional[Any]:
    async with _CACHE_LOCK:
        item = _CACHE.get(key)
        if not item:
            return None
        ts, value = item
        if _now_ts() - ts > ttl_seconds:
            _CACHE.pop(key, None)
            return None
        return value


async def _cache_set(key: str, value: Any) -> None:
    async with _CACHE_LOCK:
        _CACHE[key] = (_now_ts(), value)


async def _get_json(url: str, params: Optional[dict[str, Any]] = None) -> Any:
    settings = get_settings()
    headers = {"Accept": "application/json", "User-Agent": "ColdRoute-SG/0.1 local-student-project"}
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, headers=headers, follow_redirects=True) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


async def search_locations(query: str, limit: int = 8) -> dict[str, Any]:
    """Search Singapore places/addresses using Photon without an API key."""
    query = query.strip()
    if len(query) < 2:
        return {"source": "live", "results": []}

    try:
        payload = await _get_json(
            PHOTON_SEARCH_URL,
            params={
                "q": query,
                "limit": limit,
                "lang": "en",
                "countrycode": "SG",
                "bbox": "103.60,1.20,104.10,1.48",
                "lat": 1.3521,
                "lon": 103.8198,
                "zoom": 11,
                "location_bias_scale": 0.2,
            },
        )
        results = []
        seen = set()
        for feature in payload.get("features", []):
            geometry = feature.get("geometry", {})
            coords = geometry.get("coordinates") or []
            if len(coords) < 2:
                continue
            lng, lat = coords[0], coords[1]
            try:
                lat = float(lat)
                lng = float(lng)
            except (TypeError, ValueError):
                continue
            if not (1.20 <= lat <= 1.48 and 103.60 <= lng <= 104.10):
                continue

            props = feature.get("properties", {})
            name = props.get("name") or props.get("street") or query
            street_bits = [props.get("housenumber"), props.get("street")]
            street = " ".join(str(part) for part in street_bits if part)
            detail_parts = []
            if street and street.lower() != str(name).lower():
                detail_parts.append(street)
            for key in ("district", "locality", "city", "postcode"):
                value = props.get(key)
                if value and str(value) not in detail_parts and str(value).lower() != str(name).lower():
                    detail_parts.append(str(value))
            detail = ", ".join(dict.fromkeys(detail_parts))
            label = str(name) if not detail else f"{name} — {detail}"
            dedupe_key = (round(lat, 6), round(lng, 6), str(name).lower())
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            results.append({
                "name": str(name),
                "label": label,
                "lat": lat,
                "lng": lng,
            })
        return {"source": "live", "results": results[:limit]}
    except Exception as exc:
        return {
            "source": "unavailable",
            "warning": f"Location suggestions are temporarily unavailable ({type(exc).__name__}).",
            "results": [],
        }


def weather_risk_from_text(forecast: str) -> float:
    value = forecast.lower()
    if any(term in value for term in ["thundery", "heavy rain", "heavy shower"]):
        return 1.0
    if any(term in value for term in ["moderate rain", "showers", "rain"]):
        return 0.7
    if "drizzle" in value or "light" in value:
        return 0.45
    if "cloud" in value:
        return 0.2
    return 0.1


async def fetch_weather() -> dict[str, Any]:
    cached = await _cache_get("weather", 240)
    if cached is not None:
        return cached
    try:
        payload = await _get_json(WEATHER_URL)
        item = payload["items"][0]
        area_metadata = {a["name"]: a["label_location"] for a in payload.get("area_metadata", [])}
        areas = []
        for forecast in item.get("forecasts", []):
            meta = area_metadata.get(forecast["area"], {})
            areas.append({
                "area": forecast["area"],
                "forecast": forecast["forecast"],
                "lat": meta.get("latitude"),
                "lng": meta.get("longitude"),
                "risk": weather_risk_from_text(forecast["forecast"]),
            })
        result = {"source": "live", "timestamp": item.get("timestamp"), "areas": areas}
    except Exception as exc:
        if not get_settings().allow_mock_fallback:
            raise
        result = {
            "source": "mock",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "warning": f"Weather API unavailable; using demo data ({type(exc).__name__}).",
            "areas": [{**row, "risk": weather_risk_from_text(row["forecast"])} for row in MOCK_WEATHER],
        }
    await _cache_set("weather", result)
    return result


async def nearest_weather(lat: float, lng: float) -> dict[str, Any]:
    data = await fetch_weather()
    candidates = [a for a in data["areas"] if a.get("lat") is not None and a.get("lng") is not None]
    if not candidates:
        return {"area": "Singapore", "forecast": "Unknown", "risk": 0.25, "source": data["source"]}
    best = min(candidates, key=lambda a: haversine_km(lat, lng, a["lat"], a["lng"]))
    return {"area": best["area"], "forecast": best["forecast"], "risk": best["risk"], "source": data["source"]}


async def fetch_carpark_availability() -> dict[str, Any]:
    cached = await _cache_get("carpark_availability", 60)
    if cached is not None:
        return cached
    try:
        payload = await _get_json(CARPARK_AVAILABILITY_URL)
        item = payload["items"][0]
        availability: dict[str, dict[str, int]] = {}
        for cp in item.get("carpark_data", []):
            total = 0
            available = 0
            for info in cp.get("carpark_info", []):
                try:
                    total += int(info.get("total_lots", 0))
                    available += int(info.get("lots_available", 0))
                except (TypeError, ValueError):
                    pass
            availability[cp["carpark_number"]] = {"total_lots": total, "available_lots": available}
        result = {"source": "live", "timestamp": item.get("timestamp"), "availability": availability}
    except Exception as exc:
        if not get_settings().allow_mock_fallback:
            raise
        result = {
            "source": "mock",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "warning": f"Carpark API unavailable; using demo data ({type(exc).__name__}).",
            "availability": {
                cp["carpark_no"]: {"total_lots": cp["total_lots"], "available_lots": cp["available_lots"]}
                for cp in MOCK_CARPARKS
            },
        }
    await _cache_set("carpark_availability", result)
    return result


async def fetch_carpark_locations() -> dict[str, Any]:
    cached = await _cache_get("carpark_locations", 3600)
    if cached is not None:
        return cached
    try:
        payload = await _get_json(
            HDB_CARPARK_INFO_URL,
            params={"resource_id": HDB_CARPARK_RESOURCE_ID, "limit": 5000},
        )
        records = payload.get("result", {}).get("records", [])
        locations = []
        for row in records:
            try:
                lat, lng = svy21_to_wgs84(float(row["x_coord"]), float(row["y_coord"]))
            except (KeyError, TypeError, ValueError):
                continue
            locations.append({
                "carpark_no": row.get("car_park_no"),
                "address": row.get("address"),
                "lat": lat,
                "lng": lng,
                "parking_system": row.get("type_of_parking_system"),
            })
        result = {"source": "live", "locations": locations}
    except Exception as exc:
        if not get_settings().allow_mock_fallback:
            raise
        result = {
            "source": "mock",
            "warning": f"Carpark location dataset unavailable; using demo data ({type(exc).__name__}).",
            "locations": MOCK_CARPARKS,
        }
    await _cache_set("carpark_locations", result)
    return result


async def nearest_carpark(lat: float, lng: float) -> dict[str, Any]:
    locations_data, availability_data = await asyncio.gather(fetch_carpark_locations(), fetch_carpark_availability())
    locations = locations_data["locations"]
    if not locations:
        return {"risk": 0.5, "source": "mock" if "mock" in [locations_data["source"], availability_data["source"]] else "live"}

    nearest = min(locations, key=lambda cp: haversine_km(lat, lng, cp["lat"], cp["lng"]))
    distance_m = haversine_km(lat, lng, nearest["lat"], nearest["lng"]) * 1000
    status = availability_data["availability"].get(nearest["carpark_no"], {})
    total = int(status.get("total_lots", 0) or 0)
    available = int(status.get("available_lots", 0) or 0)
    occupancy = None if total <= 0 else max(0.0, min(1.0, 1 - (available / total)))
    # Distance matters too: a free carpark 1.5 km away is not convenient for a delivery.
    distance_risk = min(1.0, distance_m / 1200.0)
    occupancy_risk = 0.5 if occupancy is None else occupancy
    risk = min(1.0, 0.65 * occupancy_risk + 0.35 * distance_risk)
    source = "live" if locations_data["source"] == availability_data["source"] == "live" else "mock"
    return {
        "carpark_no": nearest.get("carpark_no"),
        "address": nearest.get("address"),
        "lat": nearest.get("lat"),
        "lng": nearest.get("lng"),
        "distance_m": round(distance_m, 1),
        "available_lots": available if total > 0 else None,
        "total_lots": total if total > 0 else None,
        "occupancy_ratio": round(occupancy, 3) if occupancy is not None else None,
        "risk": round(risk, 3),
        "source": source,
    }


async def fetch_traffic_cameras() -> dict[str, Any]:
    cached = await _cache_get("traffic_cameras", 60)
    if cached is not None:
        return cached
    try:
        payload = await _get_json(TRAFFIC_IMAGES_URL)
        item = payload["items"][0]
        cameras = []
        for cam in item.get("cameras", []):
            loc = cam.get("location", {})
            cameras.append({
                "camera_id": cam.get("camera_id"),
                "lat": loc.get("latitude"),
                "lng": loc.get("longitude"),
                "image": cam.get("image"),
                "timestamp": cam.get("timestamp"),
            })
        result = {"source": "live", "timestamp": item.get("timestamp"), "cameras": cameras}
    except Exception as exc:
        if not get_settings().allow_mock_fallback:
            raise
        result = {
            "source": "mock",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "warning": f"Traffic image API unavailable; using demo camera metadata ({type(exc).__name__}).",
            "cameras": MOCK_TRAFFIC_CAMERAS,
        }
    await _cache_set("traffic_cameras", result)
    return result


async def nearest_traffic_cameras(lat: float, lng: float, limit: int = 4) -> list[dict[str, Any]]:
    data = await fetch_traffic_cameras()
    cameras = [c for c in data["cameras"] if c.get("lat") is not None and c.get("lng") is not None]
    cameras.sort(key=lambda c: haversine_km(lat, lng, c["lat"], c["lng"]))
    output = []
    for camera in cameras[:limit]:
        output.append({
            **camera,
            "distance_km": round(haversine_km(lat, lng, camera["lat"], camera["lng"]), 2),
            "source": data["source"],
        })
    return output


async def osrm_matrix(coords: list[tuple[float, float]]) -> tuple[list[list[float]], list[list[float]], str]:
    # coords are (lat, lng); OSRM expects lng,lat
    coord_text = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_text}"
    try:
        payload = await _get_json(url, params={"annotations": "duration,distance"})
        durations = [[float(v or 0) / 60 for v in row] for row in payload["durations"]]
        distances = [[float(v or 0) / 1000 for v in row] for row in payload["distances"]]
        return durations, distances, "live"
    except Exception:
        n = len(coords)
        durations = [[0.0 for _ in range(n)] for _ in range(n)]
        distances = [[0.0 for _ in range(n)] for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                direct = haversine_km(*coords[i], *coords[j])
                road_km = direct * 1.28
                distances[i][j] = road_km
                durations[i][j] = (road_km / 30.0) * 60.0
        return durations, distances, "mock"


async def osrm_route_geometry(coords: list[tuple[float, float]]) -> tuple[list[list[float]], str]:
    coord_text = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"{OSRM_BASE_URL}/route/v1/driving/{coord_text}"
    try:
        payload = await _get_json(url, params={"overview": "full", "geometries": "geojson"})
        geometry = payload["routes"][0]["geometry"]["coordinates"]
        return geometry, "live"
    except Exception:
        return [[lng, lat] for lat, lng in coords], "mock"
