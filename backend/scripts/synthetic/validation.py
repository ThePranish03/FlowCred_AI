"""Automated validation for the synthetic financial dataset.

Every check returns a structured result rather than raising, so the CLI can
report the full picture in one pass and tests can assert on individual names.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import pandas as pd

REQUIRED_INVOICE_COLUMNS = {
    "invoice_id",
    "customer_id",
    "invoice_date",
    "due_date",
    "invoice_amount",
    "currency",
    "payment_terms",
    "payment_status",
    "total_amount_received",
    "outstanding_amount",
    "customer_payment_profile",
    "source_type",
}

REQUIRED_TRANSACTION_COLUMNS = {
    "transaction_id",
    "invoice_id",
    "payment_date",
    "amount_received",
    "currency",
    "transaction_type",
}

REQUIRED_METADATA_KEYS = {
    "generated_at",
    "generator_version",
    "source_type",
    "random_seed",
    "n_invoices",
    "n_customers",
    "simulation_period",
    "currency_distribution",
    "profile_assumptions",
    "payment_term_assumptions",
    "censoring",
}


@dataclass
class Check:
    name: str
    ok: bool
    detail: str

    def as_dict(self) -> dict[str, object]:
        return {"check": self.name, "ok": self.ok, "detail": self.detail}


def _ok(name: str, detail: str) -> Check:
    return Check(name, True, detail)


def _fail(name: str, detail: str) -> Check:
    return Check(name, False, detail)


def validate_dataset(
    invoices: pd.DataFrame,
    transactions: pd.DataFrame,
    customers: pd.DataFrame,
    metadata: dict[str, object],
    expected_invoices: int = 50_000,
) -> list[Check]:
    checks: list[Check] = []
    obs_end = dt.date.fromisoformat(str(metadata["observation_end"]))

    # -- schema -------------------------------------------------------------
    missing = REQUIRED_INVOICE_COLUMNS - set(invoices.columns)
    checks.append(
        _ok("invoice_schema", "all required columns present")
        if not missing
        else _fail("invoice_schema", f"missing columns: {sorted(missing)}")
    )
    missing = REQUIRED_TRANSACTION_COLUMNS - set(transactions.columns)
    checks.append(
        _ok("transaction_schema", "all required columns present")
        if not missing
        else _fail("transaction_schema", f"missing columns: {sorted(missing)}")
    )

    # -- counts and uniqueness ---------------------------------------------
    checks.append(
        _ok("invoice_count", f"{len(invoices):,} invoices")
        if len(invoices) == expected_invoices
        else _fail("invoice_count", f"expected {expected_invoices:,}, got {len(invoices):,}")
    )
    dup = int(invoices["invoice_id"].duplicated().sum())
    checks.append(
        _ok("invoice_ids_unique", "no duplicate invoice ids")
        if dup == 0
        else _fail("invoice_ids_unique", f"{dup} duplicate invoice ids")
    )
    dup_txn = int(transactions["transaction_id"].duplicated().sum())
    checks.append(
        _ok("transaction_ids_unique", "no duplicate transaction ids")
        if dup_txn == 0
        else _fail("transaction_ids_unique", f"{dup_txn} duplicate transaction ids")
    )
    orphans = int((~transactions["invoice_id"].isin(invoices["invoice_id"])).sum())
    checks.append(
        _ok("transaction_invoice_integrity", "every transaction references a known invoice")
        if orphans == 0
        else _fail("transaction_invoice_integrity", f"{orphans} orphan transactions")
    )
    checks.append(
        _ok("customer_referential_integrity", "every invoice references a known customer")
        if invoices["customer_id"].isin(customers["customer_id"]).all()
        else _fail("customer_referential_integrity", "unknown customer ids on invoices")
    )

    # -- dates --------------------------------------------------------------
    inv_date = pd.to_datetime(invoices["invoice_date"])
    due_date = pd.to_datetime(invoices["due_date"])
    bad_terms = int((due_date <= inv_date).sum())
    checks.append(
        _ok("due_after_invoice", "every due date follows its invoice date")
        if bad_terms == 0
        else _fail("due_after_invoice", f"{bad_terms} invoices with due_date <= invoice_date")
    )
    pay_date = pd.to_datetime(transactions["payment_date"])
    checks.append(
        _ok("payment_dates_parse", "all payment dates parse")
        if pay_date.notna().all()
        else _fail("payment_dates_parse", f"{int(pay_date.isna().sum())} unparseable payment dates")
    )
    merged = transactions.merge(
        invoices[["invoice_id", "invoice_date"]], on="invoice_id", how="left"
    )
    before_issue = int(
        (pd.to_datetime(merged["payment_date"]) < pd.to_datetime(merged["invoice_date"])).sum()
    )
    checks.append(
        _ok("payment_after_invoice", "no payment predates its invoice")
        if before_issue == 0
        else _fail("payment_after_invoice", f"{before_issue} payments before invoice date")
    )
    after_window = int((pay_date > pd.Timestamp(obs_end)).sum())
    checks.append(
        _ok("no_payments_after_window", f"ledger stops at observation end {obs_end}")
        if after_window == 0
        else _fail("no_payments_after_window", f"{after_window} payments dated after the window")
    )

    # -- currency and amounts ----------------------------------------------
    bad_ccy = sorted(set(invoices["currency"]) - {"USD", "CAD"})
    checks.append(
        _ok("currency_domain", "only USD and CAD present")
        if not bad_ccy
        else _fail("currency_domain", f"unexpected currencies: {bad_ccy}")
    )
    ccy_check = transactions.merge(
        invoices[["invoice_id", "currency"]], on="invoice_id", suffixes=("", "_inv")
    )
    mismatched = int((ccy_check["currency"] != ccy_check["currency_inv"]).sum())
    checks.append(
        _ok("transaction_currency_match", "transaction currency matches its invoice")
        if mismatched == 0
        else _fail("transaction_currency_match", f"{mismatched} mismatched currencies")
    )
    non_positive = int((invoices["invoice_amount"] <= 0).sum())
    checks.append(
        _ok("invoice_amount_positive", "all invoice amounts are positive")
        if non_positive == 0
        else _fail("invoice_amount_positive", f"{non_positive} non-positive amounts")
    )
    negative_txn = int((transactions["amount_received"] <= 0).sum())
    checks.append(
        _ok("transaction_amount_positive", "all payments are positive")
        if negative_txn == 0
        else _fail("transaction_amount_positive", f"{negative_txn} non-positive payments")
    )
    overpaid = int((invoices["total_amount_received"] > invoices["invoice_amount"] + 0.01).sum())
    checks.append(
        _ok("no_overpayment", "no invoice received more than its amount")
        if overpaid == 0
        else _fail("no_overpayment", f"{overpaid} invoices overpaid")
    )

    # -- reconciliation -----------------------------------------------------
    totals = transactions.groupby("invoice_id")["amount_received"].sum()
    reconciled = invoices.set_index("invoice_id")["total_amount_received"]
    delta = (totals.reindex(reconciled.index, fill_value=0.0) - reconciled).abs()
    worst = float(delta.max()) if len(delta) else 0.0
    checks.append(
        _ok("payment_reconciliation", f"max |ledger - invoice| = {worst:.4f}")
        if worst <= 0.01
        else _fail("payment_reconciliation", f"max mismatch {worst:.4f} exceeds 0.01")
    )
    outstanding_delta = (
        invoices["invoice_amount"] - invoices["total_amount_received"] - invoices["outstanding_amount"]
    ).abs()
    checks.append(
        _ok("outstanding_consistency", "outstanding = amount - received")
        if float(outstanding_delta.max()) <= 0.011
        else _fail("outstanding_consistency", "outstanding does not match amount minus received")
    )
    negative_out = int((invoices["outstanding_amount"] < -0.01).sum())
    checks.append(
        _ok("outstanding_non_negative", "no negative outstanding balances")
        if negative_out == 0
        else _fail("outstanding_non_negative", f"{negative_out} negative balances")
    )

    # -- status consistency -------------------------------------------------
    counts = transactions.groupby("invoice_id").size()
    invoice_counts = counts.reindex(invoices["invoice_id"]).fillna(0).to_numpy()
    partial_mask = invoices["payment_status"] == "partially_paid"
    bad_partial = int((partial_mask & (invoice_counts < 1)).sum())
    checks.append(
        _ok("partial_payment_consistency", "partial invoices have ledger entries")
        if bad_partial == 0
        else _fail("partial_payment_consistency", f"{bad_partial} partial invoices without payments")
    )
    paid_mask = invoices["payment_status"] == "paid"
    paid_short = int(
        (paid_mask & (invoices["total_amount_received"] < invoices["invoice_amount"] - 0.01)).sum()
    )
    checks.append(
        _ok("paid_invoices_settled", "paid invoices are fully covered")
        if paid_short == 0
        else _fail("paid_invoices_settled", f"{paid_short} paid invoices underpaid")
    )
    open_mask = invoices["payment_status"] == "open"
    open_paid = int((open_mask & (invoices["total_amount_received"] > 0.01)).sum())
    checks.append(
        _ok("open_invoices_unpaid", "open invoices have no receipts")
        if open_paid == 0
        else _fail("open_invoices_unpaid", f"{open_paid} open invoices have receipts")
    )

    # -- right-censoring ----------------------------------------------------
    censored = invoices.loc[invoices["is_censored"]]
    checks.append(
        _ok("censoring_present", f"{len(censored):,} invoices flagged censored")
        if len(censored) > 0
        else _fail("censoring_present", "no invoices were censored; window is unrealistic")
    )
    recent_open = invoices.loc[
        (invoices["payment_status"] != "paid")
        & (pd.to_datetime(invoices["due_date"]) > pd.Timestamp(obs_end - dt.timedelta(days=90)))
    ]
    unflagged = int((~recent_open["is_censored"]).sum())
    checks.append(
        _ok("censoring_correct", "recent unsettled invoices are flagged rather than called unpaid")
        if unflagged == 0
        else _fail("censoring_correct", f"{unflagged} recent unsettled invoices not flagged")
    )
    complete_paid = invoices.loc[invoices["is_complete"] & (invoices["payment_status"] == "paid")]
    checks.append(
        _ok("complete_rows_consistent", "complete rows reconcile to their status")
        if float((complete_paid["outstanding_amount"]).abs().max() or 0.0) <= 0.011
        else _fail("complete_rows_consistent", "complete paid invoices still carry a balance")
    )

    # -- metadata -----------------------------------------------------------
    missing_meta = REQUIRED_METADATA_KEYS - set(metadata)
    checks.append(
        _ok("metadata_complete", "all required metadata keys present")
        if not missing_meta
        else _fail("metadata_complete", f"missing: {sorted(missing_meta)}")
    )
    checks.append(
        _ok("metadata_counts_match", "metadata counts match the frames")
        if int(metadata["n_invoices"]) == len(invoices)
        and int(metadata["n_customers"]) == len(customers)
        else _fail("metadata_counts_match", "metadata counts disagree with generated frames")
    )
    checks.append(
        _ok("synthetic_designated", "dataset is explicitly marked synthetic")
        if metadata.get("source_type") == "synthetic_simulation"
        and bool(metadata.get("synthetic"))
        else _fail("synthetic_designated", "source_type/synthetic flags are missing")
    )
    return checks


def summarise(checks: list[Check]) -> dict[str, object]:
    failed = [c.as_dict() for c in checks if not c.ok]
    return {
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "ok": not failed,
        "checks": [c.as_dict() for c in checks],
        "failures": failed,
    }


__all__ = [
    "Check",
    "REQUIRED_INVOICE_COLUMNS",
    "REQUIRED_TRANSACTION_COLUMNS",
    "REQUIRED_METADATA_KEYS",
    "validate_dataset",
    "summarise",
]
