from __future__ import annotations

import re

from .models import Instrument


def normalize_symbol_input(value: str) -> tuple[str, str | None]:
    raw = value.strip().upper()
    suffix = None
    match = re.fullmatch(r"(.+?)\.(SH|SS|SZ|XSHE|XSHG)", raw)
    if match:
        raw = match.group(1)
        suffix = "XSHE" if match.group(2) in {"SZ", "XSHE"} else "XSHG"
    return raw, suffix


def validate_instrument(value: dict) -> Instrument:
    return Instrument.model_validate(value)
