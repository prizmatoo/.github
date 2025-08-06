import pytest

from sample import pallets_needed


def test_a_part_pallet_counts_as_one() -> None:
    assert pallets_needed(41, 40) == 2


def test_nothing_to_ship_needs_no_pallet() -> None:
    assert pallets_needed(0, 40) == 0


def test_refuses_a_pallet_of_nothing() -> None:
    with pytest.raises(ValueError, match="per_pallet"):
        pallets_needed(10, 0)
