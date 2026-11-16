#!/usr/bin/env python3
"""Compress the recorded Model 4 evidence into one compact diagnostics file.

The dashboard needs per-candidate, per-scope, per-origin and per-step numbers to
show *why* a model was selected. The raw backtest file is ~417 KB; the
aggregates here are a few tens of kilobytes and are pure re-expression of the
same committed records — nothing is recomputed or re-tuned.

Writes:
    reports/cash_flow/diagnostics.json
    frontend/public/demo-data/cashflow-diagnostics.json

Run from the repository root:

    backend/.venv/bin/python backend/scripts/export_cashflow_diagnostics.py
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

REPORTS = ROOT / "reports" / "cash_flow"
SYNTH = ROOT / "reports" / "cash_flow_synthetic"
MODELS = ROOT / "models"
DATA = ROOT / "data" / "processed"

OUT_REPORT = REPORTS / "diagnostics.json"
OUT_DEMO = ROOT / "frontend" / "public" / "demo-data" / "cashflow-diagnostics.json"

CURRENCIES = ("USD", "CAD")
SCOPES = ("weekly", "h7", "h30", "h90")


def _num(value):
    value = float(value)
    return None if not np.isfinite(value) else round(value, 6)


def _candidates(comparison: pd.DataFrame, currency: str) -> list[dict]:
    rows = comparison[comparison["currency"] == currency]
    selected = rows.loc[rows["selected"] == True, "candidate"]  # noqa: E712
    selected_name = str(selected.iloc[0]) if len(selected) else None

    out: list[dict] = []
    for name in dict.fromkeys(rows["candidate"]):
        scopes = {}
        for scope in SCOPES:
            match = rows[(rows["candidate"] == name) & (rows["scope"] == scope)]
            if match.empty:
                continue
            row = match.iloc[0]
            scopes[scope] = {
                "mae": _num(row["mae"]),
                "rmse": _num(row["rmse"]),
                "wape": _num(row["wape"]),
                "holdoutWape": _num(row["holdout_wape"]),
                "n": int(row["n"]) if pd.notna(row["n"]) else None,
            }
        out.append(
            {
                "model": name,
                "selected": name == selected_name,
                "scopes": scopes,
                "originsBeatingNaive": int(rows[rows["candidate"] == name]["origins_beating_naive"].iloc[0]),
            }
        )
    out.sort(key=lambda c: (c["scopes"].get("weekly", {}).get("wape") or 9e9))
    return out


def _per_origin(folds: pd.DataFrame, currency: str) -> dict[str, list[dict]]:
    validation = folds[(folds["currency"] == currency) & (folds["fold_set"] == "validation")]
    out: dict[str, list[dict]] = {}
    for name, group in validation.groupby("candidate"):
        rows = []
        for (origin, as_of), part in group.groupby(["origin_index", "as_of"]):
            denominator = float(np.abs(part["actual"]).sum())
            wape = float(np.abs(part["error"]).sum() / denominator) if denominator else None
            rows.append({"origin": int(origin), "asOf": str(as_of), "wape": _num(wape) if wape else None})
        out[name] = sorted(rows, key=lambda r: r["origin"])
    return out


def _residuals(folds: pd.DataFrame, currency: str) -> dict[str, list[dict]]:
    validation = folds[(folds["currency"] == currency) & (folds["fold_set"] == "validation")]
    out: dict[str, list[dict]] = {}
    for name, group in validation.groupby("candidate"):
        rows = []
        for step, part in group.groupby("step"):
            errors = part["error"].to_numpy(dtype=float)
            scale = float(np.abs(part["actual"]).mean()) or 1.0
            rows.append(
                {
                    "step": int(step),
                    "mae": _num(np.mean(np.abs(errors))),
                    "p10": _num(np.percentile(errors, 10)),
                    "p50": _num(np.percentile(errors, 50)),
                    "p90": _num(np.percentile(errors, 90)),
                    "normalised": _num(np.mean(np.abs(errors)) / scale),
                }
            )
        out[name] = sorted(rows, key=lambda r: r["step"])
    return out


def _holdout(folds: pd.DataFrame, currency: str) -> list[dict]:
    hold = folds[(folds["currency"] == currency) & (folds["fold_set"] == "holdout")]
    naive = hold[hold["candidate"] == "seasonal_naive"]
    out = []
    for (origin, as_of), part in naive.groupby(["origin_index", "as_of"]):
        denominator = float(np.abs(part["actual"]).sum())
        out.append(
            {
                "origin": int(origin),
                "asOf": str(as_of),
                "actual": _num(float(np.abs(part["actual"]).sum())),
                "wapeNaive": _num(float(np.abs(part["error"]).sum() / denominator)) if denominator else None,
            }
        )
    return sorted(out, key=lambda r: r["origin"])


def _weekday_shares(currency: str) -> list[float]:
    path = DATA / "cash_flow_daily.csv"
    if not path.exists():
        return []
    daily = pd.read_csv(path)
    daily = daily[(daily["currency"] == currency) & (daily["is_complete"])]
    if daily.empty:
        return []
    by_dow = (
        daily.assign(dow=pd.to_datetime(daily["date"]).dt.weekday)
        .groupby("dow")["collections"]
        .sum()
    )
    total = float(by_dow.sum()) or 1.0
    return [round(float(by_dow.get(i, 0.0)) / total, 4) for i in range(7)]


def _research() -> dict:
    """Experiment headline table, read from the recorded outputs only."""
    out: dict[str, object] = {"experiments": []}
    e_path = SYNTH / "experiment_e_metrics.json"
    d_path = SYNTH / "experiment_d_verdicts.json"

    out["experiments"].append(
        {"id": "A", "question": "Real data only", "detail": "Recorded production baseline"}
    )
    b_path = SYNTH / "experiment_results.csv"
    if b_path.exists():
        b = pd.read_csv(b_path)
        for currency in CURRENCIES:
            sub = b[(b.experiment == "B") & (b.currency == currency) & (b.partition == "validation") & (b.scope == "weekly")]
            if not sub.empty:
                best = sub.sort_values("wape").iloc[0]
                out.setdefault("syntheticOnly", {})[currency] = {
                    "model": best["candidate"],
                    "wape": _num(best["wape"]),
                }
    out["experiments"].append(
        {
            "id": "B",
            "question": "Synthetic data only",
            "detail": "Measures the simulator, not the business",
        }
    )
    out["experiments"].append(
        {
            "id": "C",
            "question": "Synthetic prefix + real",
            "detail": "Holdout improved, validation mixed",
        }
    )

    if d_path.exists():
        d = json.loads(d_path.read_text())
        out["mlp"] = {
            currency: {
                "realOnly": d[currency]["d0_validation_wape"],
                "pretrained": d[currency]["d1_validation_wape"],
                "relative": d[currency]["relative_improvement"],
                "verdict": d[currency]["verdict"],
                "production": d[currency]["production_reference_wape"],
            }
            for currency in CURRENCIES
            if currency in d
        }
        out["experiments"].append(
            {
                "id": "D",
                "question": "MLP synthetic pretraining",
                "detail": "Large gain over real-only MLP, still behind production",
            }
        )

    if e_path.exists():
        e = json.loads(e_path.read_text())
        out["augmentation"] = e.get("verdicts", {})
        out["transition"] = e.get("transition", {})
        out["experiments"].append(
            {
                "id": "E",
                "question": "Augmentation for XGBoost / ETS / ARIMA",
                "detail": "Helps CAD weighted-combined only; hurts USD XGBoost",
            }
        )
    return out


def main() -> int:
    comparison = pd.read_csv(REPORTS / "model_comparison.csv")
    folds = pd.read_csv(REPORTS / "backtest_folds.csv")
    metadata = json.loads((MODELS / "cash_flow_model_metadata.json").read_text())
    decisions = {d["currency"]: d for d in metadata.get("decisions", [])}

    payload: dict[str, object] = {
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "available": True,
        "source": "Recorded Model 4 backtest outputs (reports/cash_flow, reports/cash_flow_synthetic)",
        "note": "Aggregated from committed records. No model was retrained to produce this file.",
        "scopes": list(SCOPES),
        "currencies": {},
        "research": _research(),
    }

    for currency in CURRENCIES:
        decision = decisions.get(currency, {})
        payload["currencies"][currency] = {  # type: ignore[index]
            "candidates": _candidates(comparison, currency),
            "decision": {
                "selected": decision.get("selected"),
                "kind": decision.get("kind"),
                "baseline": decision.get("baseline"),
                "baselineWape": _num(decision.get("baseline_wape")) if decision.get("baseline_wape") is not None else None,
                "selectedWape": _num(decision.get("selected_wape")) if decision.get("selected_wape") is not None else None,
                "thresholdWape": _num(decision.get("threshold_wape")) if decision.get("threshold_wape") is not None else None,
                "reason": decision.get("reason"),
                "rule": metadata.get("selection_rule"),
            },
            "perOrigin": _per_origin(folds, currency),
            "residuals": _residuals(folds, currency),
            "holdout": _holdout(folds, currency),
            "weekdayShares": _weekday_shares(currency),
            "horizonIntervals": decision.get("horizon_intervals", {}),
        }

    text = json.dumps(payload, indent=2, default=str) + "\n"
    OUT_REPORT.write_text(text, encoding="utf-8")
    OUT_DEMO.parent.mkdir(parents=True, exist_ok=True)
    OUT_DEMO.write_text(text, encoding="utf-8")
    size = len(text.encode()) / 1024
    print(f"wrote {OUT_REPORT.relative_to(ROOT)} ({size:.1f} KiB)")
    print(f"wrote {OUT_DEMO.relative_to(ROOT)} ({size:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
