"""Tests for the Experiment D MLP candidates."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from scripts.cashflow.harness import Series
from scripts.cashflow.models_mlp import PretrainedMLP, RealOnlyMLP


def _series(values, start=dt.date(2019, 1, 7), currency="USD") -> Series:
    n = len(values)
    starts = [start + dt.timedelta(days=7 * i) for i in range(n)]
    days = [s + dt.timedelta(days=k) for s in starts for k in range(7)]
    daily = pd.DataFrame(
        {"collections": np.repeat(np.asarray(values, dtype=float) / 7, 7)}, index=days
    )
    return Series(
        currency=currency,
        week_starts=starts,
        values=np.asarray(values, dtype=float),
        daily=daily,
        shares={i: 1 / 7 for i in range(7)},
    )


def _synthetic(n=60, seed=7) -> Series:
    rng = np.random.default_rng(seed)
    values = 1000 + 100 * np.sin(np.arange(n) / 4) + rng.normal(0, 40, n)
    return _series(values, start=dt.date(2021, 1, 4), currency="USD")


@pytest.fixture(scope="module")
def real_series():
    rng = np.random.default_rng(3)
    values = 5000 + 200 * np.sin(np.arange(40) / 5) + rng.normal(0, 120, 40)
    return _series(values)


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------
def test_predict_returns_requested_steps(real_series):
    model = RealOnlyMLP(seed=13).fit(real_series, 25)
    preds = model.predict(6)
    assert preds.shape == (6,)
    assert np.all(np.isfinite(preds))
    assert np.all(preds >= 0)


def test_deterministic_for_a_fixed_seed(real_series):
    a = RealOnlyMLP(seed=42).fit(real_series, 30).predict(5)
    b = RealOnlyMLP(seed=42).fit(real_series, 30).predict(5)
    np.testing.assert_allclose(a, b, rtol=0, atol=0)


def test_seed_changes_the_fit(real_series):
    a = RealOnlyMLP(seed=13).fit(real_series, 30).predict(5)
    b = RealOnlyMLP(seed=101).fit(real_series, 30).predict(5)
    assert not np.allclose(a, b)


# ---------------------------------------------------------------------------
# Leakage
# ---------------------------------------------------------------------------
def test_future_values_cannot_change_the_forecast(real_series):
    origin = 28
    base = RealOnlyMLP(seed=13).fit(real_series, origin).predict(4)

    mutated = list(real_series.values[: origin + 1]) + [9e9] * (len(real_series) - origin - 1)
    tampered = _series(mutated)
    other = RealOnlyMLP(seed=13).fit(tampered, origin).predict(4)

    np.testing.assert_allclose(base, other, rtol=0, atol=0)


def test_insufficient_history_falls_back_to_trailing_mean(real_series):
    model = RealOnlyMLP(seed=13).fit(real_series, 2)
    assert model.fallback is True
    preds = model.predict(3)
    assert preds.shape == (3,)
    assert np.allclose(preds, np.mean(real_series.values[:3]))


# ---------------------------------------------------------------------------
# Pretraining
# ---------------------------------------------------------------------------
def test_pretrained_differs_from_real_only(real_series):
    synth = _synthetic()
    d0 = RealOnlyMLP(seed=42).fit(real_series, 30).predict(5)
    d1 = PretrainedMLP(synth, seed=42).fit(real_series, 30).predict(5)
    assert d1.shape == (5,)
    assert np.all(np.isfinite(d1))
    assert not np.allclose(d0, d1), "pretraining had no effect at all"


def test_pretraining_is_cached_across_origins(real_series):
    synth = _synthetic()
    model = PretrainedMLP(synth, seed=7)
    model.fit(real_series, 28)
    first = model._pretrained_model
    model.fit(real_series, 32)
    assert model._pretrained_model is first, "synthetic pretraining was repeated"


def test_pretrained_rejects_a_too_short_synthetic_series(real_series):
    tiny = _synthetic(n=4)
    with pytest.raises(ValueError):
        PretrainedMLP(tiny, seed=7).fit(real_series, 30)


def test_forecast_is_bounded_and_does_not_explode(real_series):
    """Regression guard for the recursive divergence seen in the pilot."""
    from scripts.cashflow.models_mlp import MAX_RATIO

    model = RealOnlyMLP(seed=13).fit(real_series, 30)
    preds = model.predict(9)
    base = float(np.mean(real_series.values[:31]))
    assert preds.max() <= MAX_RATIO * base * 1.0001
    assert preds.min() >= 0
    # Steps must not compound: the last step cannot dwarf the first by orders.
    assert preds.max() / max(preds.min(), 1e-9) < 100


def test_pretrained_forecast_is_also_bounded(real_series):
    from scripts.cashflow.models_mlp import MAX_RATIO

    synth = _synthetic()
    model = PretrainedMLP(synth, seed=42).fit(real_series, 30)
    preds = model.predict(9)
    base = float(np.mean(real_series.values[:31]))
    assert np.all(np.isfinite(preds))
    assert preds.max() <= MAX_RATIO * base * 1.0001
