"""Forecast targets derived from the synthetic payment ledger.

The real project can only observe an *invoice-clearance proxy* because it has
no payment ledger. The synthetic generator does have one, so two series are
produced side by side:

``collections_received``
    True cash received: the sum of ``amount_received`` dated at ``payment_date``.
    This is the series a production system with a ledger would forecast.

``collections_clearance``
    The invoice-clearance proxy used by the real dataset: the full invoice
    amount dated at the invoice's final clearing date. Useful for keeping the
    synthetic and real pipelines comparable.

Only fully observed weeks are marked complete. Because an invoice that fell due
recently may still be paid, the target window ends ``CENSOR_BUFFER_DAYS``
before the ledger's observation end.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

CENSOR_BUFFER_DAYS = 90


def _week_start(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=day.weekday())


def build_daily_target(
    invoices: pd.DataFrame,
    transactions: pd.DataFrame,
    observation_end: dt.date,
    censor_buffer_days: int = CENSOR_BUFFER_DAYS,
) -> pd.DataFrame:
    """Daily collections per currency, including genuine zero days."""
    start = min(invoices["invoice_date"])
    target_end = observation_end - dt.timedelta(days=censor_buffer_days)

    received = (
        transactions.groupby(["payment_date", "currency"], observed=True)
        .agg(collections_received=("amount_received", "sum"), payment_count=("amount_received", "size"))
        .reset_index()
        .rename(columns={"payment_date": "date"})
    )

    cleared = invoices.loc[invoices["payment_status"] == "paid"].copy()
    cleared = (
        cleared.groupby(["final_payment_date", "currency"], observed=True)
        .agg(collections_clearance=("invoice_amount", "sum"), invoice_count=("invoice_amount", "size"))
        .reset_index()
        .rename(columns={"final_payment_date": "date"})
    )

    days = pd.date_range(start, target_end, freq="D").date
    currencies = sorted(invoices["currency"].unique())
    index = pd.MultiIndex.from_product([days, currencies], names=["date", "currency"])

    daily = (
        received.set_index(["date", "currency"])
        .reindex(index, fill_value=0)
        .reset_index()
    )
    daily = daily.merge(
        cleared.set_index(["date", "currency"]).reset_index(), on=["date", "currency"], how="left"
    )
    for col in ("collections_clearance", "invoice_count"):
        daily[col] = daily[col].fillna(0.0)

    daily["collections_received"] = daily["collections_received"].astype(float).round(2)
    daily["collections_clearance"] = daily["collections_clearance"].astype(float).round(2)
    daily["payment_count"] = daily["payment_count"].astype(int)
    daily["invoice_count"] = daily["invoice_count"].astype(int)
    daily["is_complete"] = True  # the window already excludes the censored tail
    daily["target_end"] = target_end
    return daily.sort_values(["date", "currency"], ignore_index=True)


def build_weekly_target(daily: pd.DataFrame) -> pd.DataFrame:
    """Aggregate the daily target into fully bounded Monday-start weeks."""
    frame = daily.copy()
    frame["week_start"] = [_week_start(d) for d in frame["date"]]
    grouped = (
        frame.groupby(["week_start", "currency"], observed=True)
        .agg(
            collections_received=("collections_received", "sum"),
            collections_clearance=("collections_clearance", "sum"),
            payment_count=("payment_count", "sum"),
            invoice_count=("invoice_count", "sum"),
            day_count=("date", "size"),
        )
        .reset_index()
    )
    weekly = grouped.loc[grouped["day_count"] == 7].drop(columns=["day_count"])
    weekly["is_complete"] = True
    weekly["collections_received"] = weekly["collections_received"].round(2)
    weekly["collections_clearance"] = weekly["collections_clearance"].round(2)
    return weekly.sort_values(["week_start", "currency"], ignore_index=True)


def build_asof_invoice_view(
    invoices: pd.DataFrame,
    transactions: pd.DataFrame,
    as_of: dt.date,
) -> pd.DataFrame:
    """Invoice state as it would have been observed at ``as_of``.

    The full dataset carries each invoice's *final* settlement state, which is
    future information for any forecast origin before that point. This helper
    rebuilds received/outstanding/status using only payments dated on or before
    ``as_of`` so features can never see later events.

    Returns ``invoice_id, customer_id, currency, invoice_date, due_date,
    invoice_amount, payment_terms, received_asof, outstanding_asof, status_asof,
    days_since_invoice``.
    """
    frame = invoices.loc[
        invoices["invoice_date"] <= as_of,
        [
            "invoice_id",
            "customer_id",
            "currency",
            "invoice_date",
            "due_date",
            "invoice_amount",
            "payment_terms",
        ],
    ].copy()

    known = transactions.loc[transactions["payment_date"] <= as_of]
    received = known.groupby("invoice_id")["amount_received"].sum()
    frame["received_asof"] = (
        received.reindex(frame["invoice_id"]).fillna(0.0).round(2).to_numpy()
    )
    frame["outstanding_asof"] = (
        frame["invoice_amount"] - frame["received_asof"]
    ).clip(lower=0).round(2)
    frame["status_asof"] = np.where(
        frame["received_asof"] >= frame["invoice_amount"] - 0.01,
        "paid",
        np.where(frame["received_asof"] > 0, "partially_paid", "open"),
    )
    frame["days_since_invoice"] = [(as_of - d).days for d in frame["invoice_date"]]
    return frame.reset_index(drop=True)


__all__ = [
    "CENSOR_BUFFER_DAYS",
    "build_daily_target",
    "build_weekly_target",
    "build_asof_invoice_view",
]
