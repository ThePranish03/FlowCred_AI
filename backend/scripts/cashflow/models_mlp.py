"""MLP forecaster for Experiment D: synthetic pretraining + real adaptation.

Everything is modelled in **scale-free units**: the target and every lag/rolling
feature are divided by the mean of the fit window, so a network trained on the
synthetic portfolio (USD ≈ 5.07M/week) can be adapted to the real series
(USD ≈ 17.41M/week) without the output layer having to relearn a 3.4x offset.

The forecast is **direct multi-horizon**, not recursive: every step is predicted
from the origin's fixed history plus the step index. A pilot run using a
recursive scheme diverged (predicted ratios compounded 0.58 → 2.96 → 8.10 →
30.4 → 121.7 against a flat actual), so feedback was removed. Direct prediction
also pools `steps` rows per training origin, which removes the data starvation
the recursive design had at early origins.

Two arms:

``RealOnlyMLP``   trained on the origin's real history only (ablation).
``PretrainedMLP`` pretrained once on the synthetic series, then adapted with
                  ``warm_start`` on the origin's real history only.
"""

from __future__ import annotations

import copy
import datetime as _dt

import numpy as np

from .harness import Forecaster, Series

HIDDEN_LAYERS = (64, 32)
ALPHA = 1e-3
PRETRAIN_LR = 1e-3
ADAPT_LR = 3e-4
PRETRAIN_MAX_ITER = 400
ADAPT_MAX_ITER = 200
EARLY_STOPPING_PATIENCE = 10
EARLY_STOPPING_FRACTION = 0.2
MIN_HISTORY = 12          # rows needed before the longest rolling window exists
MIN_ROWS_TO_FIT = 8
EARLY_STOPPING_MIN_ROWS = 20
MAX_STEPS = 13            # 91 days covers the 90-day horizon
# Bounded output: weekly collections above 3x the trailing mean are not a
# plausible forecast for this process. Applied identically to both arms.
MAX_RATIO = 3.0


def _sin_cos(day: _dt.date) -> tuple[float, float]:
    week = day.isocalendar()[1]
    angle = 2 * np.pi * week / 52.0
    return float(np.sin(angle)), float(np.cos(angle))


def _features(
    history: np.ndarray, idx: int, base: float, day: _dt.date, step: int
) -> list[float]:
    """Scale-free features for the week ``step`` ahead of index ``idx``."""
    window = history[: idx + 1]
    lag = [float(window[-k] / base) for k in range(1, 5)]
    roll4 = float(np.mean(window[-4:]) / base)
    roll8 = float(np.mean(window[-8:]) / base)
    roll12 = float(np.mean(window[-12:]) / base)
    std4 = float(np.std(window[-4:]) / base)
    std12 = float(np.std(window[-12:]) / base)
    sin_w, cos_w = _sin_cos(day)
    return [*lag, roll4, roll8, roll12, std4, std12, sin_w, cos_w, step / MAX_STEPS]


N_FEATURES = 12


def _training_rows(
    values: np.ndarray, week_starts: list[_dt.date], origin: int
) -> tuple[np.ndarray, np.ndarray, float]:
    """Stacked (features at i, step s) -> value[i+s] rows available at origin."""
    base = float(np.mean(values[: origin + 1]))
    if base <= 0 or origin < MIN_HISTORY:
        return np.empty((0, N_FEATURES)), np.empty(0), base

    rows, targets = [], []
    for i in range(MIN_HISTORY - 1, origin):
        span = min(MAX_STEPS, origin - i)
        for step in range(1, span + 1):
            day = week_starts[i] + _dt.timedelta(days=7 * step)
            rows.append(_features(values, i, base, day, step))
            targets.append(float(values[i + step] / base))
    return np.asarray(rows, dtype=float), np.asarray(targets, dtype=float), base


class _MLPBase(Forecaster):
    name = "mlp"

    def __init__(self, seed: int = 42) -> None:
        self.seed = seed
        self._model = None
        self._scaler = None
        self._history: np.ndarray | None = None
        self._week_starts: list[_dt.date] = []
        self._origin = 0
        self._base = 1.0
        self.fallback = False

    def _new_model(self, learning_rate: float, max_iter: int, early_stopping: bool):
        from sklearn.neural_network import MLPRegressor

        return MLPRegressor(
            hidden_layer_sizes=HIDDEN_LAYERS,
            activation="relu",
            solver="adam",
            alpha=ALPHA,
            learning_rate_init=learning_rate,
            max_iter=max_iter,
            early_stopping=early_stopping,
            validation_fraction=EARLY_STOPPING_FRACTION,
            n_iter_no_change=EARLY_STOPPING_PATIENCE,
            batch_size=16,
            random_state=self.seed,
            warm_start=False,
        )

    def _predict_steps(self, steps: int) -> np.ndarray:
        if self._model is None or self._history is None:
            return np.full(steps, float(self._base), dtype=float)

        rows = []
        for step in range(1, steps + 1):
            day = self._week_starts[self._origin] + _dt.timedelta(days=7 * step)
            rows.append(_features(self._history, self._origin, self._base, day, step))
        scaled = self._scaler.transform(np.asarray(rows, dtype=float))
        ratios = np.asarray(self._model.predict(scaled), dtype=float)
        ratios = np.clip(ratios, 0.0, MAX_RATIO)
        return ratios * self._base


class RealOnlyMLP(_MLPBase):
    """Ablation: no synthetic exposure at all."""

    name = "mlp_real"

    def fit(self, series: Series, origin: int) -> "RealOnlyMLP":
        from sklearn.preprocessing import StandardScaler

        self._week_starts = list(series.week_starts)
        self._origin = origin
        self._history = np.asarray(series.values[: origin + 1], dtype=float)
        self._base = float(np.mean(self._history))

        rows, targets, _ = _training_rows(
            np.asarray(series.values, dtype=float), self._week_starts, origin
        )
        if len(rows) < MIN_ROWS_TO_FIT:
            self.fallback = True
            self._model = None
            return self

        early = len(rows) >= EARLY_STOPPING_MIN_ROWS
        self._scaler = StandardScaler().fit(rows)
        self._model = self._new_model(ADAPT_LR, ADAPT_MAX_ITER, early)
        self._model.fit(self._scaler.transform(rows), targets)
        return self

    def predict(self, steps: int) -> np.ndarray:
        return self._predict_steps(steps)


class PretrainedMLP(_MLPBase):
    """Pretrained on synthetic weeks, then adapted to real history at an origin."""

    name = "mlp_pretrained"

    def __init__(self, synthetic_series: Series, seed: int = 42) -> None:
        super().__init__(seed=seed)
        self._synthetic = synthetic_series
        self._pretrained_model = None
        self._pretrained_scaler = None
        self._pretrain_rows = 0

    def _ensure_pretrained(self) -> None:
        if self._pretrained_model is not None:
            return
        from sklearn.preprocessing import StandardScaler

        synth = self._synthetic
        values = np.asarray(synth.values, dtype=float)
        rows, targets, _ = _training_rows(values, list(synth.week_starts), len(values) - 1)
        if len(rows) < MIN_ROWS_TO_FIT:
            raise ValueError("synthetic series too short to pretrain on")

        scaler = StandardScaler().fit(rows)
        model = self._new_model(PRETRAIN_LR, PRETRAIN_MAX_ITER, True)
        model.fit(scaler.transform(rows), targets)
        self._pretrained_model = model
        self._pretrained_scaler = scaler
        self._pretrain_rows = len(rows)

    def fit(self, series: Series, origin: int) -> "PretrainedMLP":
        self._ensure_pretrained()
        self._week_starts = list(series.week_starts)
        self._origin = origin
        self._history = np.asarray(series.values[: origin + 1], dtype=float)
        self._base = float(np.mean(self._history))

        rows, targets, _ = _training_rows(
            np.asarray(series.values, dtype=float), self._week_starts, origin
        )
        if len(rows) < MIN_ROWS_TO_FIT:
            self.fallback = True
            self._model = None
            return self

        # Adaptation keeps the pretrained input space and weights; only the
        # final epochs see real data.
        model = copy.deepcopy(self._pretrained_model)
        model.set_params(
            warm_start=True,
            learning_rate_init=ADAPT_LR,
            max_iter=ADAPT_MAX_ITER,
            early_stopping=len(rows) >= EARLY_STOPPING_MIN_ROWS,
        )
        model.fit(self._pretrained_scaler.transform(rows), targets)
        self._model = model
        self._scaler = self._pretrained_scaler
        return self

    def predict(self, steps: int) -> np.ndarray:
        return self._predict_steps(steps)


def build_arms(synthetic_series: Series | None, seed: int) -> list[Forecaster]:
    arms: list[Forecaster] = [RealOnlyMLP(seed=seed)]
    if synthetic_series is not None:
        arms.append(PretrainedMLP(synthetic_series, seed=seed))
    return arms


__all__ = [
    "HIDDEN_LAYERS",
    "ALPHA",
    "MAX_RATIO",
    "N_FEATURES",
    "RealOnlyMLP",
    "PretrainedMLP",
    "build_arms",
]
