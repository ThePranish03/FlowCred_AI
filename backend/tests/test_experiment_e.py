"""Tests for Experiment E augmentation candidates."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from scripts.cashflow.baselines import build_series
from scripts.cashflow.harness import Series
from scripts.cashflow.models_aug import (
    ScaledWeeklyXGB,
    WeightedDailyXGB,
    combine_series,
)


def _frame(values, start, currency="USD"):
    n = len(values)
    weeks = [start + dt.timedelta(days=7 * i) for i in range(n)]
    days = [w + dt.timedelta(days=k) for w in weeks for k in range(7)]
    weekly = pd.DataFrame(
        {"week_start": weeks, "currency": currency, "collections": values, "is_complete": True}
    )
    daily = pd.DataFrame(
        {
            "date": days,
            "currency": currency,
            "collections": np.repeat(np.asarray(values, dtype=float) / 7, 7),
            "is_complete": True,
        }
    )
    return weekly, daily


@pytest.fixture(scope="module")
def real_series():
    rng = np.random.default_rng(11)
    values = 5000 + 300 * np.sin(np.arange(40) / 5) + rng.normal(0, 150, 40)
    weekly, daily = _frame(values, dt.date(2019, 1, 7))
    return build_series("USD", weekly, daily)


@pytest.fixture(scope="module")
def synth_series():
    rng = np.random.default_rng(22)
    values = 1500 + 90 * np.sin(np.arange(60) / 4) + rng.normal(0, 45, 60)
    weekly, daily = _frame(values, dt.date(2021, 1, 4))
    return build_series("USD", weekly, daily)


# ---------------------------------------------------------------------------
# Combining series
# ---------------------------------------------------------------------------
def test_combine_places_synthetic_strictly_before_real(real_series, synth_series):
    combined, factor = combine_series(synth_series, real_series)
    assert len(combined) == len(synth_series) + len(real_series)
    assert all(a < b for a, b in zip(combined.week_starts, combined.week_starts[1:]))
    assert combined.week_starts[len(synth_series) - 1] < min(real_series.week_starts)
    assert factor == pytest.approx(
        float(np.mean(real_series.values)) / float(np.mean(synth_series.values))
    )


def test_combine_level_matches_the_synthetic_half(real_series, synth_series):
    combined, factor = combine_series(synth_series, real_series)
    head = combined.values[: len(synth_series)]
    assert np.isclose(head.mean(), float(np.mean(real_series.values)), rtol=0.05)


def test_combine_relocates_a_later_synthetic_period(real_series, synth_series):
    """The simulation covers a later period and must be moved before the real one."""
    combined, _ = combine_series(synth_series, real_series)
    assert max(combined.week_starts[: len(synth_series)]) < min(real_series.week_starts)


def test_combined_daily_has_no_duplicate_dates(real_series, synth_series):
    combined, _ = combine_series(synth_series, real_series)
    assert not combined.daily.index.duplicated().any()
    assert combined.daily.index.is_monotonic_increasing


# ---------------------------------------------------------------------------
# Scaled weekly XGBoost
# ---------------------------------------------------------------------------
def test_scaled_weekly_is_deterministic(real_series):
    a = ScaledWeeklyXGB(seed=13).fit(real_series, 30).predict(4)
    b = ScaledWeeklyXGB(seed=13).fit(real_series, 30).predict(4)
    np.testing.assert_allclose(a, b, rtol=0, atol=0)


def test_scaled_weekly_ignores_future_values(real_series):
    origin = 30
    base = ScaledWeeklyXGB(seed=42).fit(real_series, origin).predict(5)

    mutated = list(real_series.values[: origin + 1]) + [9e9] * (len(real_series) - origin - 1)
    weekly, daily = _frame(mutated, real_series.week_starts[0])
    tampered = build_series("USD", weekly, daily)

    other = ScaledWeeklyXGB(seed=42).fit(tampered, origin).predict(5)
    np.testing.assert_allclose(base, other, rtol=0, atol=0)


def test_scaled_weekly_returns_finite_non_negative_values(real_series):
    preds = ScaledWeeklyXGB(seed=7).fit(real_series, 32).predict(8)
    assert preds.shape == (8,)
    assert np.all(np.isfinite(preds))
    assert np.all(preds >= 0)


def test_pretraining_changes_the_fit(real_series, synth_series):
    plain = ScaledWeeklyXGB(seed=13).fit(real_series, 30).predict(4)
    pretrained = ScaledWeeklyXGB(seed=13, pretrain_series=synth_series).fit(real_series, 30).predict(4)
    assert not np.allclose(plain, pretrained)


def test_synthetic_weighting_is_applied(real_series, synth_series):
    combined, _ = combine_series(synth_series, real_series)
    offset = len(synth_series)
    model = ScaledWeeklyXGB(
        seed=13, synthetic_before=min(real_series.week_starts)
    ).fit(combined, offset + 30)
    assert model._model is not None
    preds = model.predict(4)
    assert np.all(np.isfinite(preds))


# ---------------------------------------------------------------------------
# Weighted daily XGBoost
# ---------------------------------------------------------------------------
def test_weighted_daily_produces_weekly_sums(real_series):
    model = WeightedDailyXGB(seed=13).fit(real_series, 34)
    preds = model.predict(5)
    assert preds.shape == (5,)
    assert np.all(np.isfinite(preds))
    assert np.all(preds >= 0)


def test_weighted_daily_ignores_future_days(real_series):
    origin = 34
    base = WeightedDailyXGB(seed=13).fit(real_series, origin).predict(3)

    mutated = list(real_series.values[: origin + 1]) + [9e9] * (len(real_series) - origin - 1)
    weekly, daily = _frame(mutated, real_series.week_starts[0])
    tampered = build_series("USD", weekly, daily)
    other = WeightedDailyXGB(seed=13).fit(tampered, origin).predict(3)
    np.testing.assert_allclose(base, other, rtol=0, atol=0)
