from __future__ import annotations

import asyncio
from datetime import datetime

from app.models import DeliveryStop, RouteLeg, RouteRequest, RouteResponse
from app.services.public_apis import nearest_carpark, nearest_weather, osrm_matrix, osrm_route_geometry


def _parse_hhmm(value: str) -> int:
    hour, minute = value.split(":", 1)
    return int(hour) * 60 + int(minute)


def _format_minutes(total_minutes: float) -> str:
    total = int(round(total_minutes)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def _priority_factor(priority: int) -> float:
    # Priority 1 is most urgent. The factor is used only internally by the optimiser.
    return {1: 1.0, 2: 0.6, 3: 0.25}.get(priority, 0.6)


def _rationale(stop: DeliveryStop, weather_risk: float, parking_risk: float, lateness: float) -> list[str]:
    reasons: list[str] = []
    if stop.cold_chain_priority == 1:
        reasons.append("Cold-chain priority 1 favours earlier delivery.")
    elif stop.cold_chain_priority == 2:
        reasons.append("Cold-chain priority 2 gives this delivery moderate urgency.")
    if weather_risk >= 0.7:
        reasons.append("Adverse weather risk increases delay/exposure cost.")
    if parking_risk >= 0.7:
        reasons.append("Limited or remote parking increases service risk.")
    if lateness > 0:
        reasons.append(f"Projected {lateness:.0f} min late at this position.")
    if not reasons:
        reasons.append("Selected mainly for efficient travel from the current stop.")
    return reasons


async def optimize_route(request: RouteRequest) -> RouteResponse:
    coords = [(request.depot.lat, request.depot.lng)] + [(s.lat, s.lng) for s in request.stops]
    durations, distances, matrix_mode = await osrm_matrix(coords)

    enrichments = await asyncio.gather(
        *[
            asyncio.gather(nearest_weather(stop.lat, stop.lng), nearest_carpark(stop.lat, stop.lng))
            for stop in request.stops
        ]
    )
    weather_by_idx = {i + 1: pair[0] for i, pair in enumerate(enrichments)}
    parking_by_idx = {i + 1: pair[1] for i, pair in enumerate(enrichments)}

    departure_min = _parse_hhmm(request.departure_time)
    current_idx = 0
    elapsed = 0.0
    remaining = list(range(1, len(request.stops) + 1))
    order: list[int] = []
    leg_scores: dict[int, float] = {}

    while remaining:
        candidates: list[tuple[float, int]] = []
        for idx in remaining:
            stop = request.stops[idx - 1]
            travel_min = durations[current_idx][idx]
            arrival_elapsed = elapsed + travel_min
            weather_risk = weather_by_idx[idx]["risk"]
            parking_risk = parking_by_idx[idx]["risk"]

            lateness = 0.0
            if stop.window_end:
                try:
                    deadline = _parse_hhmm(stop.window_end)
                    lateness = max(0.0, departure_min + arrival_elapsed - deadline)
                except Exception:
                    lateness = 0.0

            cold_exposure = _priority_factor(stop.cold_chain_priority) * max(0.0, arrival_elapsed / 60.0)
            score = (
                request.weights.travel * travel_min
                + request.weights.weather * weather_risk * 18
                + request.weights.parking * parking_risk * 16
                + request.weights.cold_chain * cold_exposure * 8
                + request.weights.lateness * lateness * 2.5
            )
            candidates.append((score, idx))

        score, chosen_idx = min(candidates, key=lambda x: x[0])
        travel_min = durations[current_idx][chosen_idx]
        elapsed += travel_min + request.stops[chosen_idx - 1].service_minutes
        order.append(chosen_idx)
        leg_scores[chosen_idx] = score
        current_idx = chosen_idx
        remaining.remove(chosen_idx)

    legs: list[RouteLeg] = []
    elapsed = 0.0
    total_distance = 0.0
    total_travel = 0.0
    total_service = 0
    total_lateness = 0.0
    current_idx = 0
    cumulative_score = 0.0

    for sequence, idx in enumerate(order, start=1):
        stop = request.stops[idx - 1]
        travel_min = durations[current_idx][idx]
        distance_km = distances[current_idx][idx]
        elapsed += travel_min
        eta = _format_minutes(departure_min + elapsed)
        weather = weather_by_idx[idx]
        parking = parking_by_idx[idx]
        lateness = 0.0
        if stop.window_end:
            try:
                lateness = max(0.0, departure_min + elapsed - _parse_hhmm(stop.window_end))
            except Exception:
                pass

        score = leg_scores[idx]
        cumulative_score += score
        total_travel += travel_min
        total_distance += distance_km
        total_service += stop.service_minutes
        total_lateness += lateness
        legs.append(
            RouteLeg(
                sequence=sequence,
                stop_id=stop.id,
                stop_name=stop.name,
                eta=eta,
                travel_minutes=round(travel_min, 1),
                distance_km=round(distance_km, 2),
                service_minutes=stop.service_minutes,
                weather=weather,
                parking=parking,
                cold_chain_priority=stop.cold_chain_priority,
                lateness_minutes=round(lateness, 1),
                incremental_score=round(score, 2),
                rationale=_rationale(stop, weather["risk"], parking["risk"], lateness),
            )
        )
        elapsed += stop.service_minutes
        current_idx = idx

    ordered_coords = [(request.depot.lat, request.depot.lng)] + [
        (request.stops[idx - 1].lat, request.stops[idx - 1].lng) for idx in order
    ]
    geometry, geometry_mode = await osrm_route_geometry(ordered_coords)

    sources = [matrix_mode, geometry_mode]
    sources.extend(leg.weather.source for leg in legs)
    sources.extend(leg.parking.source for leg in legs)
    unique_sources = set(sources)
    data_mode = "live" if unique_sources == {"live"} else "mock" if unique_sources == {"mock"} else "mixed"

    warnings = []
    if data_mode != "live":
        warnings.append("At least one external public endpoint was unavailable, so the backend used its built-in fallback data/model.")

    return RouteResponse(
        generated_at=datetime.utcnow(),
        data_mode=data_mode,
        total_distance_km=round(total_distance, 2),
        total_travel_minutes=round(total_travel, 1),
        total_service_minutes=total_service,
        total_lateness_minutes=round(total_lateness, 1),
        composite_score=round(cumulative_score, 2),
        ordered_stop_ids=[request.stops[idx - 1].id for idx in order],
        legs=legs,
        route_geometry=geometry,
        warnings=warnings,
    )
