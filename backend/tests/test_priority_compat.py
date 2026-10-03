from app.models import DeliveryStop


def _stop(priority):
    return DeliveryStop(
        id="test",
        name="Test Stop",
        lat=1.30,
        lng=103.80,
        service_minutes=10,
        cold_chain_priority=priority,
    )


def test_current_priority_values_are_preserved():
    assert _stop(1).cold_chain_priority == 1
    assert _stop(2).cold_chain_priority == 2
    assert _stop(3).cold_chain_priority == 3


def test_legacy_fractional_priority_values_are_normalised():
    assert _stop(0.95).cold_chain_priority == 1
    assert _stop(0.80).cold_chain_priority == 1
    assert _stop(0.55).cold_chain_priority == 2
    assert _stop(0.20).cold_chain_priority == 3
