"""Synthetic financial data tooling (generator, targets, validation).

Everything here is simulation. Outputs are written under ``data/raw/synthetic/``
and ``data/processed/synthetic/`` and never replace the real dataset or the
production model artifacts.
"""

from .generator import (
    GENERATOR_VERSION,
    PROFILE_SHARES,
    PROFILES,
    SYNTHETIC_SOURCE,
    GeneratorConfig,
    SyntheticFinancialDataGenerator,
)
from .targets import build_daily_target, build_weekly_target
from .validation import validate_dataset, summarise

__all__ = [
    "GENERATOR_VERSION",
    "PROFILES",
    "PROFILE_SHARES",
    "SYNTHETIC_SOURCE",
    "GeneratorConfig",
    "SyntheticFinancialDataGenerator",
    "build_daily_target",
    "build_weekly_target",
    "validate_dataset",
    "summarise",
]
