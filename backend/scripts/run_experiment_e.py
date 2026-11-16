#!/usr/bin/env python3
"""Experiment E — synthetic augmentation for XGBoost and statistical models.

Arms (see AMENDMENT_E.md, registered before evaluation):

  E0p  production result, cited
  E0s  real-only: scaled weekly XGB + daily-recursive XGB + ETS + ARIMA
  E1   weekly XGB pretrained on synthetic, continued on real (xgb_model)
  E2w  weekly XGB on level-matched synthetic + real rows, weighted
  E2d  daily-recursive XGB on level-matched synthetic + real days, weighted
  E3   ETS and ARIMA on real-only / synthetic-only / hybrid series

Writes only to reports/cash_flow_synthetic/. No production artifact, API or
dashboard behaviour is touched.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/run_experiment_e.py
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from scripts.cashflow import harness as H  # noqa: E402
from scripts.cashflow.baselines import (  # noqa: E402
    SeasonalNaive,
    build_series,
    load_daily,
    load_weekly,
)
from scripts.cashflow.models_aug import (  # noqa: E402
    ScaledWeeklyXGB,
    WeightedDailyXGB,
    combine_series,
)
from scripts.cashflow.models_stat import ARIMAForecaster, ETSForecaster  # noqa: E402
from scripts.cashflow.models_xgb import DailyRecursiveXGB  # noqa: E402

DATA = ROOT / "data"
OUT = ROOT / "reports" / "cash_flow_synthetic"
SEEDS = (13, 42, 101)
CURRENCIES = ("USD", "CAD")
VALIDATION = list(range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1))
HOLDOUT = list(range(H.FIRST_HOLDOUT_ORIGIN, H.LAST_HOLDOUT_ORIGIN + 1))
STEPS = H.weeks_to_cover(90)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def load_synthetic(currency: str) -> H.Series:
    weekly = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_weekly.csv")
    daily = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_daily.csv")
    weekly = weekly.rename(columns={"collections_received": "collections"})
    daily = daily.rename(columns={"collections_received": "collections"})
    weekly["week_start"] = pd.to_datetime(weekly["week_start"]).dt.date
    daily["date"] = pd.to_datetime(daily["date"]).dt.date
    return build_series(currency, weekly, daily)


def synthetic_origins(n_weeks: int, span: int = 26, holdout: int = 13) -> tuple[list[int], list[int]]:
    last = n_weeks - holdout - 1
    return list(range(max(5, last - span), last)), list(range(last, n_weeks - 1))


def transition_ratio(synth: H.Series, real: H.Series, factor: float = 1.0) -> dict:
    """How visible is the seam between the two domains?

    Reported both raw and after level matching, because level matching is what
    the hybrid arms actually use; the raw ratio alone would exaggerate the step.
    """
    s_tail = float(np.mean(synth.values[-4:]))
    r_head = float(np.mean(real.values[:4]))
    weekly_change = float(np.median(np.abs(np.diff(real.values))))

    raw_gap = abs(s_tail - r_head)
    matched_gap = abs(s_tail * factor - r_head)
    return {
        "synthetic_tail_mean_raw": s_tail,
        "synthetic_tail_mean_matched": s_tail * factor,
        "real_head_mean": r_head,
        "raw_gap": raw_gap,
        "matched_gap": matched_gap,
        "typical_weekly_change": weekly_change,
        "ratio_raw": (raw_gap / weekly_change) if weekly_change else float("nan"),
        "ratio": (matched_gap / weekly_change) if weekly_change else float("nan"),
    }


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def per_origin_wape(result: H.FoldResult) -> float:
    actual = np.asarray(result.step_actual, dtype=float)
    predicted = np.asarray(result.step_predicted, dtype=float)
    denom = float(np.abs(actual).sum())
    return float(np.abs(actual - predicted).sum() / denom) if denom > 0 else float("nan")


def evaluate(
    series: H.Series,
    origins: list[int],
    arm: str,
    algorithm: str,
    currency: str,
    seed: int | None,
    builder,
    results: list[dict],
    origins_out: list[dict],
    partition: str,
) -> dict | None:
    try:
        folds = H.run_folds(series, builder(), origins, STEPS)
    except Exception as exc:
        print(f"    ! {arm} {algorithm} seed={seed} failed: {type(exc).__name__}: {exc}")
        return None
    summary = H.summarise(folds)
    row = {
        "currency": currency,
        "arm": arm,
        "algorithm": algorithm,
        "seed": seed,
        "partition": partition,
        "wape": summary["weekly"]["wape"],
        "mae": summary["weekly"]["mae"],
        "rmse": summary["weekly"]["rmse"],
        # h90 is unreachable on the holdout (only 12 weeks remain), so horizons
        # are read defensively rather than assuming every one exists.
        "h7_wape": summary["h7"].get("wape"),
        "h30_wape": summary["h30"].get("wape"),
        "h90_wape": summary["h90"].get("wape"),
        "folds": summary["folds"],
    }
    results.append(row)
    for res in folds:
        origins_out.append(
            {
                "currency": currency,
                "arm": arm,
                "algorithm": algorithm,
                "seed": seed,
                "partition": partition,
                "origin": res.origin,
                "as_of": str(res.as_of),
                "wape": per_origin_wape(res),
                "actual_total": float(np.sum(res.step_actual)),
                "predicted_total": float(np.sum(res.step_predicted)),
            }
        )
    print(
        f"    {arm:4s} {algorithm:26s} seed={str(seed):4s} "
        f"WAPE={row['wape']:.4f} h30={row['h30_wape'] if row['h30_wape'] is not None else float('nan'):.4f}"
    )
    return row


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    real_weekly = load_weekly(DATA / "processed" / "cash_flow_weekly.csv")
    real_daily = load_daily(DATA / "processed" / "cash_flow_daily.csv")
    real_invoices = pd.read_csv(DATA / "processed" / "flowcred_cleaned.csv")
    synth_invoices = pd.read_csv(
        DATA / "raw" / "synthetic" / "synthetic_invoices.csv"
    ).rename(columns={"currency": "invoice_currency"})

    results: list[dict] = []
    origins_out: list[dict] = []
    transitions: dict[str, dict] = {}

    for currency in CURRENCIES:
        print(f"\n=== {currency} ===")
        real = build_series(currency, real_weekly, real_daily)
        synth = load_synthetic(currency)
        combined, factor = combine_series(synth, real)
        offset = len(synth.week_starts)
        real_first_week = min(real.week_starts)
        transitions[currency] = {
            **transition_ratio(synth, real),
            "level_match_factor": round(factor, 4),
            "combined_weeks": len(combined.week_starts),
        }
        print(
            f"  seam: |synthetic tail - real head| / typical weekly change = "
            f"{transitions[currency]['ratio']:.2f}; level factor {factor:.2f}"
        )

        comb_val = [offset + i for i in VALIDATION]
        comb_hold = [offset + i for i in HOLDOUT]
        syn_val, syn_hold = synthetic_origins(len(synth))

        # ---- E0s: real-only ------------------------------------------------
        for seed in SEEDS:
            evaluate(real, VALIDATION, "E0s", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(seed=s, invoices=real_invoices, currency=currency),
                     results, origins_out, "validation")
            evaluate(real, HOLDOUT, "E0s", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(seed=s, invoices=real_invoices, currency=currency),
                     results, origins_out, "holdout")
        for seed in SEEDS:
            evaluate(real, VALIDATION, "E0s", "xgboost_daily", currency, seed,
                     lambda s=seed: DailyRecursiveXGB(real_invoices, currency),
                     results, origins_out, "validation")
            evaluate(real, HOLDOUT, "E0s", "xgboost_daily", currency, seed,
                     lambda s=seed: DailyRecursiveXGB(real_invoices, currency),
                     results, origins_out, "holdout")

        # ---- E1: pretrain then continue on real ----------------------------
        for seed in SEEDS:
            evaluate(real, VALIDATION, "E1", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(
                         seed=s, invoices=real_invoices, currency=currency, pretrain_series=synth
                     ),
                     results, origins_out, "validation")
            evaluate(real, HOLDOUT, "E1", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(
                         seed=s, invoices=real_invoices, currency=currency, pretrain_series=synth
                     ),
                     results, origins_out, "holdout")

        # ---- E2w: weighted combined weekly ---------------------------------
        for seed in SEEDS:
            evaluate(combined, comb_val, "E2w", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(
                         seed=s, invoices=real_invoices, currency=currency,
                         synthetic_before=real_first_week,
                     ),
                     results, origins_out, "validation")
            evaluate(combined, comb_hold, "E2w", "xgboost_weekly_scaled", currency, seed,
                     lambda s=seed: ScaledWeeklyXGB(
                         seed=s, invoices=real_invoices, currency=currency,
                         synthetic_before=real_first_week,
                     ),
                     results, origins_out, "holdout")

        # ---- E2d: weighted combined daily ----------------------------------
        for seed in SEEDS:
            evaluate(combined, comb_val, "E2d", "xgboost_daily", currency, seed,
                     lambda s=seed: WeightedDailyXGB(
                         invoices=real_invoices, currency=currency, seed=s,
                         synthetic_before=real_first_week,
                     ),
                     results, origins_out, "validation")
            evaluate(combined, comb_hold, "E2d", "xgboost_daily", currency, seed,
                     lambda s=seed: WeightedDailyXGB(
                         invoices=real_invoices, currency=currency, seed=s,
                         synthetic_before=real_first_week,
                     ),
                     results, origins_out, "holdout")

        # ---- E3: statistical sensitivity -----------------------------------
        for algorithm, factory in (
            ("arima", ARIMAForecaster),
            ("ets", ETSForecaster),
        ):
            evaluate(real, VALIDATION, "E0s", algorithm, currency, None,
                     lambda f=factory: f(), results, origins_out, "validation")
            evaluate(real, HOLDOUT, "E0s", algorithm, currency, None,
                     lambda f=factory: f(), results, origins_out, "holdout")
            evaluate(synth, syn_val, "E3", f"{algorithm}_synthetic", currency, None,
                     lambda f=factory: f(), results, origins_out, "synthetic")
            evaluate(synth, syn_hold, "E3", f"{algorithm}_synthetic", currency, None,
                     lambda f=factory: f(), results, origins_out, "synthetic_holdout")
            evaluate(combined, comb_val, "E3", f"{algorithm}_hybrid", currency, None,
                     lambda f=factory: f(), results, origins_out, "validation")
            evaluate(combined, comb_hold, "E3", f"{algorithm}_hybrid", currency, None,
                     lambda f=factory: f(), results, origins_out, "holdout")

        # seasonal-naive reference on the real series
        evaluate(real, VALIDATION, "E0s", "seasonal_naive", currency, None,
                 lambda: SeasonalNaive(), results, origins_out, "validation")

    frame = pd.DataFrame(results)
    per_origin = pd.DataFrame(origins_out)
    frame.to_csv(OUT / "experiment_e_results.csv", index=False)
    per_origin.to_csv(OUT / "experiment_e_per_origin.csv", index=False)

    verdicts = build_verdicts(frame, per_origin, transitions)
    (OUT / "experiment_e_metrics.json").write_text(
        json.dumps({"verdicts": verdicts, "transition": transitions}, indent=2) + "\n",
        encoding="utf-8",
    )
    write_summary(verdicts, transitions, frame)
    print(f"\nwrote {OUT.relative_to(ROOT)}/experiment_e_*")
    return 0


# ---------------------------------------------------------------------------
# Verdicts
# ---------------------------------------------------------------------------
COMPARISONS = [
    # (algorithm label, augmented arm, real-only arm, algorithm key)
    ("XGBoost weekly (E1 pretrain)", "E1", "E0s", "xgboost_weekly_scaled"),
    ("XGBoost weekly (E2w combined)", "E2w", "E0s", "xgboost_weekly_scaled"),
    ("XGBoost daily (E2d combined)", "E2d", "E0s", "xgboost_daily"),
    ("ARIMA (hybrid)", "E3", "E0s", "arima"),
    ("ETS (hybrid)", "E3", "E0s", "ets"),
]


def _mean_wape(frame: pd.DataFrame, currency: str, arm: str, algorithm: str, partition: str) -> float:
    sub = frame[
        (frame.currency == currency)
        & (frame.arm == arm)
        & (frame.algorithm == algorithm)
        & (frame.partition == partition)
    ]
    return float(sub["wape"].mean()) if len(sub) else float("nan")


def build_verdicts(frame: pd.DataFrame, per_origin: pd.DataFrame, transitions: dict) -> dict:
    out: dict[str, dict] = {}
    for currency in CURRENCIES:
        out[currency] = {}
        for label, arm, base_arm, algorithm in COMPARISONS:
            base_algo = algorithm
            if arm == "E3":
                base_algo = algorithm
                aug_algo = f"{algorithm}_hybrid"
            else:
                aug_algo = base_algo

            base = _mean_wape(frame, currency, base_arm, base_algo, "validation")
            aug = _mean_wape(frame, currency, arm, aug_algo, "validation")
            if not np.isfinite(base) or not np.isfinite(aug):
                continue

            po = per_origin[per_origin.currency == currency]
            b = po[(po.arm == base_arm) & (po.algorithm == base_algo) & (po.partition == "validation")]
            a = po[(po.arm == arm) & (po.algorithm == aug_algo) & (po.partition == "validation")]
            # Combined arms index origins in the combined series (synthetic
            # prefix + real). Aligning on the as-of date makes the comparison
            # date-based and immune to that offset.
            b = b.groupby("as_of")["wape"].mean()
            a = a.groupby("as_of")["wape"].mean()
            common = b.index.intersection(a.index)
            wins = int((a.loc[common] < b.loc[common]).sum())
            total = int(len(common))

            rel = (base - aug) / base if base else float("nan")
            qualifies = bool(rel >= 0.10 and wins >= 4)
            out[currency][label] = {
                "base_arm": base_arm,
                "augmented_arm": arm,
                "base_wape": round(base, 4),
                "augmented_wape": round(aug, 4),
                "relative_improvement": round(rel, 4),
                "origins_won": wins,
                "origins_total": total,
                "qualifies": qualifies,
                "verdict": "improved" if qualifies else (
                    "worsened" if rel < -0.02 else "no material change"
                ),
            }
    return out


def write_summary(verdicts: dict, transitions: dict, frame: pd.DataFrame) -> None:
    lines = [
        "# Experiment E — synthetic augmentation for XGBoost and statistical models",
        "",
        "Protocol: `AMENDMENT_E.md`, registered before any candidate ran.",
        "Production artifacts and selection are unchanged.",
        "",
        "## Domain seam (why hybrid arms need scrutiny)",
        "",
        "| Currency | Synthetic tail (matched) | Real head | Typical weekly change | Seam ratio (raw → matched) | Level factor |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for currency, t in transitions.items():
        lines.append(
            f"| {currency} | {t['synthetic_tail_mean_matched']:,.0f} | {t['real_head_mean']:,.0f} | "
            f"{t['typical_weekly_change']:,.0f} | "
            f"{t['ratio_raw']:.2f}× → **{t['ratio']:.2f}×** | {t['level_match_factor']:.2f} |"
        )

    lines += [
        "",
        "A seam ratio near 1 means the join is indistinguishable from an ordinary",
        "week. Larger values mean the hybrid series contains a step that a model",
        "can see.",
        "",
        "## Acceptance (>=10% relative improvement and >=4 origins, per currency)",
        "",
        "| Currency | Candidate | Real-only WAPE | Augmented WAPE | Relative | Origins | Verdict |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for currency, items in verdicts.items():
        for label, v in items.items():
            lines.append(
                f"| {currency} | {label} | {v['base_wape']:.4f} | {v['augmented_wape']:.4f} | "
                f"{v['relative_improvement']:+.1%} | {v['origins_won']}/{v['origins_total']} | "
                f"**{v['verdict']}** |"
            )

    lines += ["", "## Recommendation per algorithm", ""]
    for label in {label for items in verdicts.values() for label in items}:
        passed = [c for c, items in verdicts.items() if label in items and items[label]["qualifies"]]
        if passed:
            lines.append(f"* **{label}** — qualifies on {', '.join(passed)}. Still requires a")
            lines.append("  separate decision before any production change; it was not promoted.")
        else:
            lines.append(f"* **{label}** — does not qualify on any currency. Keep real-only.")

    flagged = [
        (c, v["ratio"]) for c, v in transitions.items() if v.get("ratio", 0) > 2.0
    ]
    if flagged:
        lines += ["", "## Seam warning", ""]
        for currency, ratio in flagged:
            lines.append(
                f"* **{currency}** — the level-matched seam is {ratio:.2f}× a typical "
                "weekly move. Any hybrid gain on this currency may partly be the model "
                "reacting to that step rather than to genuine prior information, so the "
                "hybrid result is reported as inconclusive rather than as evidence."
            )

    lines += [
        "",
        "## Synthetic-only arms",
        "",
        "ARIMA and ETS were also fitted on the synthetic series alone and scored on",
        "synthetic origins (`partition=synthetic`). Those numbers appear in",
        "`experiment_e_results.csv`, are labelled, and can never be promoted: they",
        "measure the simulator, not the business.",
        "",
        "## Caveats",
        "",
        "* CAD's synthetic series is smoother than the real one (CV 0.261 vs 0.438),",
        "  so synthetic-only CAD results flatter any model that sees them.",
        "* Hybrid arms place a rescaled synthetic history before the real window;",
        "  the seam ratio above quantifies how artificial that join is.",
        "* The real holdout is dominated by the 2020-01-06 collection collapse and is",
        "  used only for confirmation, never for selection.",
        "",
    ]
    (OUT / "experiment_e_SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
