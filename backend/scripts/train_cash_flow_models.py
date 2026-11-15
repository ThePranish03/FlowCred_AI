#!/usr/bin/env python3
"""Offline training, chronological backtesting and artifact export for Model 4.

Pipeline
--------
1. Load the derived daily/weekly series and the invoice extract.
2. Evaluate every candidate (2 baselines + 4 model variants) on the *same*
   rolling-origin folds using ``scripts.cashflow.harness``.
3. Apply the pre-declared selection rule per currency.
4. Re-check the selected model on the untouched holdout origins.
5. Refit on all available history and export exactly one production artifact
   per currency plus one metadata file.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/train_cash_flow_models.py
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import platform
import sys
import time
import traceback
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from app.cash_flow_target import PROXY_METADATA  # noqa: E402
from scripts.cashflow import harness as H  # noqa: E402
from scripts.cashflow.baselines import (  # noqa: E402
    DueDateForecaster,
    ExpandingMean,
    SeasonalNaive,
    build_series,
    load_daily,
    load_weekly,
)

DATA = ROOT / "data" / "processed"
REPORTS = ROOT / "reports" / "cash_flow"
CANDIDATES = REPORTS / "candidates"
MODELS = ROOT / "models"

MODEL_VERSION = "1.0.0"
BASELINE_NAMES = {"seasonal_naive", "due_date_schedule"}

# Declared before any candidate was scored. See reports/cash_flow/DECISIONS.md.
PRIMARY_METRIC = "weekly_path_wape"


def load_inputs():
    weekly = load_weekly(DATA / "cash_flow_weekly.csv")
    daily = load_daily(DATA / "cash_flow_daily.csv")
    invoices = pd.read_csv(DATA / "flowcred_cleaned.csv")
    return weekly, daily, invoices


def build_candidates(currency: str, invoices: pd.DataFrame) -> list[H.Forecaster]:
    """All candidates for one currency. Unavailable libraries degrade to []."""
    cands: list[H.Forecaster] = [DueDateForecaster(invoices, currency), SeasonalNaive()]

    try:
        from scripts.cashflow.models_xgb import build_candidates as xgb_candidates

        cands.extend(xgb_candidates(invoices, currency))
    except Exception as exc:  # pragma: no cover - environment dependent
        print(f"  ! xgboost candidates unavailable: {type(exc).__name__}: {exc}")

    try:
        from scripts.cashflow.models_stat import build_candidates as stat_candidates

        cands.extend(stat_candidates(None))
    except Exception as exc:  # pragma: no cover - environment dependent
        print(f"  ! statistical candidates unavailable: {type(exc).__name__}: {exc}")
    return cands


def candidate_metrics(series: H.Series, cand: H.Forecaster) -> dict[str, object]:
    validation = list(range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1))
    results = H.run_folds(series, cand, validation, H.weeks_to_cover(90))
    summary = H.summarise(results)
    holdout = list(range(H.FIRST_HOLDOUT_ORIGIN, H.LAST_HOLDOUT_ORIGIN + 1))
    hold_results = H.run_folds(series, cand, holdout, H.weeks_to_cover(90))
    summary["holdout"] = H.summarise(hold_results)
    summary["candidate"] = cand.name
    summary["currency"] = series.currency
    summary["_results"] = results
    summary["_holdout_results"] = hold_results
    return summary


def selection_decision(
    comparison: list[dict[str, object]], currency: str
) -> dict[str, object]:
    """Apply the pre-declared rule.

    * Valid baselines: ``seasonal_naive`` (valid at every step) and
      ``due_date_schedule`` (valid only at step 1 — beyond one week the open
      book contains only partially issued invoices, so its multi-step output is
      structurally truncated rather than a forecast; this is recorded, not
      hidden).
    * Primary metric: pooled weekly-path WAPE over steps 1..13 on the validation
      origins. It scores the actual weekly forecast path rather than an
      aggregate that can average errors away.
    * A model candidate ships only if it beats the best baseline by
      >= 10% relative WAPE **and** improves on at least 4 validation origins.
    """
    rows = [r for r in comparison if r["currency"] == currency]
    if not rows:
        raise ValueError(f"no comparison rows for {currency}")

    baselines = [r for r in rows if r["candidate"] in BASELINE_NAMES]
    models = [r for r in rows if r["candidate"] not in BASELINE_NAMES]

    best_base = min(baselines, key=lambda r: r["summary"]["weekly"]["wape"])
    base_wape = float(best_base["summary"]["weekly"]["wape"])
    threshold = base_wape * (1 - H.SELECTION_RULE["relative_wape_improvement_threshold"])

    qualified: list[dict[str, object]] = []
    for row in models:
        wape = float(row["summary"]["weekly"]["wape"])
        if not math.isfinite(wape) or wape <= 0:
            continue
        origins_beaten = int(row.get("origins_beating_baseline", 0))
        improves = (base_wape - wape) / base_wape
        if wape <= threshold and origins_beaten >= H.SELECTION_RULE["minimum_origins_beating_threshold"]:
            qualified.append(row)

    if qualified:
        winner = min(qualified, key=lambda r: r["summary"]["weekly"]["wape"])
        reason = (
            f"{winner['candidate']} achieved weekly-path WAPE "
            f"{winner['summary']['weekly']['wape']:.4f} vs best baseline "
            f"{best_base['candidate']} {base_wape:.4f} "
            f"({(base_wape - winner['summary']['weekly']['wape']) / base_wape:.1%} relative "
            f"improvement) and beat it on >= {H.SELECTION_RULE['minimum_origins_beating_threshold']} origins."
        )
        return {
            "currency": currency,
            "selected": winner["candidate"],
            "kind": "model",
            "reason": reason,
            "baseline": best_base["candidate"],
            "baseline_wape": base_wape,
            "selected_wape": float(winner["summary"]["weekly"]["wape"]),
            "threshold_wape": threshold,
        }

    return {
        "currency": currency,
        "selected": best_base["candidate"],
        "kind": "baseline",
        "reason": (
            f"No candidate beat the best baseline {best_base['candidate']} "
            f"(weekly-path WAPE {base_wape:.4f}) by at least 10% relative WAPE on "
            f">= {H.SELECTION_RULE['minimum_origins_beating_threshold']} validation origins, "
            f"so the baseline is the production approach, as pre-declared."
        ),
        "baseline": best_base["candidate"],
        "baseline_wape": base_wape,
        "selected_wape": base_wape,
        "threshold_wape": threshold,
    }


def origins_beating_baseline(
    results: list[H.FoldResult], baseline_results: list[H.FoldResult]
) -> int:
    """Count origins where this candidate's weekly-path WAPE beats the baseline."""
    by_origin = {r.origin: r for r in results}
    base_by_origin = {r.origin: r for r in baseline_results}
    count = 0
    for origin, res in by_origin.items():
        base = base_by_origin.get(origin)
        if base is None:
            continue
        a = np.array(res.step_actual, dtype=float)
        p = np.array(res.step_predicted, dtype=float)
        bp = np.array(base.step_predicted, dtype=float)
        denom = np.abs(a).sum()
        if denom <= 0:
            continue
        wape = np.abs(a - p).sum() / denom
        base_wape = np.abs(a - bp).sum() / denom
        if wape < base_wape:
            count += 1
    return count


def fit_production(
    series: H.Series,
    cand: H.Forecaster,
    currency: str,
) -> dict[str, object]:
    """Refit the selected candidate on all history and build the artifact.

    The artifact is self-contained: history, weekday shares, the fitted object
    for models, and a frozen ``replay`` grid of forecasts at every historical
    origin. Serving therefore never retrains and never reads the dataset.
    """
    import copy

    origin = len(series) - 1
    model = cand.fit(series, origin)
    steps = H.weeks_to_cover(90)
    preds = np.asarray(model.predict(steps), dtype=float)

    week_starts = [
        series.week_starts[origin] + _dt.timedelta(days=7 * (k + 1))
        for k in range(steps)
    ]

    # Frozen historical replays: one forecast per complete historical origin.
    # Produced offline so that ``asOf`` replay is reproducible without fitting
    # anything at request time. Weekday shares are stored per origin too, so a
    # historical replay never allocates days with shares learned from the future.
    replay: dict[str, list[float]] = {}
    replay_shares: dict[str, dict[str, float]] = {}
    for o in range(H.FIRST_VALIDATION_ORIGIN, origin + 1):
        try:
            fitted = copy.deepcopy(cand).fit(series, o)
            vals = np.asarray(fitted.predict(steps), dtype=float)
            key = str(series.week_starts[o] + _dt.timedelta(days=6))
            replay[key] = [float(v) for v in vals]
            replay_shares[key] = {
                str(k): float(v) for k, v in series.shares_upto(o).items()
            }
        except Exception:  # pragma: no cover - guarded per origin
            continue

    return {
        "algorithm": cand.name,
        "estimator": model,
        "currency": currency,
        "frequency": "W-MON",
        "trained_through": str(series.week_starts[origin] + _dt.timedelta(days=6)),
        "last_complete_week_start": str(series.week_starts[origin]),
        "version": MODEL_VERSION,
        "history_week_starts": [str(d) for d in series.week_starts],
        "history_values": [float(v) for v in series.values],
        "weekday_shares": {str(k): float(v) for k, v in series.shares.items()},
        "replay_shares": replay_shares,
        "forecast_week_starts": [str(d) for d in week_starts],
        "forecast_weekly": [float(v) for v in preds],
        "replay": replay,
        "replay_steps": steps,
        "config": {
            "horizon_weeks": steps,
            "primary_metric": PRIMARY_METRIC,
            "model_version": MODEL_VERSION,
        },
        "python": platform.python_version(),
    }


def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    weekly, daily, invoices = load_inputs()

    all_rows: list[dict[str, object]] = []
    fold_rows: list[dict[str, object]] = []
    decisions: list[dict[str, object]] = []

    for currency in ("USD", "CAD"):
        print(f"\n=== {currency} ===")
        series = build_series(currency, weekly, daily)
        cands = build_candidates(currency, invoices)

        comparison: list[dict[str, object]] = []
        for cand in cands:
            started = time.time()
            try:
                summary = candidate_metrics(series, cand)
            except Exception:
                print(f"  ! {cand.name} failed:\n{traceback.format_exc()}", flush=True)
                continue
            comparison.append({"candidate": cand.name, "currency": currency, "summary": summary})
            print(
                f"  {cand.name:20s} val weeklyWAPE={summary['weekly']['wape']:.4f} "
                f"h7={summary['h7']['wape']:.4f} h30={summary['h30']['wape']:.4f} "
                f"h90={summary['h90']['wape']:.4f} | holdout h30={summary['holdout']['h30']['wape']:.4f} "
                f"[{time.time() - started:.0f}s]",
                flush=True,
            )

        validation = list(range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1))
        baseline_name = "seasonal_naive"
        base_row = next(r for r in comparison if r["candidate"] == baseline_name)
        base_results = base_row["summary"]["_results"]
        for row in comparison:
            row["origins_beating_baseline"] = origins_beating_baseline(
                row["summary"]["_results"], base_results
            )

        decision = selection_decision(comparison, currency)
        decisions.append(decision)
        print(f"  -> selected: {decision['selected']} ({decision['kind']})")

        selected_row = next(r for r in comparison if r["candidate"] == decision["selected"])
        residuals = H.step_residuals(selected_row["summary"]["_results"], H.weeks_to_cover(90))
        quantiles = {
            str(k): {
                "p10": float(np.percentile(v, 10)) if v else 0.0,
                "p90": float(np.percentile(v, 90)) if v else 0.0,
            }
            for k, v in residuals.items()
        }
        decision["interval_quantiles"] = quantiles

        # Horizon-level empirical interval (better calibrated than summing
        # per-week bands, which would assume quantiles scale with the mean).
        horizon_intervals: dict[str, dict[str, float | int]] = {}
        for h in H.HORIZONS:
            errs = [
                r.horizon_actual[h] - r.horizon_predicted[h]
                for r in selected_row["summary"]["_results"]
                if h in r.horizon_actual
            ]
            if len(errs) >= 8:
                horizon_intervals[str(h)] = {
                    "p10": float(np.percentile(errs, 10)),
                    "p90": float(np.percentile(errs, 90)),
                    "n": len(errs),
                }
        decision["horizon_intervals"] = horizon_intervals

        # ---- export production artifact for this currency -------------------
        selected_cand = next(c for c in cands if c.name == decision["selected"])
        artifact = fit_production(series, selected_cand, currency)
        artifact["selection"] = {
            "rule": H.SELECTION_RULE,
            "selected": decision["selected"],
            "kind": decision["kind"],
            "reason": decision["reason"],
            "baseline": decision["baseline"],
            "baseline_wape": decision["baseline_wape"],
            "selected_wape": decision["selected_wape"],
        }
        artifact["interval_quantiles"] = quantiles
        artifact["horizon_intervals"] = horizon_intervals
        joblib.dump(artifact, CANDIDATES / f"{decision['selected']}_{currency.lower()}.joblib")
        joblib.dump(artifact, MODELS / f"cash_flow_forecaster_{currency.lower()}.joblib")
        print(f"  artifact -> models/cash_flow_forecaster_{currency.lower()}.joblib")

        # Flatten for CSV output.
        for row in comparison:
            s = row["summary"]
            for scope in ("weekly", "h7", "h30", "h90"):
                m = s[scope]
                all_rows.append(
                    {
                        "currency": currency,
                        "candidate": row["candidate"],
                        "scope": scope,
                        "n": m.get("n"),
                        "mae": m.get("mae"),
                        "rmse": m.get("rmse"),
                        "wape": m.get("wape"),
                        "bias": m.get("bias"),
                        "holdout_wape": s["holdout"][scope].get("wape"),
                        "folds": s["folds"],
                        "first_as_of": s["first_as_of"],
                        "last_as_of": s["last_as_of"],
                        "origins_beating_naive": row["origins_beating_baseline"],
                        "selected": decision["selected"] == row["candidate"],
                    }
                )
            for fold_set, results in (
                ("validation", s["_results"]),
                ("holdout", s.get("_holdout_results", [])),
            ):
                for res in results:
                    for k, (a, p) in enumerate(zip(res.step_actual, res.step_predicted), start=1):
                        fold_rows.append(
                            {
                                "currency": currency,
                                "candidate": row["candidate"],
                                "fold_set": fold_set,
                                "origin_index": res.origin,
                                "as_of": str(res.as_of),
                                "step": k,
                                "actual": a,
                                "predicted": p,
                                "error": a - p,
                            }
                        )

    comparison_df = pd.DataFrame(all_rows)
    comparison_df.to_csv(REPORTS / "model_comparison.csv", index=False)
    pd.DataFrame(fold_rows).to_csv(REPORTS / "backtest_folds.csv", index=False)

    def _jsonable(obj):
        if isinstance(obj, dict):
            return {str(k): _jsonable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_jsonable(v) for v in obj]
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating, float)):
            value = float(obj)
            # NaN/Inf are not valid JSON; emit null instead of writing a literal
            # that breaks strict parsers (e.g. JSON.parse in the browser).
            return value if math.isfinite(value) else None
        if isinstance(obj, (_dt.date, _dt.datetime)):
            return str(obj)
        return obj

    metadata = {
        "generated_at": _dt.datetime.now(_dt.UTC).isoformat(),
        "model_version": MODEL_VERSION,
        "python": platform.python_version(),
        "data_period": {
            "start": "2019-01-03",
            "end": "2020-03-13",
            "first_complete_week": "2019-01-07",
            "last_complete_week": "2020-03-02",
            "complete_week_count": 61,
        },
        "selection_rule": H.SELECTION_RULE,
        "primary_metric": PRIMARY_METRIC,
        "horizons_days": list(H.HORIZONS),
        "frequency": "weekly (W-MON); daily values are derived estimates",
        "decisions": decisions,
        "comparison": comparison_df.to_dict("records"),
        "target": PROXY_METADATA,
        "artifacts": {
            "USD": "models/cash_flow_forecaster_usd.joblib",
            "CAD": "models/cash_flow_forecaster_cad.joblib",
        },
    }
    (REPORTS / "metrics.json").write_text(
        json.dumps(_jsonable(metadata), indent=2) + "\n", encoding="utf-8"
    )
    (MODELS / "cash_flow_model_metadata.json").write_text(
        json.dumps(_jsonable(metadata), indent=2) + "\n", encoding="utf-8"
    )

    print("\nwrote reports/cash_flow/{model_comparison.csv,backtest_folds.csv,metrics.json}")
    print("wrote models/{cash_flow_forecaster_usd,cash_flow_forecaster_cad}.joblib")
    print("wrote models/cash_flow_model_metadata.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
