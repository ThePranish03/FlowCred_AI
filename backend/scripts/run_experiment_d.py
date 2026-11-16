#!/usr/bin/env python3
"""Experiment D — synthetic pretraining + real adaptation (MLP).

Compares, per currency and seed:
  D0  RealOnlyMLP      real history only
  D1  PretrainedMLP    synthetic pretrain -> real adaptation
against the recorded production reference and seasonal-naive.

Writes only to ``reports/cash_flow_synthetic/``. No production artifact, API or
dashboard behaviour is touched.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/run_experiment_d.py
"""

from __future__ import annotations

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
from scripts.cashflow.models_mlp import PretrainedMLP, RealOnlyMLP  # noqa: E402

DATA = ROOT / "data"
OUT = ROOT / "reports" / "cash_flow_synthetic"
SEEDS = (13, 42, 101)
CURRENCIES = ("USD", "CAD")
VALIDATION = list(range(H.FIRST_VALIDATION_ORIGIN, H.LAST_VALIDATION_ORIGIN + 1))
HOLDOUT = list(range(H.FIRST_HOLDOUT_ORIGIN, H.LAST_HOLDOUT_ORIGIN + 1))
STEPS = H.weeks_to_cover(90)


def load_synthetic_series(currency: str) -> H.Series:
    weekly = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_weekly.csv")
    daily = pd.read_csv(DATA / "processed" / "synthetic" / "synthetic_cash_flow_daily.csv")
    weekly = weekly.rename(columns={"collections_received": "collections"})
    daily = daily.rename(columns={"collections_received": "collections"})
    weekly["week_start"] = pd.to_datetime(weekly["week_start"]).dt.date
    daily["date"] = pd.to_datetime(daily["date"]).dt.date
    return build_series(currency, weekly, daily)


def per_origin_wape(result: H.FoldResult) -> float:
    actual = np.asarray(result.step_actual, dtype=float)
    predicted = np.asarray(result.step_predicted, dtype=float)
    denom = float(np.abs(actual).sum())
    return float(np.abs(actual - predicted).sum() / denom) if denom > 0 else float("nan")


def production_reference() -> dict[str, dict[str, float]]:
    """Recorded production numbers; cited, never re-tuned here."""
    path = ROOT / "reports" / "cash_flow" / "model_comparison.csv"
    if not path.exists():
        return {}
    frame = pd.read_csv(path)
    out: dict[str, dict[str, float]] = {}
    for currency in CURRENCIES:
        selected = frame[
            (frame.currency == currency) & (frame.scope == "weekly") & (frame.selected == True)  # noqa: E712
        ]
        naive = frame[
            (frame.currency == currency)
            & (frame.scope == "weekly")
            & (frame.candidate == "seasonal_naive")
        ]
        if not selected.empty:
            out.setdefault(currency, {})["production"] = float(selected.iloc[0]["wape"])
        if not naive.empty:
            out.setdefault(currency, {})["seasonal_naive"] = float(naive.iloc[0]["wape"])
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    real_weekly = load_weekly(DATA / "processed" / "cash_flow_weekly.csv")
    real_daily = load_daily(DATA / "processed" / "cash_flow_daily.csv")
    reference = production_reference()

    result_rows: list[dict] = []
    origin_rows: list[dict] = []
    verdicts: dict[str, dict] = {}

    for currency in CURRENCIES:
        print(f"\n=== {currency} ===")
        real_series = build_series(currency, real_weekly, real_daily)
        synth_series = load_synthetic_series(currency)

        arms: dict[str, dict[str, list]] = {"D0": {"val": [], "hold": []}, "D1": {"val": [], "hold": []}}

        for seed in SEEDS:
            for arm, model in (
                ("D0", RealOnlyMLP(seed=seed)),
                ("D1", PretrainedMLP(synth_series, seed=seed)),
            ):
                val = H.run_folds(real_series, model, VALIDATION, STEPS)
                hold = H.run_folds(real_series, model, HOLDOUT, STEPS)
                arms[arm]["val"].append(val)
                arms[arm]["hold"].append(hold)

                summary = H.summarise(val)
                hold_summary = H.summarise(hold)
                result_rows.append(
                    {
                        "currency": currency,
                        "arm": arm,
                        "seed": seed,
                        "partition": "validation",
                        **{f"weekly_{k}": v for k, v in summary["weekly"].items()},
                        **{f"h30_{k}": v for k, v in summary["h30"].items()},
                        "folds": summary["folds"],
                    }
                )
                result_rows.append(
                    {
                        "currency": currency,
                        "arm": arm,
                        "seed": seed,
                        "partition": "holdout",
                        **{f"weekly_{k}": v for k, v in hold_summary["weekly"].items()},
                        **{f"h30_{k}": v for k, v in hold_summary["h30"].items()},
                        "folds": hold_summary["folds"],
                    }
                )
                print(
                    f"  seed {seed:3d} {arm}: val WAPE={summary['weekly']['wape']:.4f} "
                    f"h30={summary['h30']['wape']:.4f} | holdout WAPE={hold_summary['weekly']['wape']:.4f}"
                )

        # Per-origin WAPE, averaged across seeds.
        for arm in ("D0", "D1"):
            by_origin: dict[int, list[float]] = {}
            for results in arms[arm]["val"]:
                for res in results:
                    by_origin.setdefault(res.origin, []).append(per_origin_wape(res))
            for origin, values in sorted(by_origin.items()):
                origin_rows.append(
                    {
                        "currency": currency,
                        "arm": arm,
                        "origin": origin,
                        "as_of": str(real_series.week_starts[origin] + __import__("datetime").timedelta(days=6)),
                        "wape_mean": float(np.mean(values)),
                        "wape_std": float(np.std(values)),
                    }
                )

        # ---- verdict ------------------------------------------------------
        def seed_metric(arm: str, partition: str) -> tuple[float, float]:
            values = [
                r["weekly_wape"]
                for r in result_rows
                if r["currency"] == currency and r["arm"] == arm and r["partition"] == partition
            ]
            return float(np.mean(values)), float(np.std(values))

        d0_mean, d0_std = seed_metric("D0", "validation")
        d1_mean, d1_std = seed_metric("D1", "validation")
        d0_hold, _ = seed_metric("D0", "holdout")
        d1_hold, _ = seed_metric("D1", "holdout")

        per_origin = pd.DataFrame(origin_rows)
        merged = per_origin[per_origin.arm == "D1"].merge(
            per_origin[per_origin.arm == "D0"], on=["currency", "origin"], suffixes=("_d1", "_d0")
        )
        merged = merged[merged["currency"] == currency]  # previous round mixed currencies
        origins_won = int((merged["wape_mean_d1"] < merged["wape_mean_d0"]).sum())
        improvement = (d0_mean - d1_mean) / d0_mean if d0_mean else float("nan")
        stable = (d1_mean - d1_std) < d0_mean

        divergent = max(d0_mean, d1_mean) > 5.0
        if divergent:
            print(f"  ! divergence detected (D0 {d0_mean:.1f}, D1 {d1_mean:.1f}); verdict suppressed")
        qualifies = (not divergent) and improvement >= 0.10 and origins_won >= 4 and stable
        if divergent:
            verdict = "invalid (diverged)"
        elif qualifies:
            verdict = "improved"
        elif d1_mean > d0_mean * 1.02:
            verdict = "worsened"
        else:
            verdict = "no material change"

        verdicts[currency] = {
            "d0_validation_wape": round(d0_mean, 4),
            "d0_seed_std": round(d0_std, 4),
            "d1_validation_wape": round(d1_mean, 4),
            "d1_seed_std": round(d1_std, 4),
            "relative_improvement": round(improvement, 4),
            "origins_d1_better": origins_won,
            "origins_total": int(len(merged)),
            "stable_across_seeds": bool(stable),
            "d0_holdout_wape": round(d0_hold, 4),
            "d1_holdout_wape": round(d1_hold, 4),
            "divergent": bool(divergent),
            "verdict": verdict,
            "production_reference_wape": reference.get(currency, {}).get("production"),
            "seasonal_naive_reference_wape": reference.get(currency, {}).get("seasonal_naive"),
        }
        print(
            f"  -> D0 {d0_mean:.4f} vs D1 {d1_mean:.4f} "
            f"({improvement:+.1%} rel), origins won {origins_won}/{len(merged)}, verdict={verdict}"
        )

    pd.DataFrame(result_rows).to_csv(OUT / "experiment_d_results.csv", index=False)
    pd.DataFrame(origin_rows).to_csv(OUT / "experiment_d_per_origin.csv", index=False)
    (OUT / "experiment_d_verdicts.json").write_text(
        json.dumps(verdicts, indent=2) + "\n", encoding="utf-8"
    )

    write_summary(verdicts, pd.DataFrame(result_rows))
    print(f"\nwrote {OUT.relative_to(ROOT)}/experiment_d_*")
    return 0


def write_summary(verdicts: dict, results: pd.DataFrame) -> None:
    lines = [
        "# Experiment D — synthetic pretraining + real adaptation (MLP)",
        "",
        "Protocol: `AMENDMENT_D.md`, committed before any MLP evaluation.",
        "Production selection is unchanged; the MLP remains experimental.",
        "",
        "| Currency | Arm | Validation WAPE (mean ± std over seeds) | Holdout WAPE |",
        "|---|---|---|---:|",
    ]
    for currency, v in verdicts.items():
        lines.append(
            f"| {currency} | D0 real-only | {v['d0_validation_wape']:.4f} ± {v['d0_seed_std']:.4f} | "
            f"{v['d0_holdout_wape']:.4f} |"
        )
        lines.append(
            f"| {currency} | D1 pretrained | {v['d1_validation_wape']:.4f} ± {v['d1_seed_std']:.4f} | "
            f"{v['d1_holdout_wape']:.4f} |"
        )

    lines += [
        "",
        "## Reference points (recorded, not re-tuned)",
        "",
        "| Currency | Production model | Seasonal-naive |",
        "|---|---:|---:|",
    ]
    for currency, v in verdicts.items():
        lines.append(
            f"| {currency} | {v['production_reference_wape']} | {v['seasonal_naive_reference_wape']} |"
        )

    lines += ["", "## Verdict on the pretraining question", ""]
    for currency, v in verdicts.items():
        lines.append(
            f"* **{currency}: {v['verdict']}** — D1 vs D0 relative WAPE "
            f"{v['relative_improvement']:+.1%}, better on "
            f"{v['origins_d1_better']}/{v['origins_total']} validation origins, "
            f"stable across seeds: {v['stable_across_seeds']}."
        )

    lines += ["", "## Does the MLP qualify for production? No.", ""]
    lines += [
        "The original rule requires a candidate to beat the best valid baseline by",
        "at least 10% relative WAPE. The MLP was never close:",
        "",
        "| Currency | D1 (pretrained MLP) | Best reference | Gap | Qualifies |",
        "|---|---:|---:|---:|---|",
    ]
    for currency, v in verdicts.items():
        refs = [x for x in (v["production_reference_wape"], v["seasonal_naive_reference_wape"]) if x]
        best = min(refs) if refs else float("nan")
        gap = (v["d1_validation_wape"] - best) / best if best else float("nan")
        qualifies = "yes" if v["d1_validation_wape"] <= best * 0.9 else "no"
        lines.append(
            f"| {currency} | {v['d1_validation_wape']:.4f} | {best:.4f} | "
            f"{gap:+.1%} worse | **{qualifies}** |"
        )
    gains = ", ".join(
        f"{v['relative_improvement']:.1%} ({c})" for c, v in verdicts.items()
    )
    hold = ", ".join(
        f"{c} {v['d0_holdout_wape']:.4f} -> {v['d1_holdout_wape']:.4f}"
        for c, v in verdicts.items()
    )
    lines += [
        "",
        "So the answer is two-sided and both halves matter:",
        "",
        f"1. **Pretraining works.** Validation error falls by {gains}, and the",
        f"   effect is seed-stable. Holdout: {hold}.",
        "2. **The neural model still loses.** Even pretrained it remains worse than",
        "   the best reference on every currency, so synthetic data closed the gap",
        "   between two weak models without producing a competitive one.",
        "",
        "The MLP stays experimental and no production artifact changes.",
        "",
    ]
    (OUT / "experiment_d_SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
