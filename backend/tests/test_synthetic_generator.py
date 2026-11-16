"""Tests for the synthetic financial dataset generator.

Most tests use a small configuration so the suite stays fast; one test validates
the committed 50,000-invoice artifacts when present.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd
import numpy as np
import pytest

from scripts.synthetic.generator import (
    PROFILE_SHARES,
    PROFILES,
    GeneratorConfig,
    SyntheticFinancialDataGenerator,
    largest_remainder,
)
from scripts.synthetic.targets import build_daily_target, build_weekly_target
from scripts.synthetic.validation import summarise, validate_dataset

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "synthetic"

SMALL = GeneratorConfig(seed=424242, n_invoices=1_200, n_customers=60, months=12)


@pytest.fixture(scope="module")
def small_bundle():
    return SyntheticFinancialDataGenerator(SMALL).generate()


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------
def test_reproducible_with_same_seed():
    a = SyntheticFinancialDataGenerator(SMALL).generate()
    b = SyntheticFinancialDataGenerator(SMALL).generate()
    pd.testing.assert_frame_equal(a["invoices"], b["invoices"])
    pd.testing.assert_frame_equal(a["transactions"], b["transactions"])
    pd.testing.assert_frame_equal(a["customers"], b["customers"])


def test_different_seed_changes_data():
    other = GeneratorConfig(seed=9, n_invoices=1_200, n_customers=60, months=12)
    a = SyntheticFinancialDataGenerator(SMALL).generate()
    b = SyntheticFinancialDataGenerator(other).generate()
    assert not a["invoices"]["invoice_amount"].equals(b["invoices"]["invoice_amount"])


def test_exact_invoice_count_is_enforced():
    cfg = GeneratorConfig(seed=1, n_invoices=777, n_customers=25, months=6)
    bundle = SyntheticFinancialDataGenerator(cfg).generate()
    assert len(bundle["invoices"]) == 777
    assert bundle["invoices"]["invoice_id"].is_unique


def test_largest_remainder_sums_exactly():
    weights = np.array([[0.3, 0.7], [1.2, 0.8]])
    for total in (0, 1, 7, 100, 999):
        out = largest_remainder(weights, total)
        assert int(out.sum()) == total
        assert out.shape == weights.shape


# ---------------------------------------------------------------------------
# Structure and domain
# ---------------------------------------------------------------------------
def test_customer_profiles_and_currencies(small_bundle):
    customers = small_bundle["customers"]
    assert set(customers["payment_profile"]).issubset(set(PROFILES))
    assert set(customers["currency"]).issubset({"USD", "CAD"})
    assert customers["customer_id"].is_unique
    # Profile mix should approximate the configured assumptions.
    shares = customers["payment_profile"].value_counts(normalize=True)
    for profile in PROFILES:
        assert abs(shares.get(profile, 0.0) - PROFILE_SHARES[profile]) < 0.08


def test_invoice_amounts_and_dates_are_valid(small_bundle):
    inv = small_bundle["invoices"]
    assert (inv["invoice_amount"] > 0).all()
    inv_date = pd.to_datetime(inv["invoice_date"])
    due_date = pd.to_datetime(inv["due_date"])
    assert (due_date > inv_date).all()
    assert set(inv["payment_status"]).issubset({"paid", "partially_paid", "open"})
    assert (inv["outstanding_amount"] >= -0.01).all()


# ---------------------------------------------------------------------------
# Ledger reconciliation
# ---------------------------------------------------------------------------
def test_transactions_reconcile_with_invoices(small_bundle):
    inv = small_bundle["invoices"]
    txn = small_bundle["transactions"]
    totals = txn.groupby("invoice_id")["amount_received"].sum()
    received = inv.set_index("invoice_id")["total_amount_received"]
    delta = (totals.reindex(received.index, fill_value=0.0) - received).abs()
    assert delta.max() <= 0.01


def test_partial_payments_produce_multiple_transactions(small_bundle):
    txn = small_bundle["transactions"]
    inv = small_bundle["invoices"]
    multi = txn.groupby("invoice_id").size()
    multi_ids = set(multi[multi > 1].index)
    assert multi_ids, "expected some invoices settled in instalments"

    # A partially paid invoice may have one instalment (rest still owed) or
    # several; either way it must have at least one receipt and a balance.
    partial_rows = inv[inv["payment_status"] == "partially_paid"]
    assert len(partial_rows) > 0
    assert (partial_rows["total_amount_received"] > 0).all()
    assert (partial_rows["outstanding_amount"] > 0).all()
    assert partial_rows["invoice_id"].isin(set(txn["invoice_id"])).all()

    kinds = set(txn["transaction_type"])
    assert {"full_payment", "partial_payment", "final_payment"}.issubset(kinds)


def test_transaction_ids_unique_and_currency_consistent(small_bundle):
    txn = small_bundle["transactions"]
    inv = small_bundle["invoices"]
    assert txn["transaction_id"].is_unique
    merged = txn.merge(inv[["invoice_id", "currency"]], on="invoice_id", suffixes=("", "_inv"))
    assert (merged["currency"] == merged["currency_inv"]).all()


# ---------------------------------------------------------------------------
# Right-censoring
# ---------------------------------------------------------------------------
def test_no_payments_after_the_observation_window(small_bundle):
    metadata = small_bundle["metadata"]
    obs_end = pd.Timestamp(metadata["observation_end"])
    txn = small_bundle["transactions"]
    assert pd.to_datetime(txn["payment_date"]).max() <= obs_end


def test_recent_unsettled_invoices_are_censored_not_unpaid(small_bundle):
    inv = small_bundle["invoices"]
    metadata = small_bundle["metadata"]
    obs_end = dt.date.fromisoformat(str(metadata["observation_end"]))
    recent = inv[
        (inv["payment_status"] != "paid")
        & (pd.to_datetime(inv["due_date"]) > pd.Timestamp(obs_end - dt.timedelta(days=90)))
    ]
    assert len(recent) > 0
    assert recent["is_censored"].all()
    assert not inv.loc[inv["is_censored"], "is_complete"].any()


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------
def test_weekly_target_matches_daily_sums(small_bundle):
    inv = small_bundle["invoices"]
    txn = small_bundle["transactions"]
    obs_end = dt.date.fromisoformat(str(small_bundle["metadata"]["observation_end"]))
    daily = build_daily_target(inv, txn, obs_end)
    weekly = build_weekly_target(daily)
    for currency in daily["currency"].unique():
        d_sum = daily.loc[daily["currency"] == currency, "collections_received"].sum()
        w_sum = weekly.loc[weekly["currency"] == currency, "collections_received"].sum()
        assert w_sum <= d_sum + 0.01
        # Only whole weeks are emitted.
        assert len(weekly.loc[weekly["currency"] == currency]) * 7 <= len(
            daily.loc[daily["currency"] == currency]
        )


def test_zero_collection_days_exist(small_bundle):
    inv = small_bundle["invoices"]
    txn = small_bundle["transactions"]
    obs_end = dt.date.fromisoformat(str(small_bundle["metadata"]["observation_end"]))
    daily = build_daily_target(inv, txn, obs_end)
    assert (daily["collections_received"] == 0).sum() > 0, "expected genuine zero days (weekends)"


# ---------------------------------------------------------------------------
# Validation contract
# ---------------------------------------------------------------------------
def test_validation_passes_for_a_clean_generation(small_bundle):
    report = summarise(
        validate_dataset(
            small_bundle["invoices"],
            small_bundle["transactions"],
            small_bundle["customers"],
            small_bundle["metadata"],
            expected_invoices=SMALL.n_invoices,
        )
    )
    assert report["ok"], report["failures"]


def test_validation_detects_broken_reconciliation(small_bundle):
    txn = small_bundle["transactions"].copy()
    txn.loc[txn.index[0], "amount_received"] += 100.0
    report = summarise(
        validate_dataset(
            small_bundle["invoices"],
            txn,
            small_bundle["customers"],
            small_bundle["metadata"],
            expected_invoices=SMALL.n_invoices,
        )
    )
    assert not report["ok"]
    assert any(f["check"] == "payment_reconciliation" for f in report["failures"])


def test_validation_detects_wrong_invoice_count(small_bundle):
    report = summarise(
        validate_dataset(
            small_bundle["invoices"],
            small_bundle["transactions"],
            small_bundle["customers"],
            small_bundle["metadata"],
            expected_invoices=SMALL.n_invoices + 1,
        )
    )
    assert any(f["check"] == "invoice_count" for f in report["failures"])


def test_validation_detects_leaked_future_payment(small_bundle):
    metadata = dict(small_bundle["metadata"])
    obs_end = dt.date.fromisoformat(str(metadata["observation_end"]))
    txn = small_bundle["transactions"].copy()
    txn.loc[txn.index[0], "payment_date"] = obs_end + dt.timedelta(days=5)
    report = summarise(
        validate_dataset(
            small_bundle["invoices"], txn, small_bundle["customers"], metadata,
            expected_invoices=SMALL.n_invoices,
        )
    )
    assert any(f["check"] == "no_payments_after_window" for f in report["failures"])


# ---------------------------------------------------------------------------
# Committed artifacts
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    not (RAW / "synthetic_invoices.csv").exists(), reason="synthetic dataset not generated"
)
def test_committed_dataset_is_valid():
    invoices = pd.read_csv(RAW / "synthetic_invoices.csv")
    transactions = pd.read_csv(RAW / "synthetic_payment_transactions.csv")
    customers = pd.read_csv(RAW / "synthetic_customers.csv")
    metadata = json.loads((RAW / "generation_metadata.json").read_text())

    assert len(invoices) == 50_000
    assert invoices["invoice_id"].is_unique
    report = summarise(
        validate_dataset(invoices, transactions, customers, metadata, expected_invoices=50_000)
    )
    assert report["ok"], report["failures"]


# ---------------------------------------------------------------------------
# Leak-free as-of view
# ---------------------------------------------------------------------------
def test_asof_view_hides_later_payments(small_bundle):
    from scripts.synthetic.targets import build_asof_invoice_view

    inv = small_bundle["invoices"]
    txn = small_bundle["transactions"]
    first_payment = pd.to_datetime(txn["payment_date"]).min().date()
    as_of = first_payment - dt.timedelta(days=1)

    view = build_asof_invoice_view(inv, txn, as_of)
    assert (view["received_asof"] == 0).all()
    assert (view["status_asof"] == "open").all()
    assert (pd.to_datetime(view["invoice_date"]) <= pd.Timestamp(as_of)).all()


def test_asof_view_matches_ledger_at_a_later_origin(small_bundle):
    from scripts.synthetic.targets import build_asof_invoice_view

    inv = small_bundle["invoices"]
    txn = small_bundle["transactions"]
    obs_end = dt.date.fromisoformat(str(small_bundle["metadata"]["observation_end"]))

    full = build_asof_invoice_view(inv, txn, obs_end)
    merged = full.merge(
        inv[["invoice_id", "total_amount_received", "payment_status"]], on="invoice_id"
    )
    assert (merged["received_asof"] - merged["total_amount_received"]).abs().max() <= 0.01
    # Any invoice that is fully paid at the window end must reconcile to "paid".
    paid = merged[merged["payment_status"] == "paid"]
    assert (paid["status_asof"] == "paid").all()
