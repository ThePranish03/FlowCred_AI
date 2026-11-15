#!/usr/bin/env python3
"""Offline data preparation for Model 4.

Reads the canonical cleaned invoice extract, builds the invoice-clearance
collection target, and writes the derived daily/weekly series plus a
data-quality report.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/build_cash_flow_dataset.py

Outputs (new files only, nothing existing is modified):
    data/processed/cash_flow_daily.csv
    data/processed/cash_flow_weekly.csv
    reports/cash_flow/data_quality.json
    reports/cash_flow/data_quality.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.cash_flow_target import (  # noqa: E402
    LAST_COMPLETE_WEEK,
    OBSERVED_END,
    OBSERVED_START,
    PROXY_METADATA,
    SUPPORTED_CURRENCIES,
    build_target,
    weekday_shares,
    weekly_from_daily,
)

SOURCE = ROOT / "data" / "processed" / "flowcred_cleaned.csv"
DAILY_OUT = ROOT / "data" / "processed" / "cash_flow_daily.csv"
WEEKLY_OUT = ROOT / "data" / "processed" / "cash_flow_weekly.csv"
REPORT_DIR = ROOT / "reports" / "cash_flow"


def main() -> int:
    if not SOURCE.exists():
        print(f"ERROR: source not found: {SOURCE}", file=sys.stderr)
        return 1

    source = pd.read_csv(SOURCE)
    target, stats = build_target(source, with_stats=True)

    daily = target.copy()
    weekly = weekly_from_daily(target)

    # ---- integrity assertions (fail the build rather than emit bad data) ----
    expected_days = (OBSERVED_END - OBSERVED_START).days + 1
    for ccy in SUPPORTED_CURRENCIES:
        n = int((target["currency"] == ccy).sum())
        if n != expected_days:
            raise AssertionError(f"{ccy}: expected {expected_days} daily rows, got {n}")
    week_counts = weekly.groupby("currency", observed=True)["week_start"].nunique()
    if (week_counts != 61).any():
        raise AssertionError(f"expected 61 complete weeks per currency, got {week_counts.to_dict()}")

    if weekly[["week_start", "currency"]].duplicated().any():
        raise AssertionError("duplicate (week_start, currency) rows in weekly output")

    # Weekly sum must equal the daily sum over complete weeks (no leakage/loss).
    for ccy in SUPPORTED_CURRENCIES:
        daily_sum = float(
            target.loc[
                (target["currency"] == ccy) & (target["is_complete"]), "collections"
            ].sum()
        )
        weekly_sum = float(weekly.loc[weekly["currency"] == ccy, "collections"].sum())
        if abs(daily_sum - weekly_sum) > 0.01:
            raise AssertionError(
                f"{ccy}: weekly sum {weekly_sum} != complete-day sum {daily_sum}"
            )

    DAILY_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    daily.to_csv(DAILY_OUT, index=False)
    weekly.to_csv(WEEKLY_OUT, index=False)

    # ---- series diagnostics ------------------------------------------------
    diagnostics: dict[str, object] = {}
    for ccy in SUPPORTED_CURRENCIES:
        series = weekly.loc[weekly["currency"] == ccy, "collections"].to_numpy(dtype=float)
        daily_series = target.loc[
            target["currency"] == ccy, "collections"
        ].to_numpy(dtype=float)
        diagnostics[ccy] = {
            "weekly_n": int(series.size),
            "weekly_mean": float(series.mean()),
            "weekly_median": float(pd.Series(series).median()),
            "weekly_std": float(series.std(ddof=0)),
            "weekly_cv": float(series.std(ddof=0) / series.mean()) if series.mean() else None,
            "weekly_min": float(series.min()),
            "weekly_max": float(series.max()),
            "weekly_zero_weeks": int((series == 0).sum()),
            "daily_n": int(daily_series.size),
            "daily_zero_days": int((daily_series == 0).sum()),
            "daily_active_days": int((daily_series > 0).sum()),
            "weekday_shares": {str(k): v for k, v in weekday_shares(target, ccy).items()},
            "total_collections": float(daily_series.sum()),
        }

    report = {
        "source_file": str(SOURCE.relative_to(ROOT)),
        "source_rows": int(len(source)),
        "observed_window": {"start": str(OBSERVED_START), "end": str(OBSERVED_END)},
        "complete_weeks": {
            "first": str(LAST_COMPLETE_WEEK - pd.Timedelta(weeks=60)),
            "last": str(LAST_COMPLETE_WEEK),
            "count": 61,
        },
        "excluded_weeks": {
            "2018-12-31": "window starts Thu 2019-01-03; Mon-Wed unobserved",
            "2020-03-09": "window ends Fri 2020-03-13; weekend unobserved",
        },
        "reconciliation": stats.as_dict(),
        "diagnostics": diagnostics,
        "target_contract": PROXY_METADATA,
        "outputs": {
            "daily": str(DAILY_OUT.relative_to(ROOT)),
            "weekly": str(WEEKLY_OUT.relative_to(ROOT)),
        },
    }

    (REPORT_DIR / "data_quality.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    lines = [
        "# Cash-flow data quality report (Model 4)",
        "",
        f"Source: `{report['source_file']}` — {report['source_rows']:,} rows.",
        "",
        f"Observed window: **{OBSERVED_START} → {OBSERVED_END}** "
        f"({expected_days} calendar days).",
        "Complete Monday-start weeks: **61** "
        f"({LAST_COMPLETE_WEEK - pd.Timedelta(weeks=60)} → {LAST_COMPLETE_WEEK}).",
        "Excluded (truncated): 2018-12-31→2019-01-06 and 2020-03-09→2020-03-15.",
        "",
        "## Row reconciliation",
        "",
        "| Filter | Rows dropped |",
        "|---|---:|",
        f"| not `paid` | {stats.dropped_status:,} |",
        f"| currency not USD/CAD | {stats.dropped_currency:,} |",
        f"| missing `payment_date` | {stats.dropped_missing_payment_date:,} |",
        f"| invalid/non-positive amount | {stats.dropped_invalid_amount:,} |",
        f"| `payment_date` outside window | {stats.dropped_outside_window:,} |",
        f"| **retained** | **{stats.used_rows:,}** |",
        "",
        "## Per-currency series",
        "",
        "| Currency | Weekly n | Mean | CV | Zero weeks | Zero days | Active days | Total |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for ccy, d in diagnostics.items():
        lines.append(
            f"| {ccy} | {d['weekly_n']} | {d['weekly_mean']:,.0f} | {d['weekly_cv']:.3f} | "
            f"{d['weekly_zero_weeks']} | {d['daily_zero_days']} | {d['daily_active_days']} | "
            f"{d['total_collections']:,.0f} |"
        )
    lines += [
        "",
        "Zero-collection days are genuine observations and are never forward-filled.",
        "",
        "## Target definition (proxy — not verified cash)",
        "",
        "```",
        str(PROXY_METADATA["target_definition"]),
        "```",
        "",
        "Limitations:",
        "",
    ]
    lines += [f"- {x}" for x in PROXY_METADATA["proxy_limitations"]]  # type: ignore[union-attr]
    lines += [
        "",
        "## Weekday shares (training-window, used for partial-week allocation)",
        "",
        "| Currency | Mon | Tue | Wed | Thu | Fri | Sat | Sun |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for ccy, d in diagnostics.items():
        shares = d["weekday_shares"]
        lines.append(
            f"| {ccy} | " + " | ".join(f"{shares[str(i)]:.3f}" for i in range(7)) + " |"
        )
    lines.append("")
    (REPORT_DIR / "data_quality.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"daily  -> {DAILY_OUT.relative_to(ROOT)} ({len(daily)} rows)")
    print(f"weekly -> {WEEKLY_OUT.relative_to(ROOT)} ({len(weekly)} rows)")
    print(f"report -> {REPORT_DIR.relative_to(ROOT)}/data_quality.{{json,md}}")
    for ccy, d in diagnostics.items():
        print(
            f"  {ccy}: weeks={d['weekly_n']} mean={d['weekly_mean']:,.0f} "
            f"cv={d['weekly_cv']:.3f} zeros_w={d['weekly_zero_weeks']} "
            f"zeros_d={d['daily_zero_days']} total={d['total_collections']:,.0f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
