#!/usr/bin/env python3
"""Render Model 4 evaluation plots from the recorded backtest folds.

Reads only ``reports/cash_flow/backtest_folds.csv`` and
``reports/cash_flow/model_comparison.csv`` so every figure is traceable to the
same numbers the report quotes.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/make_cashflow_plots.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "reports" / "cash_flow"
sys.path.insert(0, str(ROOT / "backend"))

from app import forecasting  # noqa: E402

SELECTED = {"USD": "xgboost_daily", "CAD": "arima"}
COLORS = {"USD": "#2675D8", "CAD": "#16A085"}


def plot_candidate_wape(comparison: pd.DataFrame) -> None:
    weekly = comparison[comparison["scope"] == "weekly"]
    candidates = list(dict.fromkeys(weekly["candidate"]))
    fig, ax = plt.subplots(figsize=(9, 4.2))
    width = 0.38
    x = np.arange(len(candidates))
    for offset, currency in ((-width / 2, "USD"), (width / 2, "CAD")):
        values = [
            float(weekly[(weekly["currency"] == currency) & (weekly["candidate"] == c)]["wape"].iloc[0])
            for c in candidates
        ]
        ax.bar(x + offset, values, width, label=currency, color=COLORS[currency])
    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("_", "\n") for c in candidates], fontsize=8)
    ax.set_ylabel("Weekly-path WAPE (lower is better)")
    ax.set_title("Model 4 — chronological validation WAPE by candidate")
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=0.3)
    ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(REPORTS / "candidate_wape.png", dpi=150)
    plt.close(fig)


def plot_residuals_by_step(folds: pd.DataFrame) -> None:
    if "fold_set" in folds.columns:
        folds = folds[folds["fold_set"] == "validation"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4), sharey=True)
    for ax, currency in zip(axes, ("USD", "CAD")):
        data = folds[(folds["currency"] == currency) & (folds["candidate"] == SELECTED[currency])]
        grouped = data.groupby("step")["error"]
        med = grouped.median()
        lo = grouped.quantile(0.1)
        hi = grouped.quantile(0.9)
        ax.fill_between(med.index, lo, hi, alpha=0.25, color=COLORS[currency])
        ax.plot(med.index, med, marker="o", markersize=3, color=COLORS[currency])
        ax.axhline(0, color="#667085", linewidth=0.8)
        ax.set_title(f"{currency} — {SELECTED[currency]} residual by step")
        ax.set_xlabel("weeks ahead")
        ax.grid(alpha=0.3)
        ax.set_axisbelow(True)
    axes[0].set_ylabel("actual − predicted")
    fig.tight_layout()
    fig.savefig(REPORTS / "residuals_by_step.png", dpi=150)
    plt.close(fig)


def plot_forecast_vs_actual() -> None:
    forecasting.load_forecast_models()
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    for ax, currency in zip(axes, ("USD", "CAD")):
        payload = forecasting.build_forecast_payload(currency, 90)
        history = payload["historical"]
        weeks = [h["weekStart"] for h in history]
        actual = [h["actual"] for h in history]
        f_weeks = [w["weekStart"] for w in payload["weekly"]]
        predicted = [w["predicted"] for w in payload["weekly"]]
        lower = [w["lower"] for w in payload["weekly"]]
        upper = [w["upper"] for w in payload["weekly"]]

        idx = np.arange(len(weeks) + len(f_weeks))
        ax.plot(idx[: len(weeks)], actual, color="#123B67", label="observed")
        ax.plot(idx[len(weeks) - 1 :], [actual[-1]] + predicted, color=COLORS[currency], linestyle="--", label="forecast")
        ax.fill_between(
            idx[len(weeks) - 1 :],
            [lower[0]] + lower,
            [upper[0]] + upper,
            color=COLORS[currency],
            alpha=0.15,
            label="backtest interval",
        )
        ax.set_title(f"{currency} — 90-day forecast from {payload['asOf']}")
        ax.set_ylabel("collections")
        ax.ticklabel_format(axis="y", style="sci", scilimits=(6, 6))
        ax.set_xticks([])
        ax.legend(frameon=False, fontsize=8)
        ax.grid(alpha=0.3)
        ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(REPORTS / "forecast_vs_history.png", dpi=150)
    plt.close(fig)


def main() -> int:
    comparison = pd.read_csv(REPORTS / "model_comparison.csv")
    folds = pd.read_csv(REPORTS / "backtest_folds.csv")
    plot_candidate_wape(comparison)
    plot_residuals_by_step(folds)
    plot_forecast_vs_actual()
    for name in ("candidate_wape.png", "residuals_by_step.png", "forecast_vs_history.png"):
        print(f"wrote reports/cash_flow/{name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
