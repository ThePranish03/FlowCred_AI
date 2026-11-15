"""XGBoost candidates for Model 4.

Two variants are implemented and evaluated on identical folds:

C1a ``xgboost_weekly``
    Direct multi-horizon regressor on **weekly totals**. One model is trained
    on stacked rows ``(features at origin i, step k) -> y[i + k]``, so a single
    fit covers every horizon and ``k`` is itself a feature. At prediction time
    the model is asked for ``k = 1..steps`` at the evaluation origin.

C1b ``xgboost_daily``
    Recursive **daily** model. Daily collection levels are modelled with lag and
    calendar features, rolled forward one day at a time for ``7 * steps`` days,
    then aggregated into weekly totals for comparison with the weekly models.

Leakage rules enforced here
---------------------------
* Training rows for origin ``i`` use only ``values[: i + 1]`` and due-date
  information known at the end of week ``i``.
* The due-date feature is looked up through :class:`DueLookup`, which sums only
  invoices with ``invoice_date <= cut-off``. No payment outcome and no
  future-issued invoice is ever visible.
* Because 61 weekly observations is very little data, regularisation is
  deliberately conservative and no hyper-parameter search is performed.
"""

from __future__ import annotations

import bisect
import datetime as _dt
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .harness import Forecaster, Series


def _freeze_model(model: object) -> object:
    """Replace a fitted XGBoost regressor with portable UBJSON bytes.

    A pickled Booster embeds its ``std::mt19937`` state as platform-specific
    text (decimal under libstdc++, hex under MSVC), so an artifact written on
    Linux fails to unpickle on Windows with ``input stream corrupted`` and vice
    versa (dmlc/xgboost#12459). The public model format carries no RNG state
    and deserializes identically on every build.
    """
    if model is None or not hasattr(model, "get_booster"):
        return model
    return {
        "__portable_xgb__": True,
        "raw": bytes(model.get_booster().save_raw(raw_format="ubj")),
        "params": model.get_params(),
    }


def _thaw_model(payload: object) -> object:
    if not (isinstance(payload, dict) and payload.get("__portable_xgb__")):
        return payload
    from xgboost import Booster, XGBRegressor

    booster = Booster()
    booster.load_model(bytearray(payload["raw"]))
    model = XGBRegressor(**payload["params"])
    model._Booster = booster
    return model


# Conservative, fixed hyper-parameters. No tuning: with <=61 weekly rows a
# search would fit the validation folds rather than the process.
WEEKLY_PARAMS = dict(
    n_estimators=300,
    max_depth=2,
    learning_rate=0.03,
    subsample=0.9,
    colsample_bytree=0.8,
    reg_lambda=2.0,
    min_child_weight=5.0,
    objective="reg:squarederror",
    tree_method="hist",
    random_state=42,
    n_jobs=2,
)

DAILY_PARAMS = dict(
    n_estimators=300,
    max_depth=3,
    learning_rate=0.03,
    subsample=0.9,
    colsample_bytree=0.8,
    reg_lambda=2.0,
    min_child_weight=5.0,
    objective="reg:squarederror",
    tree_method="hist",
    random_state=42,
    n_jobs=2,
)

MAX_WEEKS_AHEAD = 13  # 91 days covers the 90-day horizon


class DueLookup:
    """Due-date amounts as known at a given cut-off date.

    For each due date we keep invoices sorted by ``invoice_date`` with a
    cumulative amount, so ``amount(due_date, cutoff)`` is the total amount due
    on that date from invoices already issued at ``cutoff``. This makes the
    leak-free constraint explicit and cheap.
    """

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
        work["due_day"] = work["due_date"].dt.date

        self._dates: dict[_dt.date, list[_dt.date]] = {}
        self._cum: dict[_dt.date, list[float]] = {}
        for due_day, grp in work.sort_values("invoice_date").groupby("due_day"):
            issue = [d.date() for d in grp["invoice_date"]]
            amounts = np.cumsum(grp["invoice_amount"].to_numpy(dtype=float))
            self._dates[due_day] = issue
            self._cum[due_day] = amounts.tolist()

    def amount(self, due_day: _dt.date, cutoff: _dt.date) -> float:
        issue = self._dates.get(due_day)
        if not issue:
            return 0.0
        pos = bisect.bisect_right(issue, cutoff)
        if pos == 0:
            return 0.0
        return float(self._cum[due_day][pos - 1])

    def week_amount(self, week_start: _dt.date, cutoff: _dt.date) -> float:
        return float(
            sum(
                self.amount(week_start + _dt.timedelta(days=i), cutoff)
                for i in range(7)
            )
        )


def _week_end(week_start: _dt.date) -> _dt.date:
    return week_start + _dt.timedelta(days=6)


def _weekly_features(
    values: np.ndarray,
    week_starts: list[_dt.date],
    origin: int,
    step: int,
    lookup: DueLookup | None,
) -> list[float]:
    """Features for predicting ``week_starts[origin + step]`` at ``origin``.

    Only ``values[: origin + 1]`` is read.
    """
    hist = values[: origin + 1]
    n = len(hist)
    cutoff = _week_end(week_starts[origin])
    target_week = week_starts[origin + step]

    lag = lambda k: float(hist[-k]) if n >= k else float(hist.mean())
    roll = lambda w: float(hist[-w:].mean()) if n >= 1 else 0.0
    std = lambda w: float(hist[-w:].std(ddof=0)) if n >= 2 else 0.0

    mean4 = roll(4) or 1.0
    due = lookup.week_amount(target_week, cutoff) if lookup is not None else 0.0

    return [
        lag(1) / 1e6,
        lag(2) / 1e6,
        lag(3) / 1e6,
        lag(4) / 1e6,
        roll(4) / 1e6,
        roll(8) / 1e6,
        roll(12) / 1e6,
        std(4) / 1e6,
        std(12) / 1e6,
        float(step),
        float(target_week.month),
        float(target_week.isocalendar()[1]),
        due / 1e6,
        due / mean4 if mean4 else 0.0,
        float(n) / 52.0,
    ]


class WeeklyDirectXGB(Forecaster):
    name = "xgboost_weekly"

    def __init__(self, invoices: pd.DataFrame | None = None, currency: str | None = None):
        self._lookup = (
            DueLookup(invoices, currency)
            if invoices is not None and currency is not None
            else None
        )
        self._series: Series | None = None
        self._origin = 0
        self._model = None
        self.fallback = False

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_model"] = _freeze_model(state.get("_model"))
        return state

    def __setstate__(self, state: dict) -> None:
        state = dict(state)
        state["_model"] = _thaw_model(state.get("_model"))
        self.__dict__.update(state)

    def fit(self, series: Series, origin: int) -> "WeeklyDirectXGB":
        from xgboost import XGBRegressor

        self._series = series
        self._origin = origin
        values = series.values
        rows, targets = [], []
        # First training origin needs enough history for the longest lag.
        first = 4
        for i in range(first, origin):
            for k in range(1, min(MAX_WEEKS_AHEAD, origin - i) + 1):
                rows.append(
                    _weekly_features(values, series.week_starts, i, k, self._lookup)
                )
                targets.append(float(values[i + k]))
        if len(rows) < 12:
            # Not enough history at this origin; predict() falls back to the last
            # observed week. Recorded so a silent fallback is visible in logs.
            self.fallback = True
            self._model = None
            return self

        model = XGBRegressor(**WEEKLY_PARAMS)
        model.fit(np.asarray(rows, dtype=float), np.asarray(targets, dtype=float))
        self._model = model
        return self

    def predict(self, steps: int) -> np.ndarray:
        assert self._series is not None
        if self._model is None:
            # Not enough history: fall back to the last observed week.
            return np.full(steps, float(self._series.values[self._origin]))
        rows = [
            _weekly_features(
                self._series.values, self._series.week_starts, self._origin, k, self._lookup
            )
            for k in range(1, steps + 1)
        ]
        preds = self._model.predict(np.asarray(rows, dtype=float))
        return np.clip(np.asarray(preds, dtype=float), 0.0, None)


class DailyRecursiveXGB(Forecaster):
    name = "xgboost_daily"

    def __init__(self, invoices: pd.DataFrame | None = None, currency: str | None = None):
        self._lookup = (
            DueLookup(invoices, currency)
            if invoices is not None and currency is not None
            else None
        )
        self._series: Series | None = None
        self._origin = 0
        self._model = None
        self._history: np.ndarray | None = None
        self._last_day: _dt.date | None = None
        self.fallback = False

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_model"] = _freeze_model(state.get("_model"))
        return state

    def __setstate__(self, state: dict) -> None:
        state = dict(state)
        state["_model"] = _thaw_model(state.get("_model"))
        self.__dict__.update(state)

    # -- feature construction ------------------------------------------------
    def _features(
        self, history: np.ndarray, day: _dt.date, cutoff: _dt.date
    ) -> list[float]:
        h = history
        n = len(h)
        lag = lambda k: float(h[-k]) if n >= k else float(h.mean())
        roll = lambda w: float(h[-w:].mean()) if n else 0.0
        due = self._lookup.amount(day, cutoff) if self._lookup is not None else 0.0
        return [
            lag(1) / 1e6,
            lag(2) / 1e6,
            lag(3) / 1e6,
            lag(7) / 1e6,
            lag(14) / 1e6,
            lag(28) / 1e6,
            roll(7) / 1e6,
            roll(14) / 1e6,
            roll(28) / 1e6,
            float(day.weekday()),
            1.0 if day.weekday() >= 5 else 0.0,
            due / 1e6,
            due / (roll(28) or 1.0),
            float(day.day),
            float(day.month),
        ]

    def _daily_arrays(self, series: Series, origin: int) -> tuple[np.ndarray, list[_dt.date]]:
        cutoff = _week_end(series.week_starts[origin])
        frame = series.daily.loc[series.daily.index <= cutoff, "collections"]
        days = list(frame.index)
        return frame.to_numpy(dtype=float), days

    def fit(self, series: Series, origin: int) -> "DailyRecursiveXGB":
        from xgboost import XGBRegressor

        self._series = series
        self._origin = origin
        values, days = self._daily_arrays(series, origin)
        rows, targets = [], []
        start = 28
        for t in range(start, len(values) - 1):
            rows.append(self._features(values[: t + 1], days[t + 1], days[t]))
            targets.append(float(values[t + 1]))

        self._history = values.copy()
        self._last_day = days[-1]
        if len(rows) < 60:
            self.fallback = True
            self._model = None
            return self

        model = XGBRegressor(**DAILY_PARAMS)
        model.fit(np.asarray(rows, dtype=float), np.asarray(targets, dtype=float))
        self._model = model
        return self

    def predict(self, steps: int) -> np.ndarray:
        assert self._series is not None
        assert self._history is not None
        horizon_days = steps * 7
        if self._model is None:
            daily = np.full(horizon_days, float(self._history[-7:].mean()))
        else:
            hist = self._history.copy()
            day = self._last_day
            out = []
            for _ in range(horizon_days):
                nxt = day + _dt.timedelta(days=1)
                feat = self._features(hist, nxt, day)
                pred = float(self._model.predict(np.asarray([feat], dtype=float))[0])
                pred = max(pred, 0.0)
                out.append(pred)
                hist = np.append(hist, pred)
                day = nxt
            daily = np.asarray(out, dtype=float)

        # Aggregate the daily path into the weekly blocks the harness scores.
        weekly = [
            float(daily[k * 7 : (k + 1) * 7].sum()) for k in range(steps)
        ]
        return np.asarray(weekly, dtype=float)


def build_candidates(
    invoices: pd.DataFrame | None = None, currency: str | None = None
) -> list[Forecaster]:
    return [WeeklyDirectXGB(invoices, currency), DailyRecursiveXGB(invoices, currency)]


__all__ = [
    "DueLookup",
    "WeeklyDirectXGB",
    "DailyRecursiveXGB",
    "build_candidates",
    "WEEKLY_PARAMS",
    "DAILY_PARAMS",
]
