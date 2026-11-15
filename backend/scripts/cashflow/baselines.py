"""Baselines and series loading for Model 4.

B1 — seasonal-naive: next week equals the most recent observed week. With 61
     weekly points there is no annual cycle to exploit, so at the weekly level
     "seasonal naive" is a carry-forward forecast. It is a weak reference here.

B2 — due-date schedule: expected collections for week ``w`` equal the sum of
     invoice amounts whose ``due_date`` falls in ``w``, restricted to invoices
     **issued on or before the forecast origin**. Only issuance metadata is
     used (``invoice_date``, ``due_date``, ``invoice_amount``); no payment
     outcome, no future-issued invoice. This is the hard benchmark: unlike a
     statistical model it knows the actual contracted payment calendar.
"""

from __future__ import annotations

import datetime as _dt

import numpy as np
import pandas as pd

from .harness import Forecaster, Series


def _week_start(d: _dt.date) -> _dt.date:
    return d - _dt.timedelta(days=d.weekday())


# ---------------------------------------------------------------------------
# B1 — seasonal-naive / carry-forward
# ---------------------------------------------------------------------------
class SeasonalNaive(Forecaster):
    name = "seasonal_naive"

    def __init__(self) -> None:
        self._last = 0.0

    def fit(self, series: Series, origin: int) -> "SeasonalNaive":
        self._last = float(series.values[origin])
        return self

    def predict(self, steps: int) -> np.ndarray:
        return np.full(steps, self._last, dtype=float)


# ---------------------------------------------------------------------------
# Reference-only — expanding mean
# ---------------------------------------------------------------------------
class ExpandingMean(Forecaster):
    name = "expanding_mean"

    def __init__(self) -> None:
        self._mean = 0.0

    def fit(self, series: Series, origin: int) -> "ExpandingMean":
        self._mean = float(np.mean(series.values[: origin + 1]))
        return self

    def predict(self, steps: int) -> np.ndarray:
        return np.full(steps, self._mean, dtype=float)


# ---------------------------------------------------------------------------
# B2 — due-date schedule (leak-free reconstruction)
# ---------------------------------------------------------------------------
class DueDateSchedule(Forecaster):
    """Expected collections from the contracted payment calendar."""

    name = "due_date_schedule"

    def __init__(self, invoices: pd.DataFrame, currency: str) -> None:
        required = {"invoice_date", "due_date", "invoice_amount", "invoice_currency"}
        missing = required - set(invoices.columns)
        if missing:
            raise ValueError(f"invoice frame missing {sorted(missing)}")
        work = invoices.loc[invoices["invoice_currency"] == currency].copy()
        work["invoice_date"] = pd.to_datetime(work["invoice_date"], errors="coerce")
        work["due_date"] = pd.to_datetime(work["due_date"], errors="coerce")
        work["invoice_amount"] = pd.to_numeric(work["invoice_amount"], errors="coerce")
        work = work.dropna(subset=["invoice_date", "due_date", "invoice_amount"])
        work = work.loc[work["invoice_amount"] > 0]
        work["due_week"] = work["due_date"].dt.date.map(_week_start)
        self._invoices = work.loc[:, ["invoice_date", "due_week", "invoice_amount"]]
        self._schedule: dict[_dt.date, float] = {}

    def fit(self, series: Series, origin: int) -> "DueDateSchedule":
        # The origin is a week END (Sunday); invoices issued during that week are
        # already known. Using the Monday would discard them.
        as_of = pd.Timestamp(series.week_starts[origin] + _dt.timedelta(days=6))
        # Only invoices that already existed at the origin may contribute.
        known = self._invoices.loc[self._invoices["invoice_date"] <= as_of]
        grouped = known.groupby("due_week")["invoice_amount"].sum()
        self._schedule = {k: float(v) for k, v in grouped.items()}
        return self

    def expected(self, week: _dt.date) -> float:
        """Expected collections for a due week, using the last fitted cut-off."""
        return float(self._schedule.get(week, 0.0))


class DueDateForecaster(Forecaster):
    """Concrete due-date candidate bound to one series and invoice frame."""

    name = "due_date_schedule"

    def __init__(self, invoices: pd.DataFrame, currency: str) -> None:
        self._model = DueDateSchedule(invoices, currency)
        self._series: Series | None = None
        self._origin = 0

    def fit(self, series: Series, origin: int) -> "DueDateForecaster":
        self._model.fit(series, origin)
        self._series = series
        self._origin = origin
        return self

    def predict(self, steps: int) -> np.ndarray:
        assert self._series is not None
        out = []
        for k in range(1, steps + 1):
            ws = self._series.week_starts[self._origin + k]
            out.append(self._model.expected(ws))
        return np.asarray(out, dtype=float)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------
def load_weekly(path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["week_start"] = pd.to_datetime(df["week_start"]).dt.date
    return df


def load_daily(path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def build_series(currency: str, weekly: pd.DataFrame, daily: pd.DataFrame) -> Series:
    """Assemble a complete weekly ``Series`` for one currency."""
    w = weekly.loc[weekly["currency"] == currency].sort_values("week_start")
    if w.empty:
        raise ValueError(f"no weekly rows for {currency}")
    d = daily.loc[daily["currency"] == currency].sort_values("date")
    daily_indexed = d.set_index("date")[["collections"]]

    # Weekday shares over the full complete-week window; per-origin shares are
    # recomputed inside the harness via ``shares_upto`` to avoid leakage.
    complete = d.loc[d["is_complete"]]
    total = float(complete["collections"].sum())
    by_dow = (
        complete.assign(dow=[x.weekday() for x in complete["date"]])
        .groupby("dow")["collections"]
        .sum()
    )
    shares = {
        i: (float(by_dow.get(i, 0.0)) / total if total > 0 else 1 / 7) for i in range(7)
    }

    return Series(
        currency=currency,
        week_starts=list(w["week_start"]),
        values=w["collections"].to_numpy(dtype=float),
        daily=daily_indexed,
        shares=shares,
    )


__all__ = [
    "SeasonalNaive",
    "ExpandingMean",
    "DueDateForecaster",
    "build_series",
    "load_weekly",
    "load_daily",
]
