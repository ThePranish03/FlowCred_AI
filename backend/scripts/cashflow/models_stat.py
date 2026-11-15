"""Statistical forecasters for Model 4: ETS (damped trend) and ARIMA.

Justification
-------------
* Only 61 weekly observations per currency — too few to estimate annual
  seasonality reliably, and the domain (accounts-receivable collections) shows
  no consistent yearly cycle. We therefore omit seasonal terms entirely.
* Damped-trend ETS is preferred over plain Holt because collections tend to
  revert toward a long-run mean; the damping parameter prevents the trend from
  extrapolating indefinitely.
* Parameter search is deliberately tiny (~12 ETS combos, ≤9 ARIMA fits per
  origin) because we evaluate 26 validation origins × 2 currencies × 13 steps.
  A full grid would be orders of magnitude slower with negligible gain on this
  data scale.
* All fits respect the leakage boundary: at origin ``o`` only
  ``series.values[:o+1]`` is visible.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .harness import Series, Forecaster


def _ensure_statsmodels() -> None:
    """Raise a clear error if statsmodels is not available."""
    try:
        import statsmodels  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "statsmodels is required for ETS/ARIMA candidates"
        ) from e


# -----------------------------------------------------------------------------
# ETS — Damped trend exponential smoothing
# -----------------------------------------------------------------------------
class ETSForecaster:
    """Damped-trend exponential smoothing on weekly totals."""

    name = "ets"

    def __init__(self) -> None:
        self._fitted_model = None
        self._params: tuple[float, float, float] | None = None
        _ensure_statsmodels()

    # Small deterministic candidate grid: (alpha, beta, phi)
    # alpha=smoothing_level, beta=smoothing_trend, phi=damping_trend
    _CANDIDATES = [
        (0.1, 0.01, 0.90),
        (0.1, 0.05, 0.90),
        (0.1, 0.10, 0.90),
        (0.2, 0.01, 0.90),
        (0.2, 0.05, 0.90),
        (0.2, 0.10, 0.90),
        (0.3, 0.01, 0.95),
        (0.3, 0.05, 0.95),
        (0.3, 0.10, 0.95),
        (0.5, 0.01, 0.98),
        (0.5, 0.05, 0.98),
        (0.7, 0.01, 0.98),
    ]

    def fit(self, series: Series, origin: int) -> "ETSForecaster":
        """Fit damped-trend ETS on values[:origin+1]."""
        # LEAKAGE BOUNDARY: only use history up to and including origin
        y = series.values[: origin + 1]

        # Guard: too few points to fit a trend model reliably
        if len(y) < 5:
            self._fitted_model = None
            self._params = None
            self._fallback_mean = float(np.mean(y)) if len(y) > 0 else 0.0
            return self

        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        best_sse = np.inf
        best_model = None
        best_params = None

        for alpha, beta, phi in self._CANDIDATES:
            try:
                model = ExponentialSmoothing(
                    y,
                    trend="add",
                    damped_trend=True,
                    seasonal=None,
                    initialization_method="estimated",
                ).fit(
                    smoothing_level=alpha,
                    smoothing_trend=beta,
                    damping_trend=phi,
                    optimized=False,
                )
                # In-sample one-step SSE
                sse = float(np.sum((model.fittedvalues - y) ** 2))
                if sse < best_sse:
                    best_sse = sse
                    best_model = model
                    best_params = (alpha, beta, phi)
            except Exception:
                # Skip failed fits (e.g., numerical issues)
                continue

        self._fitted_model = best_model
        self._params = best_params
        return self

    def predict(self, steps: int) -> np.ndarray:
        """Return out-of-sample forecast for the next ``steps`` weeks."""
        if self._fitted_model is None:
            return np.full(steps, getattr(self, "_fallback_mean", 0.0), dtype=float)
        preds = np.asarray(self._fitted_model.forecast(steps), dtype=float)
        # Collections cannot be negative; damped trend can dip below zero.
        preds = np.clip(preds, 0.0, None)
        return preds


# -----------------------------------------------------------------------------
# ARIMA — Weekly ARIMA with stationarity detection
# -----------------------------------------------------------------------------
class ARIMAForecaster:
    """Weekly ARIMA with ADF-based differencing order selection."""

    name = "arima"

    def __init__(self) -> None:
        self._fitted_model = None
        self.fallback = False
        self.clipped = False
        _ensure_statsmodels()

    def fit(self, series: Series, origin: int) -> "ARIMAForecaster":
        """Fit ARIMA on values[:origin+1] with ADF-chosen d."""
        # LEAKAGE BOUNDARY: only use history up to and including origin
        y = series.values[: origin + 1]

        # Reset flags
        self.fallback = False
        self.clipped = False

        if len(y) < 5:
            # Too little data — will fall back in predict
            self._fitted_model = None
            self._last_value = float(y[-1]) if len(y) > 0 else 0.0
            return self

        from statsmodels.tsa.arima.model import ARIMA
        from statsmodels.tsa.stattools import adfuller

        # Determine d via ADF on levels
        try:
            adf_stat, adf_p, *_ = adfuller(y, autolag="AIC")
        except Exception:
            adf_p = 1.0

        d = 0 if adf_p < 0.05 else 1

        # Small (p,q) grid: 5 candidates max. With only 61 weekly observations a
        # wider search fits noise and costs minutes per origin.
        candidates = [(1, 0), (0, 1), (1, 1), (2, 0), (0, 2)]

        best_aic = np.inf
        best_model = None

        for p, q in candidates:
            try:
                model = ARIMA(y, order=(p, d, q)).fit()
                if model.aic < best_aic:
                    best_aic = model.aic
                    best_model = model
            except Exception:
                continue

        if best_model is None:
            # All fits failed — fallback to naive last-value
            self.fallback = True
            self._fitted_model = None
            self._last_value = float(y[-1])
        else:
            self._fitted_model = best_model

        return self

    def predict(self, steps: int) -> np.ndarray:
        """Return forecast, clipping negatives to 0.0."""
        if self._fitted_model is None:
            self.fallback = True
            preds = np.full(steps, getattr(self, "_last_value", 0.0), dtype=float)
        else:
            preds = np.asarray(self._fitted_model.forecast(steps), dtype=float)

        # Collections cannot be negative
        if np.any(preds < 0):
            self.clipped = True
            preds = np.clip(preds, 0.0, None)

        return preds


# -----------------------------------------------------------------------------
# Stationarity report for the full series (used in documentation/reporting)
# -----------------------------------------------------------------------------
def stationarity_report(series: Series) -> dict:
    """ADF and KPSS statistics for levels and first differences (full series).

    This is for reporting only — not used during model fitting to avoid leakage.
    """
    _ensure_statsmodels()
    from statsmodels.tsa.stattools import adfuller, kpss

    y = series.values

    def _test(x: np.ndarray) -> dict:
        adf_s, adf_p, *_ = adfuller(x, autolag="AIC")
        kpss_s, kpss_p, *_ = kpss(x, regression="c", nlags="auto")
        return {
            "adf_stat": float(adf_s),
            "adf_pvalue": float(adf_p),
            "kpss_stat": float(kpss_s),
            "kpss_pvalue": float(kpss_p),
        }

    return {
        "levels": _test(y),
        "first_diff": _test(np.diff(y)),
    }


# -----------------------------------------------------------------------------
# Candidate factory
# -----------------------------------------------------------------------------
def build_candidates(series: Series) -> list[Forecaster]:
    """Return the two statistical candidates for evaluation."""
    return [ETSForecaster(), ARIMAForecaster()]


__all__ = [
    "ETSForecaster",
    "ARIMAForecaster",
    "stationarity_report",
    "build_candidates",
]