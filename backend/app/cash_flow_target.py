"""Cash-flow target construction for Model 4 (aggregate cash-flow forecasting).

This module is the *only* place where the invoice-clearance proxy lives.

Design contract
---------------
``build_target(source) -> DataFrame[date, currency, collections, invoice_count, is_complete]``

The signature is deliberately source-agnostic. Today ``source`` is the cleaned
invoice extract. When a transaction-level payment ledger becomes available,
a replacement implementation can return the same five columns and every
downstream consumer (feature building, training, serving) keeps working
unchanged. That is why the proxy assumption is isolated here and nowhere else.

Payment-proxy limitation
------------------------
The dataset has no payment ledger, no partial-payment flag and no
amount-received column. ``invoice_amount`` is the source's ``total_open_amount``,
which for a partially settled invoice may be a *residual* balance rather than
the cash actually received. Therefore the target is a clearance proxy:

    collection_proxy(invoice) ~= invoice_amount, dated payment_date

It assumes the invoice amount represents the collection associated with the
clearing date. It is NOT verified cash received and must never be presented as
bank-level transaction data.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

import pandas as pd

# --------------------------------------------------------------------------
# Canonical window
# --------------------------------------------------------------------------
# The source extract is right-censored: invoices are effectively unobserved
# after 2020-03-13 (0% of 2020-03+ invoices are marked paid). Everything at or
# before that date is treated as observed; nothing after it is ever used.
OBSERVED_START = _dt.date(2019, 1, 3)
OBSERVED_END = _dt.date(2020, 3, 13)

# Monday-start weeks. Only weeks fully bounded by the observed window are
# usable: 2018-12-31..2019-01-06 is missing its Mon-Wed head and
# 2020-03-09..2020-03-15 is missing its weekend tail.
FIRST_COMPLETE_WEEK = _dt.date(2019, 1, 7)
LAST_COMPLETE_WEEK = _dt.date(2020, 3, 2)

SUPPORTED_CURRENCIES: tuple[str, ...] = ("USD", "CAD")

TARGET_COLUMNS: tuple[str, ...] = (
    "date",
    "currency",
    "collections",
    "invoice_count",
    "is_complete",
)

REQUIRED_SOURCE_COLUMNS: tuple[str, ...] = (
    "invoice_status",
    "invoice_currency",
    "invoice_amount",
    "payment_date",
)

PROXY_METADATA: dict[str, object] = {
    "target_definition": (
        "collection_proxy(date, currency) = SUM(invoice_amount) of invoices with "
        "invoice_status == 'paid' whose payment_date falls on that date, grouped by "
        "invoice_currency. Invoice-clearance proxy, not verified cash received."
    ),
    "payment_proxy": True,
    "proxy_limitations": [
        "Source data has no payment ledger and no amount-received column; "
        "invoice_amount is the source's total_open_amount.",
        "For partially settled invoices, invoice_amount may be a residual balance, "
        "so the clearing-date amount can over- or under-state cash actually received.",
        "The model therefore forecasts invoice clearance, not bank-confirmed cash inflow.",
        "A transaction-level payment ledger is required before these figures may be "
        "described as verified cash received.",
    ],
    "requires_payment_ledger_for_verified_cash": True,
}


def _to_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce").dt.date


def week_start(date: _dt.date) -> _dt.date:
    """Monday of the ISO week containing ``date``."""
    return date - _dt.timedelta(days=date.weekday())


def is_complete_week(start: _dt.date) -> bool:
    """True when ``start`` is a Monday whose whole week is inside the window."""
    return FIRST_COMPLETE_WEEK <= start <= LAST_COMPLETE_WEEK and start.weekday() == 0


@dataclass(frozen=True)
class BuildStats:
    """Reconciliation figures kept for the data-quality report."""

    source_rows: int
    used_rows: int
    dropped_status: int
    dropped_currency: int
    dropped_missing_payment_date: int
    dropped_invalid_amount: int
    dropped_outside_window: int
    zero_days: dict[str, int]
    active_days: dict[str, int]
    totals: dict[str, float]

    def as_dict(self) -> dict[str, object]:
        return {
            "source_rows": self.source_rows,
            "used_rows": self.used_rows,
            "dropped_status": self.dropped_status,
            "dropped_currency": self.dropped_currency,
            "dropped_missing_payment_date": self.dropped_missing_payment_date,
            "dropped_invalid_amount": self.dropped_invalid_amount,
            "dropped_outside_window": self.dropped_outside_window,
            "zero_days": self.zero_days,
            "active_days": self.active_days,
            "totals": self.totals,
        }


def build_target(source: pd.DataFrame, *, with_stats: bool = False):
    """Build the canonical daily collection target.

    Parameters
    ----------
    source:
        Cleaned invoice extract. Must contain ``REQUIRED_SOURCE_COLUMNS``.
    with_stats:
        When true, return ``(target, BuildStats)`` so the data-quality report can
        reconcile every dropped row.

    Returns
    -------
    DataFrame with ``TARGET_COLUMNS``: one row per (observed calendar day,
    currency) covering 2019-01-03..2020-03-13, including genuine zero-collection
    days. Zeros are real observations and are never forward-filled.
    """
    missing = [c for c in REQUIRED_SOURCE_COLUMNS if c not in source.columns]
    if missing:
        raise ValueError(f"source is missing required columns: {missing}")

    total_rows = len(source)

    work = source.copy()
    work["_amount"] = pd.to_numeric(work["invoice_amount"], errors="coerce")
    work["_payment_date"] = _to_date(work["payment_date"])

    status = work["invoice_status"].astype("string").str.strip().str.lower()
    currency = work["invoice_currency"].astype("string").str.strip().str.upper()

    keep_status = status.eq("paid")
    keep_currency = currency.isin(SUPPORTED_CURRENCIES)
    keep_date = work["_payment_date"].notna()
    keep_amount = work["_amount"].notna() & (work["_amount"] > 0)

    dropped_status = int((~keep_status).sum())
    dropped_currency = int((keep_status & ~keep_currency).sum())
    dropped_missing_payment_date = int((keep_status & keep_currency & ~keep_date).sum())
    dropped_invalid_amount = int(
        (keep_status & keep_currency & keep_date & ~keep_amount).sum()
    )

    mask = keep_status & keep_currency & keep_date & keep_amount
    work = work.loc[mask].copy()
    work["currency"] = currency.loc[mask]
    work["date"] = work["_payment_date"]

    in_window = (work["date"] >= OBSERVED_START) & (work["date"] <= OBSERVED_END)
    dropped_outside_window = int((~in_window).sum())
    work = work.loc[in_window]

    grouped = (
        work.groupby(["date", "currency"], observed=True)
        .agg(collections=("_amount", "sum"), invoice_count=("_amount", "size"))
        .reset_index()
    )

    # Reindex onto the full observed calendar per currency so that days with no
    # collection are represented as explicit zeros rather than gaps.
    days = pd.date_range(OBSERVED_START, OBSERVED_END, freq="D").date
    index = pd.MultiIndex.from_product(
        [days, list(SUPPORTED_CURRENCIES)], names=["date", "currency"]
    )
    target = (
        grouped.set_index(["date", "currency"])
        .reindex(index, fill_value=0)
        .reset_index()
    )
    target["collections"] = target["collections"].astype("float64")
    target["invoice_count"] = target["invoice_count"].astype("int64")
    target["is_complete"] = [is_complete_week(week_start(d)) for d in target["date"]]
    target["is_complete"] = target["is_complete"].astype(bool)

    target = target.loc[:, list(TARGET_COLUMNS)].sort_values(
        ["date", "currency"], ignore_index=True
    )

    if not with_stats:
        return target

    stats = BuildStats(
        source_rows=total_rows,
        used_rows=int(len(work)),
        dropped_status=dropped_status,
        dropped_currency=dropped_currency,
        dropped_missing_payment_date=dropped_missing_payment_date,
        dropped_invalid_amount=dropped_invalid_amount,
        dropped_outside_window=dropped_outside_window,
        zero_days={
            c: int((g["collections"] == 0).sum())
            for c, g in target.groupby("currency", observed=True)
        },
        active_days={
            c: int((g["collections"] > 0).sum())
            for c, g in target.groupby("currency", observed=True)
        },
        totals={
            c: float(g["collections"].sum())
            for c, g in target.groupby("currency", observed=True)
        },
    )
    return target, stats


def daily_by_currency(target: pd.DataFrame) -> pd.DataFrame:
    """Wide daily view: one column per currency, calendar-indexed."""
    wide = target.pivot(index="date", columns="currency", values="collections")
    wide.index = pd.to_datetime(wide.index)
    return wide.sort_index()


def weekly_from_daily(target: pd.DataFrame) -> pd.DataFrame:
    """Aggregate the daily target into fully bounded Monday-start weeks.

    Truncated weeks are excluded entirely. Genuine zero weeks are preserved.
    """
    daily = target.loc[target["is_complete"]].copy()
    if daily.empty:
        return pd.DataFrame(
            columns=["week_start", "currency", "collections", "invoice_count", "is_complete"]
        )

    daily["week_start"] = [
        week_start(d) for d in daily["date"]
    ]
    weekly = (
        daily.groupby(["week_start", "currency"], observed=True)
        .agg(
            collections=("collections", "sum"),
            invoice_count=("invoice_count", "sum"),
            day_count=("date", "size"),
        )
        .reset_index()
    )
    weekly = weekly.loc[weekly["day_count"] == 7].drop(columns=["day_count"])
    weekly["is_complete"] = True
    weekly = weekly.loc[
        :, ["week_start", "currency", "collections", "invoice_count", "is_complete"]
    ]
    return weekly.sort_values(["week_start", "currency"], ignore_index=True)


def weekday_shares(target: pd.DataFrame, currency: str) -> dict[int, float]:
    """Historical weekday collection shares (Mon=0 .. Sun=6) for one currency.

    Used to allocate weekly forecasts across partial weeks. Callers must pass a
    training-only slice to avoid leakage; this function performs no filtering of
    its own beyond the completeness flag.
    """
    subset = target.loc[
        (target["currency"] == currency) & (target["is_complete"])
    ]
    if subset.empty:
        return {i: 1 / 7 for i in range(7)}
    total = float(subset["collections"].sum())
    if total <= 0:
        return {i: 1 / 7 for i in range(7)}
    by_dow = (
        subset.assign(dow=[d.weekday() for d in subset["date"]])
        .groupby("dow")["collections"]
        .sum()
    )
    return {i: float(by_dow.get(i, 0.0)) / total for i in range(7)}


__all__ = [
    "OBSERVED_START",
    "OBSERVED_END",
    "FIRST_COMPLETE_WEEK",
    "LAST_COMPLETE_WEEK",
    "SUPPORTED_CURRENCIES",
    "TARGET_COLUMNS",
    "PROXY_METADATA",
    "BuildStats",
    "build_target",
    "daily_by_currency",
    "weekly_from_daily",
    "weekday_shares",
    "week_start",
    "is_complete_week",
]
