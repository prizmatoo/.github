def pallets_needed(qty: int, per_pallet: int) -> int:
    """Whole pallets needed for `qty` units, `per_pallet` to a pallet."""
    if per_pallet < 1:
        raise ValueError("per_pallet must be at least 1")
    if qty < 0:
        raise ValueError("qty cannot be negative")
    return -(-qty // per_pallet)
