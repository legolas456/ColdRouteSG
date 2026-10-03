from math import atan2, cos, radians, sin, sqrt
from functools import lru_cache
from pyproj import Transformer


@lru_cache(maxsize=1)
def svy21_to_wgs84_transformer() -> Transformer:
    return Transformer.from_crs("EPSG:3414", "EPSG:4326", always_xy=True)


def svy21_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lng, lat = svy21_to_wgs84_transformer().transform(x, y)
    return lat, lng


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_km = 6371.0088
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return 2 * earth_radius_km * atan2(sqrt(a), sqrt(1 - a))
