#!/usr/bin/env python3
"""Generate, validate and persist the synthetic FlowCred AI dataset.

Writes only to ``data/raw/synthetic/`` and ``data/processed/synthetic/``. The
real dataset and every existing model artifact are left untouched.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/generate_synthetic_data.py
    backend/.venv/bin/python backend/scripts/generate_synthetic_data.py --seed 7 --invoices 5000
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from scripts.synthetic.generator import (  # noqa: E402
    GeneratorConfig,
    SyntheticFinancialDataGenerator,
)
from scripts.synthetic.targets import (  # noqa: E402
    build_daily_target,
    build_weekly_target,
)
from scripts.synthetic.validation import summarise, validate_dataset  # noqa: E402

RAW_DIR = ROOT / "data" / "raw" / "synthetic"
PROCESSED_DIR = ROOT / "data" / "processed" / "synthetic"

PROTECTED = ROOT / "data" / "processed" / "flowcred_cleaned.csv"


def _fingerprint(frame: pd.DataFrame) -> str:
    """Stable content hash so reproducibility is checkable from the output."""
    digest = hashlib.sha256()
    digest.update(pd.util.hash_pandas_object(frame, index=False).values.tobytes())
    return digest.hexdigest()


def _write(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=GeneratorConfig.seed)
    parser.add_argument("--invoices", type=int, default=GeneratorConfig.n_invoices)
    parser.add_argument("--customers", type=int, default=GeneratorConfig.n_customers)
    parser.add_argument("--months", type=int, default=GeneratorConfig.months)
    parser.add_argument(
        "--skip-validation-exit",
        action="store_true",
        help="Report validation but always exit 0 (used when inspecting bad output).",
    )
    args = parser.parse_args(argv)

    if not PROTECTED.exists():
        print(f"WARNING: protected source not found at {PROTECTED}", file=sys.stderr)

    config = GeneratorConfig(
        seed=args.seed,
        n_invoices=args.invoices,
        n_customers=args.customers,
        months=args.months,
    )
    print(
        f"Generating {config.n_invoices:,} invoices over {config.months} months "
        f"({config.n_customers:,} customers, seed {config.seed}) ..."
    )
    bundle = SyntheticFinancialDataGenerator(config).generate()
    invoices = bundle["invoices"]
    transactions = bundle["transactions"]
    customers = bundle["customers"]
    metadata = bundle["metadata"]

    observation_end = dt.date.fromisoformat(str(metadata["observation_end"]))
    daily = build_daily_target(invoices, transactions, observation_end)
    weekly = build_weekly_target(daily)

    checks = validate_dataset(
        invoices, transactions, customers, metadata, expected_invoices=config.n_invoices
    )
    report = summarise(checks)

    # -- persist ------------------------------------------------------------
    _write(invoices, RAW_DIR / "synthetic_invoices.csv")
    _write(transactions, RAW_DIR / "synthetic_payment_transactions.csv")
    _write(customers, RAW_DIR / "synthetic_customers.csv")
    _write(daily, PROCESSED_DIR / "synthetic_cash_flow_daily.csv")
    _write(weekly, PROCESSED_DIR / "synthetic_cash_flow_weekly.csv")

    metadata.update(
        {
            "files": {
                "invoices": "data/raw/synthetic/synthetic_invoices.csv",
                "transactions": "data/raw/synthetic/synthetic_payment_transactions.csv",
                "customers": "data/raw/synthetic/synthetic_customers.csv",
                "daily_targets": "data/processed/synthetic/synthetic_cash_flow_daily.csv",
                "weekly_targets": "data/processed/synthetic/synthetic_cash_flow_weekly.csv",
            },
            "row_counts": {
                "invoices": int(len(invoices)),
                "transactions": int(len(transactions)),
                "customers": int(len(customers)),
                "daily_rows": int(len(daily)),
                "weekly_rows": int(len(weekly)),
            },
            "content_hash": {
                "invoices": _fingerprint(invoices),
                "transactions": _fingerprint(transactions),
                "customers": _fingerprint(customers),
            },
            "validation": report,
            "notes": [
                "Simulated data, not genuine historical business transactions.",
                "The real dataset data/processed/flowcred_cleaned.csv was not read or modified.",
                "No existing model artifact was regenerated.",
                "Weekly targets exclude the final censoring buffer; see observation_end.",
            ],
        }
    )
    (RAW_DIR / "generation_metadata.json").write_text(
        json.dumps(metadata, indent=2, default=str) + "\n", encoding="utf-8"
    )
    (PROCESSED_DIR / "synthetic_validation.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    # -- report -------------------------------------------------------------
    print("\nFiles")
    for key, rel in metadata["files"].items():
        p = ROOT / rel
        print(f"  {key:14s} {rel}  ({p.stat().st_size / 1024:,.1f} KiB)")

    print("\nShape")
    print(f"  invoices      {len(invoices):,}")
    print(f"  customers     {len(customers):,}")
    print(f"  transactions  {len(transactions):,}")
    print(f"  period        {metadata['simulation_period']['start']} → {metadata['observation_end']}")
    print(f"  currencies    {metadata['currency_distribution']}")
    print(f"  profiles      {metadata['profile_distribution']}")
    print(f"  censored      {metadata['censoring']['censored_invoices']:,} invoices "
          f"({metadata['censoring']['withheld_transactions']:,} withheld payments)")
    print(f"  weekly rows   {len(weekly):,}")

    print(f"\nValidation: {report['passed']} passed, {report['failed']} failed")
    for failure in report["failures"]:
        print(f"  FAIL {failure['check']}: {failure['detail']}")

    if report["failed"] and not args.skip_validation_exit:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
