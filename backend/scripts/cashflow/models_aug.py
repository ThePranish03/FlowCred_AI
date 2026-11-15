"""Experiment E candidates: synthetic augmentation for XGBoost.

Three mechanisms are provided, all behind the existing ``Forecaster`` interface
so the shared harness owns folds, metrics and leakage rules:

``ScaledWeeklyXGB``
    Weekly direct multi-horizon regressor with **scale-free** features (amounts
    divided by the fit-window mean). Optionally pretrained on a synthetic series
    and continued on real rows with ``xgb_model``, and/or trained on a combined
    series with per-source sample weights.

``WeightedDailyXGB``
    The daily-recursive model with sample weights, used for the combined
    (level-matched) series.

``combine_series``
    Places a synthetic series immediately before a real one, optionally level
    matching it. Chronology is asserted: synthetic weeks never follow real ones.

Scale-free features are what make cross-domain transfer testable at all: the
real and synthetic portfolios differ by 3.4x (USD) and 4.7x (CAD).
"""

from __future__ import annotations

import datetime as _dt

import numpy as np
import pandas as pd

from .harness import Forecaster, Series
from .models_xgb import DAILY_PARAMS, WEEKLY_PARAMS, DueLookup

MAX_WEEKS_AHEAD = 13
SYNTHETIC_WEIGHT = 0.25


def _week_end(day: _dt.date) -> _dt.date:
    return day + _dt.timedelta(days=6)


def _scaled_weekly_row(
    values: np.ndarray,
    week_starts: list[_dt.date],
    origin: int,
    step: int,
    lookup: DueLookup | None,
    base: float,
) -> list[float]:
    """One wedge of the feature matrix, expressed as ratios to ``base``."""
    hist = values[: origin + 1]
    n = len(hist)
    cutoff = _week_end(week_starts[origin])
    # Derived from the origin rather than indexed into week_starts, so a horizon
    # longer than the observed series cannot raise IndexError.
    target_week = week_starts[origin] + _dt.timedelta(days=7 * step)

    lag = lambda k: float(hist[-k] / base) if n >= k else 1.0
    roll = lambda w: float(np.mean(hist[-w:]) / base)
    std = lambda w: float(np.std(hist[-w:]) / base) if n >= 2 else 0.0

    due = lookup.week_amount(target_week, cutoff) / base if lookup is not None else 0.0

    return [
        lag(1), lag(2), lag(3), lag(4),
        roll(4), roll(8), roll(12),
        std(4), std(12),
        float(step),
        float(target_week.month),
        float(target_week.isocalendar()[1]),
        due,
        float(n) / 52.0,
    ]


def _weekly_training_rows(
    values: np.ndarray,
    week_starts: list[_dt.date],
    origin: int,
    lookup: DueLookup | None,
    base: float,
    first: int = 4,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rows, targets and target-week dates available at ``origin``."""
    rows, targets, dates = [], [], []
    for i in range(first, origin):
        span = min(MAX_WEEKS_AHEAD, origin - i)
        for step in range(1, span + 1):
            rows.append(_scaled_weekly_row(values, week_starts, i, step, lookup, base))
            targets.append(float(values[i + step] / base))
            dates.append(week_starts[i + step])
    return (
        np.asarray(rows, dtype=float),
        np.asarray(targets, dtype=float),
        np.asarray(dates, dtype=object),
    )


class ScaledWeeklyXGB(Forecaster):
    """Weekly direct multi-horizon XGBoost with optional synthetic augmentation."""

    name = "xgboost_weekly_scaled"

    def __init__(
        self,
        seed: int = 42,
        invoices=None,
        currency: str | None = None,
        pretrain_series: Series | None = None,
        synthetic_before: _dt.date | None = None,
        synthetic_weight: float = SYNTHETIC_WEIGHT,
    ) -> None:
        self.seed = seed
        self._lookup = (
            DueLookup(invoices, currency) if invoices is not None and currency else None
        )
        self._pretrain_series = pretrain_series
        self._synthetic_before = synthetic_before
        self._synthetic_weight = synthetic_weight
        self._series: Series | None = None
        self._origin = 0
        self._base = 1.0
        self._model = None
        self.fallback = False

    def _params(self) -> dict:
        params = dict(WEEKLY_PARAMS)
        params["random_state"] = self.seed
        return params

    def _weights(self, target_dates: np.ndarray) -> np.ndarray | None:
        if self._synthetic_before is None:
            return None
        synthetic = np.array(
            [d < self._synthetic_before for d in target_dates], dtype=float
        )
        return np.where(synthetic > 0, self._synthetic_weight, 1.0)

    def fit(self, series: Series, origin: int) -> "ScaledWeeklyXGB":
        from xgboost import XGBRegressor

        self._series = series
        self._origin = origin
        values = np.asarray(series.values, dtype=float)
        self._base = float(np.mean(values[: origin + 1])) or 1.0

        rows, targets, dates = _weekly_training_rows(
            values, list(series.week_starts), origin, self._lookup, self._base
        )
        if len(rows) < 12:
            self.fallback = True
            self._model = None
            return self

        model = XGBRegressor(**self._params())

        if self._pretrain_series is not None:
            synth = self._pretrain_series
            synth_values = np.asarray(synth.values, dtype=float)
            synth_base = float(np.mean(synth_values)) or 1.0
            s_rows, s_targets, _ = _weekly_training_rows(
                synth_values, list(synth.week_starts), len(synth_values) - 1,
                self._lookup, synth_base,
            )
            if len(s_rows) >= 12:
                model.fit(s_rows, s_targets)

        weights = self._weights(dates)
        if self._pretrain_series is not None:
            model.fit(
                rows, targets,
                sample_weight=weights,
                xgb_model=model.get_booster(),
            )
        else:
            model.fit(rows, targets, sample_weight=weights)
        self._model = model
        return self

    def predict(self, steps: int) -> np.ndarray:
        assert self._series is not None
        if self._model is None:
            return np.full(steps, float(self._series.values[self._origin]))

        values = np.asarray(self._series.values, dtype=float)
        rows = [
            _scaled_weekly_row(
                values, list(self._series.week_starts),
                self._origin, step, self._lookup, self._base,
            )
            for step in range(1, steps + 1)
        ]
        ratios = np.asarray(self._model.predict(np.asarray(rows, dtype=float)), dtype=float)
        return np.clip(ratios, 0.0, None) * self._base


class WeightedDailyXGB(Forecaster):
    """Daily-recursive XGBoost with per-source sample weights."""

    name = "xgboost_daily_weighted"

    def __init__(
        self,
        invoices=None,
        currency: str | None = None,
        seed: int = 42,
        synthetic_before: _dt.date | None = None,
        synthetic_weight: float = SYNTHETIC_WEIGHT,
    ) -> None:
        self.seed = seed
        self._lookup = (
            DueLookup(invoices, currency) if invoices is not None and currency else None
        )
        self._synthetic_before = synthetic_before
        self._synthetic_weight = synthetic_weight
        self._series: Series | None = None
        self._origin = 0
        self._model = None
        self._history: np.ndarray | None = None
        self._last_day: _dt.date | None = None
        self.fallback = False

    def fit(self, series: Series, origin: int) -> "WeightedDailyXGB":
        from xgboost import XGBRegressor

        self._series = series
        self._origin = origin
        cutoff = _week_end(series.week_starts[origin])
        frame = series.daily.loc[series.daily.index <= cutoff, "collections"]
        values = frame.to_numpy(dtype=float)
        days = list(frame.index)

        rows, targets, weights = [], [], []
        start = 28
        for t in range(start, len(values) - 1):
            rows.append(_daily_row(self._lookup, values[: t + 1], days[t + 1], days[t]))
            targets.append(float(values[t + 1]))
            if self._synthetic_before is not None and days[t + 1] < self._synthetic_before:
                weights.append(self._synthetic_weight)
            else:
                weights.append(1.0)

        self._history = values.copy()
        self._last_day = days[-1]
        if len(rows) < 60:
            self.fallback = True
            self._model = None
            return self

        params = dict(DAILY_PARAMS)
        params["random_state"] = self.seed
        model = XGBRegressor(**params)
        model.fit(
            np.asarray(rows, dtype=float),
            np.asarray(targets, dtype=float),
            sample_weight=np.asarray(weights, dtype=float),
        )
        self._model = model
        return self

    def predict(self, steps: int) -> np.ndarray:
        assert self._series is not None
        assert self._history is not None
        horizon = steps * 7
        if self._model is None:
            return np.full(steps, float(self._history[-7:].mean()))

        hist = self._history.copy()
        day = self._last_day
        out = []
        for _ in range(horizon):
            nxt = day + _dt.timedelta(days=1)
            feat = _daily_row(self._lookup, hist, nxt, day)
            pred = float(self._model.predict(np.asarray([feat], dtype=float))[0])
            pred = max(pred, 0.0)
            out.append(pred)
            hist = np.append(hist, pred)
            day = nxt
        daily = np.asarray(out, dtype=float)
        return np.asarray([daily[k * 7 : (k + 1) * 7].sum() for k in range(steps)], dtype=float)


def _daily_row(lookup: DueLookup | None, history: np.ndarray, day: _dt.date, cutoff: _dt.date) -> list[float]:
    """Same daily feature definition as the production daily model."""
    h = history
    n = len(h)
    lag = lambda k: float(h[-k]) if n >= k else float(h.mean())
    roll = lambda w: float(h[-w:].mean()) if n else 0.0
    due = lookup.amount(day, cutoff) if lookup is not None else 0.0
    return [
        lag(1) / 1e6, lag(2) / 1e6, lag(3) / 1e6, lag(7) / 1e6,
        lag(14) / 1e6, lag(28) / 1e6,
        roll(7) / 1e6, roll(14) / 1e6, roll(28) / 1e6,
        float(day.weekday()), 1.0 if day.weekday() >= 5 else 0.0,
        due / 1e6, due / (roll(28) or 1.0),
        float(day.day), float(day.month),
    ]


def combine_series(synth: Series, real: Series, level_match: bool = True) -> tuple[Series, float]:
    """Place ``synth`` immediately before ``real``, optionally level matched.

    The synthetic daily series is first trimmed to its last complete week so the
    weekly and daily views agree, then shifted so its final day is the day before
    the real series begins. Chronology is asserted.
    """
    real_first_day = min(real.daily.index)
    last_complete = max(synth.week_starts)
    synth_daily = synth.daily.loc[synth.daily.index <= last_complete + _dt.timedelta(days=6)]

    target_last = real_first_day - _dt.timedelta(days=1)
    # delta is normally negative: the simulation covers a later period and is
    # relocated backwards so it reads as a prior. The resulting order is
    # asserted below rather than the sign of the shift.
    delta = (target_last - max(synth_daily.index)).days

    factor = 1.0
    if level_match:
        real_mean = float(np.mean(real.values))
        synth_mean = float(np.mean(synth.values))
        factor = real_mean / synth_mean if synth_mean else 1.0

    shifted_weekly = [d + _dt.timedelta(days=delta) for d in synth.week_starts]
    shifted_daily_index = [d + _dt.timedelta(days=delta) for d in synth_daily.index]

    combined = Series(
        currency=real.currency,
        week_starts=shifted_weekly + list(real.week_starts),
        values=np.concatenate([synth.values * factor, real.values]),
        daily=pd.concat(
            [
                pd.DataFrame(
                    {"collections": synth_daily.to_numpy(dtype=float).ravel() * factor},
                    index=shifted_daily_index,
                ),
                real.daily,
            ]
        ).sort_index(),
        shares=real.shares,
    )
    if not all(a < b for a, b in zip(combined.week_starts, combined.week_starts[1:])):
        raise ValueError("combined week_starts are not strictly increasing")
    if combined.daily.index.duplicated().any():
        raise ValueError("combined daily index has duplicates")
    return combined, factor


__all__ = [
    "ScaledWeeklyXGB",
    "WeightedDailyXGB",
    "combine_series",
    "SYNTHETIC_WEIGHT",
]
