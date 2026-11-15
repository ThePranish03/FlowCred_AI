"""Model 4 — aggregate cash-flow forecasting (serving side).

Design
------
*Weekly is the modelled frequency. Daily values are derived estimates* obtained
by allocating a weekly total across weekdays with historically estimated
weekday shares. Daily numbers are never independently trained forecasts and are
always labelled ``isEstimate: true``.

Forecasting readiness is **independent** of the three-model health gate. This
module has its own loader (:func:`load_forecast_models`) and its own status map
(``FORECAST_STATUS``); a missing or broken cash-flow artifact must never turn
``/api/v1/health`` into a 503.

The shipped artifact is self-contained: fitted object, history, weekday shares
and a frozen ``replay`` grid of forecasts for every historical origin. Serving
therefore never retrains and never reads the raw dataset.
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import threading
from pathlib import Path

import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "models"

ARTIFACT_PATHS: dict[str, Path] = {
    "USD": MODEL_DIR / "cash_flow_forecaster_usd.joblib",
    "CAD": MODEL_DIR / "cash_flow_forecaster_cad.joblib",
}
METADATA_PATH = MODEL_DIR / "cash_flow_model_metadata.json"

HORIZONS: tuple[int, ...] = (7, 30, 90)
CURRENCIES: tuple[str, ...] = ("USD", "CAD")
MAX_HORIZON_DAYS = 91

PROXY_DISCLAIMER = (
    "Target is an invoice-clearance proxy: collections are approximated by "
    "invoice amounts dated at payment_date. The dataset has no payment ledger and no "
    "amount-received column, so partially settled invoices may over- or under-state "
    "cash actually received. These figures are not bank-verified cash inflow."
)

# Populated once at application start-up by ``load_forecast_models``.
FORECAST_STATUS: dict[str, dict[str, object]] = {}
_FORECAST_MODELS: dict[str, dict[str, object]] = {}
_FORECAST_METADATA: dict[str, object] = {}
_LOAD_LOCK = threading.Lock()


class ForecastUnavailable(RuntimeError):
    """Raised when no usable production artifact exists for a currency."""


class ForecastError(ValueError):
    """Raised for invalid request parameters (unknown asOf, bad horizon)."""


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def load_forecast_models() -> dict[str, dict[str, object]]:
    """Load production forecast artifacts.

    Never raises: every failure is captured in ``FORECAST_STATUS`` so that the
    core product (and its health endpoint) keeps working.
    """
    global _FORECAST_METADATA
    with _LOAD_LOCK:
        try:
            import joblib
        except Exception as exc:  # pragma: no cover - joblib is a hard dep of training
            for currency in CURRENCIES:
                FORECAST_STATUS[currency] = {
                    "available": False,
                    "error": f"joblib unavailable: {exc}",
                }
            return {}

        for currency in CURRENCIES:
            path = ARTIFACT_PATHS[currency]
            if not path.exists():
                FORECAST_STATUS[currency] = {
                    "available": False,
                    "error": f"missing artifact {path.name}",
                }
                continue
            try:
                artifact = joblib.load(path)
                _validate_artifact(artifact, currency)
                _FORECAST_MODELS[currency] = artifact
                FORECAST_STATUS[currency] = {
                    "available": True,
                    "algorithm": artifact.get("algorithm"),
                    "version": artifact.get("version"),
                    "as_of": artifact.get("trained_through"),
                    "trained_through": artifact.get("trained_through"),
                    "frequency": artifact.get("frequency"),
                }
            except Exception as exc:
                FORECAST_STATUS[currency] = {
                    "available": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }

        try:
            if METADATA_PATH.exists():
                _FORECAST_METADATA = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        except Exception:
            _FORECAST_METADATA = {}

        return dict(_FORECAST_MODELS)


def _validate_artifact(artifact: object, currency: str) -> None:
    if not isinstance(artifact, dict):
        raise ValueError("artifact must be a dict")
    required = {
        "algorithm",
        "currency",
        "trained_through",
        "history_week_starts",
        "history_values",
        "weekday_shares",
        "replay",
    }
    missing = required - set(artifact)
    if missing:
        raise ValueError(f"artifact missing keys: {sorted(missing)}")
    if artifact["currency"] != currency:
        raise ValueError(
            f"artifact currency {artifact['currency']} does not match {currency}"
        )
    if len(artifact["history_week_starts"]) != len(artifact["history_values"]):
        raise ValueError("history length mismatch")


def forecast_status() -> dict[str, object]:
    """Forecast-only readiness, reported separately from the three-model gate."""
    models = [
        {
            "currency": currency,
            **{
                k: v
                for k, v in FORECAST_STATUS.get(
                    currency, {"available": False, "error": "not loaded"}
                ).items()
            },
        }
        for currency in CURRENCIES
    ]
    available = all(m.get("available") for m in models)
    return {
        "status": "available" if available else "unavailable",
        "models": models,
        "metadata_loaded": bool(_FORECAST_METADATA),
    }


def get_metadata() -> dict[str, object]:
    return dict(_FORECAST_METADATA)


# ---------------------------------------------------------------------------
# Core forecast maths
# ---------------------------------------------------------------------------
def _parse_date(value: str | _dt.date) -> _dt.date:
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    return _dt.date.fromisoformat(str(value))


def week_start(day: _dt.date) -> _dt.date:
    return day - _dt.timedelta(days=day.weekday())


def _shares(artifact: dict[str, object]) -> dict[int, float]:
    raw = artifact["weekday_shares"]
    assert isinstance(raw, dict)
    return {int(k): float(v) for k, v in raw.items()}


def forecast_weekly(
    currency: str, horizon_days: int = 30, as_of: str | _dt.date | None = None
) -> dict[str, object]:
    """Return the weekly forecast path that covers ``horizon_days``.

    The forecast is served from the artifact's frozen ``replay`` grid, so the
    same ``asOf`` always reproduces the same numbers and nothing is fitted at
    request time.
    """
    if currency not in CURRENCIES:
        raise ForecastError(f"unsupported currency: {currency}")
    if horizon_days not in HORIZONS:
        raise ForecastError(f"unsupported horizon: {horizon_days}")

    artifact = _FORECAST_MODELS.get(currency)
    if artifact is None:
        status = FORECAST_STATUS.get(currency, {})
        raise ForecastUnavailable(
            f"cash-flow model unavailable for {currency}: {status.get('error', 'not loaded')}"
        )

    trained_through = _parse_date(str(artifact["trained_through"]))
    as_of_date = _parse_date(as_of) if as_of is not None else trained_through

    replay = artifact["replay"]
    assert isinstance(replay, dict)
    key = str(as_of_date)
    if key not in replay:
        supported = sorted(replay)
        raise ForecastError(
            f"no stored forecast for asOf={key}; supported asOf values are "
            f"{supported[0]}..{supported[-1]} (week ends)"
        )

    values = replay[key]
    weeks_needed = math.ceil(horizon_days / 7)
    if len(values) < weeks_needed:
        raise ForecastUnavailable(
            f"artifact stores {len(values)} weeks, horizon needs {weeks_needed}"
        )

    # Weekday shares as known at this origin (no future information in replay).
    replay_shares = artifact.get("replay_shares") or {}
    shares_raw = replay_shares.get(key) if isinstance(replay_shares, dict) else None
    if not isinstance(shares_raw, dict):
        shares_raw = artifact["weekday_shares"]
    origin_shares = {int(k): float(v) for k, v in shares_raw.items()}

    week_starts = [
        week_start(as_of_date + _dt.timedelta(days=1)) + _dt.timedelta(days=7 * k)
        for k in range(weeks_needed)
    ]
    quantiles = artifact.get("interval_quantiles") or {}
    assert isinstance(quantiles, dict)

    weekly: list[dict[str, object]] = []
    for k, ws in enumerate(week_starts):
        predicted = float(values[k])
        q = quantiles.get(str(k + 1), {})
        p10 = float(q.get("p10", 0.0)) if isinstance(q, dict) else 0.0
        p90 = float(q.get("p90", 0.0)) if isinstance(q, dict) else 0.0
        lower = max(0.0, predicted + p10)
        # Guard against a residual distribution whose 90th percentile is negative:
        # bounds must never invert around the point forecast.
        upper = max(predicted, predicted + p90, lower)
        weekly.append(
            {
                "weekStart": str(ws),
                "weekEnd": str(ws + _dt.timedelta(days=6)),
                "predicted": round(predicted, 2),
                "lower": round(lower, 2),
                "upper": round(upper, 2),
                "isPartial": True,  # trimmed by allocate_daily for partial weeks
            }
        )

    return {
        "currency": currency,
        "asOf": str(as_of_date),
        "trainedThrough": str(trained_through),
        "horizonDays": horizon_days,
        "weeks": weekly,
        "shares": origin_shares,
        "rawWeeklyValues": [float(v) for v in values[:weeks_needed]],
    }


def allocate_daily(
    currency: str,
    weekly: list[dict[str, object]],
    as_of: _dt.date,
    horizon_days: int,
    shares: dict[int, float] | None = None,
) -> list[dict[str, object]]:
    """Allocate weekly totals (and their bounds) to daily estimates.

    Each day receives ``week_total * share[weekday]``. Shares are normalised to
    sum to 1 so that a fully covered week contributes exactly its total; without
    that guard a rounded or partial share table would silently lose (or invent)
    amount. Bounds are allocated the same way, so ``sum(daily)`` equals the
    horizon totals and ``lower <= predicted <= upper`` holds per day.
    """
    if shares is None:
        artifact = _FORECAST_MODELS.get(currency, {})
        shares = _shares(artifact) if artifact else {i: 1 / 7 for i in range(7)}

    total_share = sum(shares.values())
    if total_share <= 0:
        shares = {i: 1 / 7 for i in range(7)}
    elif abs(total_share - 1.0) > 1e-9:
        shares = {k: v / total_share for k, v in shares.items()}

    first = week_start(as_of + _dt.timedelta(days=1))
    by_week = {
        first + _dt.timedelta(days=7 * k): row for k, row in enumerate(weekly)
    }

    out: list[dict[str, object]] = []
    for offset in range(horizon_days):
        day = as_of + _dt.timedelta(days=1 + offset)
        ws = week_start(day)
        row = by_week.get(ws)
        share = float(shares.get(day.weekday(), 0.0))
        mid = float(row["predicted"]) * share if row else 0.0
        low = float(row["lower"]) * share if row else 0.0
        high = float(row["upper"]) * share if row else 0.0
        out.append(
            {
                "date": str(day),
                "estimated": round(mid, 2),
                "lower": round(low, 2),
                "upper": round(high, 2),
                "weekStart": str(ws),
                "isEstimate": True,
            }
        )
    return out


def horizon_totals(daily: list[dict[str, object]]) -> dict[str, float]:
    """Aggregate a derived daily path into horizon totals.

    Summing the daily path (rather than the weekly rows) is what makes
    ``SUM(daily) == horizonTotal`` true even when the horizon starts or ends
    mid-week.
    """
    predicted = round(sum(float(d["estimated"]) for d in daily), 2)
    lower = round(sum(float(d["lower"]) for d in daily), 2)
    upper = round(sum(float(d["upper"]) for d in daily), 2)
    return {
        "predicted": predicted,
        "lower": min(lower, predicted),
        "upper": max(upper, predicted),
    }


def historical_weeks(currency: str, limit: int = 26) -> list[dict[str, object]]:
    artifact = _FORECAST_MODELS.get(currency)
    if artifact is None:
        return []
    starts = list(artifact["history_week_starts"])[-limit:]
    values = list(artifact["history_values"])[-limit:]
    return [
        {
            "weekStart": str(s),
            "weekEnd": str(_dt.date.fromisoformat(str(s)) + _dt.timedelta(days=6)),
            "actual": round(float(v), 2),
        }
        for s, v in zip(starts, values)
    ]


def build_forecast_payload(
    currency: str, horizon_days: int = 30, as_of: str | _dt.date | None = None
) -> dict[str, object]:
    """Assemble the complete API response for ``GET /cash-flow/forecast``."""
    core = forecast_weekly(currency, horizon_days, as_of)
    as_of_date = _parse_date(str(core["asOf"]))
    artifact = _FORECAST_MODELS[currency]

    daily = allocate_daily(
        currency,
        list(core["weeks"]),
        as_of_date,
        horizon_days,
        shares=core["shares"],  # type: ignore[arg-type]
    )
    totals = horizon_totals(daily)

    # Horizon-level intervals are better calibrated than summing per-week bands:
    # they are empirical residual quantiles of the *aggregated* horizon, measured
    # on validation folds for this exact horizon.
    horizon_intervals = artifact.get("horizon_intervals") or {}
    band = horizon_intervals.get(str(horizon_days)) if isinstance(horizon_intervals, dict) else None
    if isinstance(band, dict):
        point = totals["predicted"]
        totals["lower"] = round(max(0.0, point + float(band.get("p10", 0.0))), 2)
        totals["upper"] = round(max(point, point + float(band.get("p90", 0.0))), 2)

    # Mark which weekly rows are partially covered by the horizon. Rows are
    # rebuilt rather than mutated, and a week is never zeroed: every row in
    # ``core["weeks"]`` is touched by the horizon by construction.
    covered = {d["weekStart"] for d in daily}
    full_weeks = {
        ws
        for ws, vals in _group_days(daily).items()
        if len(vals) == 7
    }
    weekly_rows: list[dict[str, object]] = []
    for row in core["weeks"]:
        ws = str(row["weekStart"])
        weekly_rows.append({**row, "isPartial": ws not in full_weeks})
    assert covered.issubset({w["weekStart"] for w in weekly_rows})

    metadata = _FORECAST_METADATA or {}
    selection = artifact.get("selection") or {}

    return {
        "currency": currency,
        "frequency": "weekly",
        "asOf": core["asOf"],
        "trainedThrough": core["trainedThrough"],
        "generatedAt": _dt.datetime.now(_dt.UTC).isoformat(),
        "horizonDays": horizon_days,
        # The observed window ends on 2020-03-13, so every published forecast is a
        # historical simulation. ``isHistoricalSimulation`` is therefore always
        # true; a replay at an earlier origin additionally has ``isReplay`` set.
        "isHistoricalSimulation": True,
        "isReplay": str(core["asOf"]) != str(core["trainedThrough"]),
        "dataPeriod": {
            "start": "2019-01-03",
            "end": "2020-03-13",
            "lastCompleteWeek": "2020-03-02",
        },
        "model": {
            "id": f"cash-flow-{currency.lower()}",
            "algorithm": artifact.get("algorithm"),
            "version": artifact.get("version"),
            "selection": selection.get("reason") or selection.get("rule"),
        },
        "weekly": weekly_rows,
        "daily": daily,
        "historical": historical_weeks(currency),
        "totals": totals,
        "comparison": _comparison_rows(currency),
        "assumptions": [
            "Weekly collection totals are the modelled forecast; daily values are "
            "derived estimates allocated by historical weekday shares.",
            "USD and CAD are forecast independently; no FX conversion is applied.",
            "Forecast origin is the last complete week; the horizon starts the next day.",
            "Forecast values are nominal amounts in the invoice currency.",
        ],
        "disclaimer": PROXY_DISCLAIMER,
        "proxy": {
            "payment_proxy": True,
            "target_definition": metadata.get("target", {}).get("target_definition"),
            "requires_payment_ledger_for_verified_cash": True,
        },
    }


def _group_days(daily: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in daily:
        grouped.setdefault(str(row["weekStart"]), []).append(row)
    return grouped


def _comparison_rows(currency: str) -> list[dict[str, object]]:
    """Per-candidate validation metrics for the dashboard comparison table."""
    metadata = _FORECAST_METADATA or {}
    rows: list[dict[str, object]] = []
    for entry in metadata.get("comparison", []) or []:  # type: ignore[union-attr]
        if not isinstance(entry, dict):
            continue
        if entry.get("currency") != currency:
            continue
        if entry.get("scope") != "weekly":
            continue
        rows.append(
            {
                "model": entry.get("candidate"),
                "mae": entry.get("mae"),
                "rmse": entry.get("rmse"),
                "wape": entry.get("wape"),
                "folds": entry.get("folds"),
                "holdoutWape": entry.get("holdout_wape"),
            }
        )
    return rows


__all__ = [
    "FORECAST_STATUS",
    "CURRENCIES",
    "HORIZONS",
    "PROXY_DISCLAIMER",
    "ForecastError",
    "ForecastUnavailable",
    "load_forecast_models",
    "forecast_status",
    "forecast_weekly",
    "allocate_daily",
    "horizon_totals",
    "historical_weeks",
    "build_forecast_payload",
    "get_metadata",
    "week_start",
]
