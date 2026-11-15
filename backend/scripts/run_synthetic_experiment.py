#!/usr/bin/env python3
"""Three-way synthetic-data experiment for Model 4 (A / B / C).

    A. Real-only training, real-world evaluation.
    B. Synthetic-only training, synthetic evaluation.
    C. Synthetic + real training (synthetic placed *before* the real history),
       untouched real-world evaluation.

Experiment C is the only one that needs care about time: the synthetic
simulation covers 2021-2023 and the real data ends in 2020, so concatenating
them in date order would train on the future. C therefore relocates the
synthetic history to end the week before the real series starts and rescales it
to the real currency level (a documented modelling choice, not a data claim).

Nothing here touches production artifacts. Outputs go to
``reports/cash_flow_synthetic/`` only.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/run_synthetic_experiment.py
"""

from __future__ import annotations

import datetime as dt
import json
import warnings
import sys
import time
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

DATA = ROOT / "data"
OUT = ROOT / "reports" / "cash_flow_synthetic"
CURRENCIES = ("USD", "CAD")

# Same candidate set in all three experiments, so the comparison is like-for-like.
# The due-date schedule is excluded: it needs the open invoice book, which is not
# the same object across the real and synthetic portfolios.
def candidates(invoices: pd.DataFrame | None, currency: str):
    out: list[H.Forecaster] = [SeasonalNaive()]
    try:
        from scripts.cashflow.models_xgb import build_candidates as xgb

        out.extend(xgb(invoices, currency))
    except Exception as exc:  # pragma: no cover - environment dependent
        print(f"  ! xgboost unavailable: {exc}")
    try:
        from scripts.cashflow.models_stat import build_candidates as stat

        out.extend(stat(None))
    except Exception as exc:  # pragma: no cover - environment dependent
        print(f"  ! statistical models unavailable: {exc}")
    return out


def load_synthetic() -> tuple[pd.DataFrame, pd.DataFrame]:
    weekly = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_weekly.csv")
    daily = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_daily.csv")
    weekly = weekly.rename(columns={"collections_received": "collections"})
    daily = daily.rename(columns={"collections_received": "collections"})
    weekly["week_start"] = pd.to_datetime(weekly["week_start"]).dt.date
    daily["date"] = pd.to_datetime(daily["date"]).dt.date
    return weekly, daily


def latest_origins(n_weeks: int, span: int = 26, holdout: int = 13) -> tuple[list[int], list[int]]:
    """Validation origins from the recent past, then the last ``holdout`` weeks."""
    last_holdout_start = n_weeks - holdout - 1
    first_validation = max(5, last_holdout_start - span)
    validation = list(range(first_validation, last_holdout_start))
    hold = list(range(last_holdout_start, n_weeks - 1))
    return validation, hold


def shift_prefix(
    synth_weekly: pd.DataFrame,
    synth_daily: pd.DataFrame,
    real_first_day: dt.date,
    real_mean: float,
) -> tuple[pd.DataFrame, pd.DataFrame, float]:
    """Relocate + rescale the synthetic history to sit before the real series.

    Two details matter: the synthetic daily series is first trimmed to the last
    *complete* week so it agrees with the weekly series, and the shift is
    anchored on the real daily start (not the first complete week) because the
    real extract begins a few days before its first Monday.
    """
    last_complete_week = max(synth_weekly["week_start"])
    synth_daily = synth_daily.loc[
        synth_daily["date"] <= last_complete_week + dt.timedelta(days=6)
    ]
    target_last_day = real_first_day - dt.timedelta(days=1)
    delta = (target_last_day - max(synth_daily["date"])).days

    shifted_weekly = synth_weekly.copy()
    shifted_weekly["week_start"] = [
        d + dt.timedelta(days=delta) for d in shifted_weekly["week_start"]
    ]
    shifted_daily = synth_daily.copy()
    shifted_daily["date"] = [d + dt.timedelta(days=delta) for d in shifted_daily["date"]]

    if shifted_daily["date"].duplicated().any():
        raise ValueError("synthetic shift produced duplicate dates")
    if max(shifted_daily["date"]) != target_last_day:
        raise ValueError("synthetic prefix does not end immediately before the real window")

    synth_mean = float(shifted_weekly["collections"].mean())
    scale = real_mean / synth_mean if synth_mean > 0 else 1.0
    shifted_weekly["collections"] = shifted_weekly["collections"] * scale
    shifted_daily["collections"] = shifted_daily["collections"] * scale
    return shifted_weekly, shifted_daily, scale


def evaluate(
    series: H.Series,
    validation: list[int],
    holdout: list[int],
    label: str,
    invoices: pd.DataFrame | None,
) -> dict:
    rows: dict[str, dict] = {}
    for cand in candidates(invoices, series.currency):
        started = time.time()
        try:
            val = H.run_folds(series, cand, validation, H.weeks_to_cover(90))
            hold = H.run_folds(series, cand, holdout, H.weeks_to_cover(90))
        except Exception as exc:
            print(f"    ! {cand.name} failed: {type(exc).__name__}: {exc}")
            continue
        rows[cand.name] = {
            "validation": H.summarise(val),
            "holdout": H.summarise(hold),
            "seconds": round(time.time() - started, 1),
        }
        v = rows[cand.name]["validation"]
        print(
            f"    {cand.name:18s} val WAPE={v['weekly']['wape']:.4f} "
            f"h30={v['h30']['wape']:.4f} | holdout h30={rows[cand.name]['holdout']['h30']['wape']:.4f}"
        )
    return rows



def write_summary(frame: pd.DataFrame) -> None:
    """Select on validation, then report that candidate's holdout.

    Picking the best candidate per partition would quietly use the holdout for
    selection, which is exactly what the contract forbids.
    """
    lines = [
        "# Model 4 — synthetic-data experiments",
        "",
        "Generated by `backend/scripts/run_synthetic_experiment.py`. Experiments,",
        "not production selections: no artifact in `models/` changed, and none of",
        "these numbers replace the recorded real-world results.",
        "",
        "| Experiment | Training data | Evaluation |",
        "|---|---|---|",
        "| A | real only | real validation + holdout |",
        "| B | synthetic only | synthetic validation + holdout |",
        "| C | synthetic prefix + real | untouched real validation + holdout |",
        "",
        "The due-date schedule is excluded so all three experiments use the same",
        "candidate set; it depends on the open invoice book, which differs between",
        "the real and synthetic portfolios.",
        "",
        "## Selected on validation, then scored on holdout",
        "",
        "| Experiment | Currency | Candidate | Validation WAPE | Holdout WAPE |",
        "|---|---|---|---:|---:|",
    ]

    picks: dict[tuple[str, str], tuple[str, float, float]] = {}
    for experiment in ("A", "B", "C"):
        for currency in ("USD", "CAD"):
            val = frame[
                (frame.experiment == experiment)
                & (frame.currency == currency)
                & (frame.partition == "validation")
                & (frame.scope == "weekly")
            ].sort_values("wape")
            if val.empty:
                continue
            best = val.iloc[0]
            hold = frame[
                (frame.experiment == experiment)
                & (frame.currency == currency)
                & (frame.partition == "holdout")
                & (frame.scope == "weekly")
                & (frame.candidate == best["candidate"])
            ]
            hold_wape = float(hold.iloc[0]["wape"]) if len(hold) else float("nan")
            picks[(experiment, currency)] = (best["candidate"], float(best["wape"]), hold_wape)
            lines.append(
                f"| {experiment} | {currency} | {best['candidate']} | "
                f"{float(best['wape']):.4f} | {hold_wape:.4f} |"
            )

    lines += ["", "## What changed versus real-only", ""]
    for currency in ("USD", "CAD"):
        a = picks.get(("A", currency))
        c = picks.get(("C", currency))
        if not a or not c:
            continue
        lines.append(
            f"* **{currency}** — best real-only candidate was `{a[0]}` "
            f"(validation {a[1]:.4f}, holdout {a[2]:.4f}). With the synthetic "
            f"prefix the selected candidate is `{c[0]}` (validation {c[1]:.4f}, "
            f"holdout {c[2]:.4f})."
        )
    lines += [
        "",
        "## Reading these numbers",
        "",
        "* Experiment B is easier than reality on purpose: the simulation has no",
        "  regime break, so its holdout is far better than the real one. Do not",
        "  compare B's absolute WAPE with A's.",
        "* A's holdout is depressed by the real 2020-01-06 collection collapse, so",
        "  a large holdout gain in C is partly the model being less reactive to",
        "  that break, not proof that synthetic data is better.",
        "* C validates worse than A on several candidates while holding out",
        "  better. That trade-off is the finding, and it is not a decision to",
        "  change production.",
        "* Full per-horizon numbers (7/30/90 days, MAE/RMSE/WAPE) are in",
        "  `experiment_results.csv`.",
        "",
    ]
    (OUT / "SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    real_weekly = load_weekly(DATA / "processed" / "cash_flow_weekly.csv")
    real_daily = load_daily(DATA / "processed" / "cash_flow_daily.csv")
    synth_weekly, synth_daily = load_synthetic()
    real_invoices = pd.read_csv(DATA / "processed" / "flowcred_cleaned.csv")
    synth_invoices = pd.read_csv(DATA / "raw" / "synthetic" / "synthetic_invoices.csv").rename(
        columns={"currency": "invoice_currency"}
    )

    results: list[dict] = []
    detail: dict[str, object] = {}

    for currency in CURRENCIES:
        print(f"\n=== {currency} ===")

        # ---- A: real only --------------------------------------------------
        print("  A. real-only")
        real_series = build_series(currency, real_weekly, real_daily)
        a = evaluate(
            real_series,
            list(range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1)),
            list(range(H.FIRST_HOLDOUT_ORIGIN, H.LAST_HOLDOUT_ORIGIN + 1)),
            "A",
            real_invoices,
        )
        detail.setdefault("A", {})[currency] = a

        # ---- B: synthetic only --------------------------------------------
        print("  B. synthetic-only")
        synth_series = build_series(currency, synth_weekly, synth_daily)
        b_val, b_hold = latest_origins(len(synth_series))
        b = evaluate(synth_series, b_val, b_hold, "B", synth_invoices)
        detail.setdefault("B", {})[currency] = b

        # ---- C: synthetic prefix + real ------------------------------------
        print("  C. synthetic-prefix + real")
        real_cur = real_weekly.loc[real_weekly["currency"] == currency].sort_values("week_start")
        real_mean = float(real_cur["collections"].mean())
        sw = synth_weekly.loc[synth_weekly["currency"] == currency].copy()
        sd = synth_daily.loc[synth_daily["currency"] == currency].copy()
        real_first_day = min(real_daily.loc[real_daily["currency"] == currency, "date"])
        sw, sd, scale = shift_prefix(sw, sd, real_first_day, real_mean)

        combined_weekly = pd.concat(
            [
                sw.assign(currency=currency),
                real_cur.assign(currency=currency),
            ],
            ignore_index=True,
        )
        combined_daily = pd.concat(
            [sd.assign(currency=currency), real_daily.loc[real_daily["currency"] == currency]],
            ignore_index=True,
        ).sort_values("date")
        combined = build_series(currency, combined_weekly, combined_daily)
        offset = len(sw)

        c = evaluate(
            combined,
            [offset + i for i in range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1)],
            [offset + i for i in range(H.FIRST_HOLDOUT_ORIGIN, H.LAST_HOLDOUT_ORIGIN + 1)],
            "C",
            real_invoices,
        )
        detail.setdefault("C", {})[currency] = c
        detail.setdefault("meta", {}).setdefault(currency, {})["prefix_scale"] = round(scale, 4)

        # ---- collect -------------------------------------------------------
        for experiment, payload in (("A", a), ("B", b), ("C", c)):
            for cand_name, metrics in payload.items():
                for scope in ("weekly", "h7", "h30", "h90"):
                    for partition in ("validation", "holdout"):
                        stats = metrics[partition][scope]
                        results.append(
                            {
                                "experiment": experiment,
                                "currency": currency,
                                "candidate": cand_name,
                                "partition": partition,
                                "scope": scope,
                                "n": stats.get("n"),
                                "mae": stats.get("mae"),
                                "rmse": stats.get("rmse"),
                                "wape": stats.get("wape"),
                            }
                        )

    frame = pd.DataFrame(results)
    frame.to_csv(OUT / "experiment_results.csv", index=False)
    (OUT / "experiment_detail.json").write_text(
        json.dumps(detail, indent=2, default=str) + "\n", encoding="utf-8"
    )

    # ---- summary -----------------------------------------------------------
    write_summary(frame)

    print(f"\nwrote {OUT.relative_to(ROOT)}/{{experiment_results.csv,SUMMARY.md,experiment_detail.json}}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
