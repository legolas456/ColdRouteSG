from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Coordinate(BaseModel):
    lat: float = Field(..., ge=1.0, le=1.6)
    lng: float = Field(..., ge=103.5, le=104.2)


class DeliveryStop(Coordinate):
    id: str
    name: str
    service_minutes: int = Field(10, ge=0, le=180)
    cold_chain_priority: int = Field(2, ge=1, le=3, description="1 = highest priority, 3 = lowest priority")
    window_end: Optional[str] = Field(default=None, description="HH:MM, e.g. 11:30")

    @field_validator("cold_chain_priority", mode="before")
    @classmethod
    def normalise_cold_chain_priority(cls, value):
        """Accept current 1/2/3 priorities and legacy 0-1 scores."""
        if isinstance(value, bool):
            return value

        if isinstance(value, (int, float)):
            numeric = float(value)

            # Current format: 1 = highest, 2 = medium, 3 = lower.
            if numeric in (1.0, 2.0, 3.0):
                return int(numeric)

            # Backward compatibility for the previous 0-1 priority score.
            # Higher legacy scores represented higher cold-chain priority.
            if 0.0 <= numeric <= 1.0:
                if numeric >= 0.75:
                    return 1
                if numeric >= 0.40:
                    return 2
                return 3

        return value


class RouteWeights(BaseModel):
    travel: float = Field(1.0, ge=0, le=5)
    weather: float = Field(0.7, ge=0, le=5)
    parking: float = Field(0.7, ge=0, le=5)
    cold_chain: float = Field(1.0, ge=0, le=5)
    lateness: float = Field(1.2, ge=0, le=5)


class RouteRequest(BaseModel):
    depot: Coordinate
    depot_name: str = "Depot"
    departure_time: str = "08:30"
    stops: list[DeliveryStop] = Field(..., min_length=1, max_length=15)
    weights: RouteWeights = Field(default_factory=RouteWeights)


class WeatherContext(BaseModel):
    area: str
    forecast: str
    risk: float
    source: Literal["live", "mock"]


class ParkingContext(BaseModel):
    carpark_no: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    distance_m: Optional[float] = None
    available_lots: Optional[int] = None
    total_lots: Optional[int] = None
    occupancy_ratio: Optional[float] = None
    risk: float
    source: Literal["live", "mock"]


class RouteLeg(BaseModel):
    sequence: int
    stop_id: str
    stop_name: str
    eta: str
    travel_minutes: float
    distance_km: float
    service_minutes: int
    weather: WeatherContext
    parking: ParkingContext
    cold_chain_priority: int
    lateness_minutes: float
    incremental_score: float
    rationale: list[str]


class RouteResponse(BaseModel):
    generated_at: datetime
    data_mode: Literal["live", "mixed", "mock"]
    total_distance_km: float
    total_travel_minutes: float
    total_service_minutes: int
    total_lateness_minutes: float
    composite_score: float
    ordered_stop_ids: list[str]
    legs: list[RouteLeg]
    route_geometry: list[list[float]] = Field(default_factory=list, description="GeoJSON-style [lng, lat] pairs")
    warnings: list[str] = Field(default_factory=list)
