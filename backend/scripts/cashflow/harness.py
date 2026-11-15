"""Shared chronological evaluation harness for Model 4.

Everything that scores a forecast goes through this module so that baselines,
XGBoost, ETS and ARIMA are judged on identical folds, identical metrics and
identical aggregation rules.

Rules enforced here
-------------------
* Chronological only. No shuffling, no random split, expanding origin window.
* Originating from a forecast origin ``o`` means the model may only see
  ``y[0..o]``. Anything after ``o`` is future information.
* Metrics are MAE, RMSE and WAPE. MAPE is never used (zero-collection weeks and
  three orders of magnitude in the daily denominator make it meaningless).
* Horizon totals (7/30/90 days) are formed by allocating weekly predictions to
  days with *training-window* weekday shares and summing the first ``h`` days.
"""

from __future__ import annotations

import datetime as _dt
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

HORIZONS: tuple[int, ...] = (7, 30, 90)

# ---------------------------------------------------------------------------
# Fold contract
# ---------------------------------------------------------------------------
# Weekly observations are indexed 0..60 (61 fully bounded weeks).
#   validation origins 22..47  -> model selection + interval calibration
#   holdout origins    48..59  -> untouched final check (1..12 steps available)
#   production origin  60      -> shipped forecast, no observed future
FIRST_VALIDATION_ORIGIN = 22
LAST_VALIDATION_ORIGIN = 47
FIRST_HOLDOUT_ORIGIN = 48
LAST_HOLDOUT_ORIGIN = 59
PRODUCTION_ORIGIN = 60

# Selection rule, declared before any candidate was evaluated.
SELECTION_RULE = {
    "rule": "candidate must improve on the best valid baseline by >= 10% relative WAPE "
            "on >= 4 validation origins",
    "relative_wape_improvement_threshold": 0.10,
    "minimum_origins_beating_threshold": 4,
    "fallback": "best valid baseline ships if no candidate qualifies",
}


def weeks_to_cover(horizon_days: int) -> int:
    """Number of weekly blocks a horizon touches.

    The horizon starts on the Monday after ``asOf`` (``asOf`` is a week end), so
    7 days = 1 week, 30 days = 5 weeks (4 full + 2 days), 90 days = 13 weeks.
    """
    return math.ceil(horizon_days / 7)


def horizon_dates(as_of: _dt.date, horizon_days: int) -> list[_dt.date]:
    """Calendar days covered by a horizon that starts the day after ``as_of``."""
    start = as_of + _dt.timedelta(days=1)
    return [start + _dt.timedelta(days=i) for i in range(horizon_days)]


def allocate_daily(
    weekly_pred: dict[_dt.date, float],
    shares: dict[int, float],
    dates: list[_dt.date],
) -> list[float]:
    """Allocate weekly totals to individual days using weekday shares.

    A day's estimate is ``week_total * share[weekday]``. Because every touched
    week contributes its full total, and each day of that week is included at
    most once, ``sum(allocated over full weeks) == sum(weekly totals)``. For a
    partial week only the covered weekdays are emitted, so the horizon total is
    the sum of the covered days' shares times the week total — never a uniform
    ``/7`` and never re-normalised in a way that would break the identity.
    """
    out: list[float] = []
    for d in dates:
        ws = d - _dt.timedelta(days=d.weekday())
        total = float(weekly_pred.get(ws, 0.0))
        out.append(total * float(shares.get(d.weekday(), 0.0)))
    return out


def horizon_total(
    weekly_pred: dict[_dt.date, float],
    shares: dict[int, float],
    as_of: _dt.date,
    horizon_days: int,
) -> float:
    days = horizon_dates(as_of, horizon_days)
    return float(sum(allocate_daily(weekly_pred, shares, days)))


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
@dataclass
class Metrics:
    n: int
    mae: float
    rmse: float
    wape: float
    bias: float

    def as_dict(self) -> dict[str, float | int]:
        return {
            "n": self.n,
            "mae": round(self.mae, 2),
            "rmse": round(self.rmse, 2),
            "wape": round(self.wape, 6),
            "bias": round(self.bias, 2),
        }


def metrics(actual: np.ndarray, predicted: np.ndarray) -> Metrics:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    if a.shape != p.shape:
        raise ValueError(f"shape mismatch: actual {a.shape} vs predicted {p.shape}")
    err = a - p
    denom = float(np.abs(a).sum())
    return Metrics(
        n=int(a.size),
        mae=float(np.abs(err).mean()) if a.size else float("nan"),
        rmse=float(np.sqrt((err**2).mean())) if a.size else float("nan"),
        wape=float(np.abs(err).sum() / denom) if denom > 0 else float("nan"),
        bias=float(err.mean()) if a.size else float("nan"),
    )


# ---------------------------------------------------------------------------
# Series container
# ---------------------------------------------------------------------------
@dataclass
class Series:
    """Weekly series for one currency plus its supporting daily frame."""

    currency: str
    week_starts: list[_dt.date]
    values: np.ndarray
    daily: pd.DataFrame  # index: date, column: collections
    shares: dict[int, float]

    def __post_init__(self) -> None:
        if len(self.week_starts) != len(self.values):
            raise ValueError("week_starts and values length mismatch")

    def __len__(self) -> int:
        return len(self.values)

    def actual_week(self, idx: int) -> float:
        return float(self.values[idx])

    def actual_horizon(self, as_of_idx: int, horizon_days: int) -> float:
        # ``as_of`` is the *week end* (Sunday): week_starts[] is the Monday.
        as_of = self.week_starts[as_of_idx] + _dt.timedelta(days=6)
        days = horizon_dates(as_of, horizon_days)
        return float(sum(self.daily.reindex(days)["collections"].fillna(0.0)))

    def shares_upto(self, idx: int) -> dict[int, float]:
        """Weekday shares computed only from weeks 0..idx (leak-free)."""
        cutoff = self.week_starts[idx] + _dt.timedelta(days=6)
        sub = self.daily.loc[self.daily.index <= cutoff, "collections"]
        total = float(sub.sum())
        if total <= 0:
            return {i: 1 / 7 for i in range(7)}
        by_dow = sub.groupby(sub.index.map(lambda d: d.weekday())).sum()
        return {i: float(by_dow.get(i, 0.0)) / total for i in range(7)}


# ---------------------------------------------------------------------------
# Candidate protocol
# ---------------------------------------------------------------------------
class Forecaster:
    """Interface every candidate implements.

    ``fit`` sees only ``y[:origin+1]``. ``predict`` must return one value per
    step in ``1..steps`` (weekly blocks).
    """

    name: str = "abstract"

    def fit(self, series: Series, origin: int) -> "Forecaster":  # pragma: no cover
        raise NotImplementedError

    def predict(self, steps: int) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError


@dataclass
class FoldResult:
    origin: int
    as_of: _dt.date
    currency: str
    candidate: str
    step_actual: list[float] = field(default_factory=list)
    step_predicted: list[float] = field(default_factory=list)
    horizon_actual: dict[int, float] = field(default_factory=dict)
    horizon_predicted: dict[int, float] = field(default_factory=dict)


def run_folds(
    series: Series,
    candidate: Forecaster,
    origins: list[int],
    max_steps: int,
) -> list[FoldResult]:
    """Evaluate ``candidate`` at every origin, returning per-origin results."""
    results: list[FoldResult] = []
    n = len(series)
    for o in origins:
        if o >= n - 1:
            continue
        steps = min(max_steps, n - 1 - o)
        if steps <= 0:
            continue
        model = candidate.fit(series, o)
        preds = np.asarray(model.predict(steps), dtype=float)
        if preds.shape != (steps,):
            raise ValueError(
                f"{candidate.name}: expected {steps} predictions, got {preds.shape}"
            )
        if not np.all(np.isfinite(preds)):
            raise ValueError(f"{candidate.name}: non-finite prediction at origin {o}")

        res = FoldResult(
            origin=o,
            # ``as_of`` follows the API convention: the origin is a week END
            # (Sunday), never the Monday. Horizons start the following day.
            as_of=series.week_starts[o] + _dt.timedelta(days=6),
            currency=series.currency,
            candidate=candidate.name,
        )
        for k in range(steps):
            res.step_actual.append(series.actual_week(o + k + 1))
            res.step_predicted.append(float(preds[k]))

        shares = series.shares_upto(o)
        as_of_end = series.week_starts[o] + _dt.timedelta(days=6)
        for h in HORIZONS:
            if h > steps * 7:
                continue
            weekly_pred = {
                series.week_starts[o + k + 1]: float(preds[k]) for k in range(steps)
            }
            res.horizon_predicted[h] = horizon_total(
                weekly_pred, shares, as_of_end, h
            )
            res.horizon_actual[h] = series.actual_horizon(o, h)
        results.append(res)
    return results


def summarise(results: list[FoldResult]) -> dict[str, object]:
    """Aggregate fold results into step-level and horizon-level metrics."""
    if not results:
        return {"folds": 0}

    step_actual = np.array([v for r in results for v in r.step_actual], dtype=float)
    step_pred = np.array([v for r in results for v in r.step_predicted], dtype=float)

    out: dict[str, object] = {
        "folds": len(results),
        "first_as_of": str(results[0].as_of),
        "last_as_of": str(results[-1].as_of),
        "weekly": metrics(step_actual, step_pred).as_dict(),
    }
    for h in HORIZONS:
        a = [r.horizon_actual[h] for r in results if h in r.horizon_actual]
        p = [r.horizon_predicted[h] for r in results if h in r.horizon_predicted]
        out[f"h{h}"] = metrics(np.array(a), np.array(p)).as_dict() if a else {"n": 0}
    return out


def step_residuals(results: list[FoldResult], steps: int) -> dict[int, list[float]]:
    """Residuals grouped by forecast step (1-indexed), for interval calibration."""
    buckets: dict[int, list[float]] = {k: [] for k in range(1, steps + 1)}
    for r in results:
        for k, (a, p) in enumerate(zip(r.step_actual, r.step_predicted), start=1):
            if k in buckets:
                buckets[k].append(a - p)
    return buckets


__all__ = [
    "HORIZONS",
    "SELECTION_RULE",
    "FIRST_VALIDATION_ORIGIN",
    "LAST_VALIDATION_ORIGIN",
    "FIRST_HOLDOUT_ORIGIN",
    "LAST_HOLDOUT_ORIGIN",
    "PRODUCTION_ORIGIN",
    "Series",
    "Forecaster",
    "FoldResult",
    "Metrics",
    "metrics",
    "run_folds",
    "summarise",
    "step_residuals",
    "weeks_to_cover",
    "horizon_dates",
    "horizon_total",
    "allocate_daily",
]
