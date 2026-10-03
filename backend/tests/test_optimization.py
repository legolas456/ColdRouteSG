from app.services.public_apis import weather_risk_from_text
from app.services.geo import haversine_km


def test_weather_risk_ordering():
    assert weather_risk_from_text("Thundery Showers") > weather_risk_from_text("Cloudy")
    assert weather_risk_from_text("Cloudy") >= weather_risk_from_text("Fair")


def test_haversine_zero():
    assert haversine_km(1.3, 103.8, 1.3, 103.8) == 0


def test_haversine_positive():
    assert haversine_km(1.3, 103.8, 1.31, 103.81) > 0
