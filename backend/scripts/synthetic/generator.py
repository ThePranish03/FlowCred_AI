"""Synthetic financial dataset generator for FlowCred AI.

This module produces a *simulated* invoice portfolio and a matching
transaction-level payment ledger. It exists so the forecasting, late-payment
and delay pipelines can be exercised on data with a known ground truth,
realistic censoring and controllable difficulty.

It does **not** represent genuine historical business transactions and must
never be described as such. The original dataset
(``data/processed/flowcred_cleaned.csv``) is treated as read-only and is not
read, derived from, or perturbed by this generator.

Design
------
* Deterministic: one seed drives every draw, so identical configuration
  reproduces byte-identical output.
* Persistent customer behaviour: each customer owns a payment profile, a
  contractual term, a size multiplier and an activity level for the whole
  simulation. Payment delays are drawn from that customer's profile, not
  independently per invoice.
* Real ledger first: payments are simulated as transactions, then invoices are
  derived from them. Partially paid invoices therefore reconcile by
  construction rather than by post-hoc adjustment.
* Right-censoring is explicit: the simulation runs past the observation window
  so eventual outcomes are known, then everything after ``observation_end`` is
  withheld and the affected invoices are flagged ``is_censored`` instead of
  being mislabelled as permanently unpaid.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from dataclasses import dataclass, field
import numpy as np
import pandas as pd

GENERATOR_VERSION = "1.0.0"
SYNTHETIC_SOURCE = "synthetic_simulation"

PROFILES: tuple[str, ...] = (
    "early",
    "on_time",
    "occasional_late",
    "chronic_late",
    "high_risk",
)

# Suggested simulation assumptions, not empirical facts.
PROFILE_SHARES: dict[str, float] = {
    "early": 0.20,
    "on_time": 0.35,
    "occasional_late": 0.25,
    "chronic_late": 0.15,
    "high_risk": 0.05,
}

# Probability that an invoice is settled in more than one instalment.
PARTIAL_RATE: dict[str, float] = {
    "early": 0.06,
    "on_time": 0.08,
    "occasional_late": 0.15,
    "chronic_late": 0.22,
    "high_risk": 0.30,
}

# Share of invoices that are never settled at all during the simulation.
NEVER_PAY_RATE: dict[str, float] = {
    "early": 0.002,
    "on_time": 0.004,
    "occasional_late": 0.02,
    "chronic_late": 0.05,
    "high_risk": 0.45,
}


@dataclass(frozen=True)
class GeneratorConfig:
    """All knobs that affect the generated portfolio."""

    seed: int = 20260101
    n_invoices: int = 50_000
    n_customers: int = 1_400
    months: int = 36
    start_year: int = 2021
    start_month: int = 1
    usd_share: float = 0.88
    term_choices: tuple[int, ...] = (15, 30, 45, 60)
    term_weights: tuple[float, ...] = (0.28, 0.44, 0.20, 0.08)
    posting_holiday_rate: float = 0.012
    dispute_rate: float = 0.006
    version: str = GENERATOR_VERSION
    base_amount: dict[str, float] = field(
        default_factory=lambda: {"USD": 14_000.0, "CAD": 11_000.0}
    )

    def as_dict(self) -> dict[str, object]:
        return {
            "seed": self.seed,
            "n_invoices": self.n_invoices,
            "n_customers": self.n_customers,
            "months": self.months,
            "start_year": self.start_year,
            "start_month": self.start_month,
            "usd_share": self.usd_share,
            "term_choices": list(self.term_choices),
            "term_weights": list(self.term_weights),
            "posting_holiday_rate": self.posting_holiday_rate,
            "dispute_rate": self.dispute_rate,
            "base_amount": dict(self.base_amount),
            "version": self.version,
        }


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------
def month_sequence(start_year: int, start_month: int, months: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    year, month = start_year, start_month
    for _ in range(months):
        out.append((year, month))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return out


def month_end(year: int, month: int) -> dt.date:
    if month == 12:
        return dt.date(year, 12, 31)
    return dt.date(year, month + 1, 1) - dt.timedelta(days=1)


def business_days(year: int, month: int) -> list[dt.date]:
    last = month_end(year, month)
    day = dt.date(year, month, 1)
    out: list[dt.date] = []
    while day <= last:
        if day.weekday() < 5:
            out.append(day)
        day += dt.timedelta(days=1)
    return out


def largest_remainder(weights: np.ndarray, total: int) -> np.ndarray:
    """Convert fractional weights into integers summing exactly to ``total``."""
    flat = np.asarray(weights, dtype=float).ravel()
    if flat.sum() <= 0:
        raise ValueError("weights must sum to a positive number")
    target = flat / flat.sum() * total
    base = np.floor(target).astype(np.int64)
    remainder = int(total - base.sum())
    if remainder:
        order = np.argsort(-(target - base), kind="stable")
        base[order[:remainder]] += 1
    return base.reshape(np.shape(weights))


def shift_to_business_day(
    day: dt.date, holidays: set[dt.date], forward: bool = True
) -> dt.date:
    step = dt.timedelta(days=1 if forward else -1)
    for _ in range(30):
        if day.weekday() < 5 and day not in holidays:
            return day
        day = day + step
    return day


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------
class SyntheticFinancialDataGenerator:
    """Deterministic invoice + ledger simulator."""

    def __init__(self, config: GeneratorConfig | None = None) -> None:
        self.config = config or GeneratorConfig()
        self._rng = np.random.default_rng(self.config.seed)
        self._months = month_sequence(
            self.config.start_year, self.config.start_month, self.config.months
        )
        self._month_business_days = {m: business_days(*m) for m in self._months}
        self._period_start = dt.date(self.config.start_year, self.config.start_month, 1)
        self._period_end = month_end(*self._months[-1])
        # Payments continue to be simulated past the window so that censoring is
        # known rather than guessed; they are simply withheld from the ledger.
        self._settlement_horizon = self._period_end + dt.timedelta(days=180)
        self._holidays = self._build_posting_holidays()

    # -- setup ---------------------------------------------------------------
    def _build_posting_holidays(self) -> set[dt.date]:
        days = [d for m in self._months for d in self._month_business_days[m]]
        n = max(1, int(len(days) * self.config.posting_holiday_rate))
        picks = self._rng.choice(np.array(days, dtype=object), size=n, replace=False)
        return {d for d in picks}

    def _build_customers(self) -> pd.DataFrame:
        cfg = self.config
        n = cfg.n_customers
        rng = self._rng

        profile_counts = largest_remainder(
            np.array([PROFILE_SHARES[p] for p in PROFILES]) * n, n
        )
        profiles: list[str] = []
        for profile, count in zip(PROFILES, profile_counts):
            profiles.extend([profile] * int(count))
        rng.shuffle(profiles)

        currencies = rng.choice(
            np.array(["USD", "CAD"], dtype=object),
            size=n,
            p=[cfg.usd_share, 1.0 - cfg.usd_share],
        )
        terms = rng.choice(
            np.array(cfg.term_choices),
            size=n,
            p=np.array(cfg.term_weights) / sum(cfg.term_weights),
        )
        size_factor = np.clip(rng.lognormal(mean=0.0, sigma=0.45, size=n), 0.25, 3.5)
        activity = rng.gamma(shape=2.0, scale=0.5, size=n)

        return pd.DataFrame(
            {
                "customer_id": [f"CUST-{i:05d}" for i in range(1, n + 1)],
                "customer_region": rng.choice(
                    np.array(["north", "south", "east", "west"], dtype=object), size=n
                ),
                "currency": currencies,
                "payment_profile": profiles,
                "payment_terms_days": terms.astype(int),
                "size_factor": np.round(size_factor, 4),
                "activity_level": np.round(activity, 4),
                "source_type": SYNTHETIC_SOURCE,
            }
        )

    # -- issuance ------------------------------------------------------------
    def _month_factor(self, index: int, month: int) -> float:
        seasonal = 1.0 + 0.12 * math.sin((index / 12.0) * 2 * math.pi + 0.7)
        quarter_end = 1.18 if month in (3, 6, 9, 12) else 1.0
        december = 0.88 if month == 12 else 1.0
        january = 1.06 if month == 1 else 1.0
        return seasonal * quarter_end * december * january

    def _invoice_counts(self, customers: pd.DataFrame) -> np.ndarray:
        activity = customers["activity_level"].to_numpy(dtype=float)
        factors = np.array(
            [self._month_factor(i, m) for i, (_, m) in enumerate(self._months)]
        )
        weights = np.outer(activity, factors)
        return largest_remainder(weights, self.config.n_invoices)

    def _issue_invoices(
        self, customers: pd.DataFrame, counts: np.ndarray
    ) -> pd.DataFrame:
        cfg = self.config
        rng = self._rng
        weekday_weights = np.array([1.15, 1.10, 1.05, 1.00, 0.95])  # Mon..Fri

        rows: list[dict[str, object]] = []
        invoice_no = 0
        for c_idx, customer in enumerate(customers.itertuples(index=False)):
            for m_idx, month_key in enumerate(self._months):
                k = int(counts[c_idx, m_idx])
                if k <= 0:
                    continue
                days = self._month_business_days[month_key]
                weekday_p = np.array([weekday_weights[d.weekday()] for d in days])
                weekday_p = weekday_p / weekday_p.sum()
                chosen = rng.choice(
                    np.array(days, dtype=object), size=k, replace=False, p=weekday_p
                )
                chosen = sorted(dt.date(d.year, d.month, d.day) for d in chosen)

                quarter_factor = 1.25 if month_key[1] in (3, 6, 9, 12) else 1.0
                for invoice_date in chosen:
                    invoice_no += 1
                    base = cfg.base_amount[str(customer.currency)]
                    amount = base * float(customer.size_factor) * float(
                        rng.lognormal(mean=0.0, sigma=0.55)
                    )
                    amount *= quarter_factor
                    amount = max(50.0, round(amount, 2))
                    terms = int(customer.payment_terms_days)
                    rows.append(
                        {
                            "invoice_id": f"INV-{invoice_no:06d}",
                            "customer_id": customer.customer_id,
                            "invoice_date": invoice_date,
                            "due_date": invoice_date + dt.timedelta(days=terms),
                            "invoice_amount": amount,
                            "currency": str(customer.currency),
                            "payment_terms": f"NET{terms}",
                            "payment_terms_days": terms,
                            "customer_payment_profile": str(customer.payment_profile),
                            "source_type": SYNTHETIC_SOURCE,
                        }
                    )
        invoices = pd.DataFrame(rows)
        invoices["invoice_month"] = [
            f"{d.year:04d}-{d.month:02d}" for d in invoices["invoice_date"]
        ]
        return invoices

    # -- payment behaviour ---------------------------------------------------
    def _delay_days(self, profile: str) -> int:
        rng = self._rng
        if profile == "early":
            return int(np.clip(rng.normal(-8, 2.5), -35, -2))
        if profile == "on_time":
            # Centred slightly *before* the due date so "on time" means what it
            # says: roughly 85% settle on or before the due date.
            return int(np.clip(rng.normal(-2, 2.0), -10, 3))
        if profile == "occasional_late":
            if rng.random() < 0.65:
                return int(np.clip(rng.normal(0, 3), -5, 6))
            return int(np.clip(rng.normal(14, 8), 5, 45))
        if profile == "chronic_late":
            return int(np.clip(rng.normal(25, 12), 8, 70))
        # high_risk
        return int(np.clip(rng.normal(45, 20), 15, 120))

    def _instalment_fractions(self, n: int) -> list[float]:
        rng = self._rng
        if n == 1:
            return [1.0]
        first = float(rng.uniform(0.40, 0.70))
        remaining = 1.0 - first
        rest = sorted(rng.uniform(0.6, 1.4, size=n - 1))
        rest = [r / sum(rest) * remaining for r in rest]
        return [first, *rest]

    def _simulate_payments(self, invoices: pd.DataFrame) -> pd.DataFrame:
        rng = self._rng
        records: list[dict[str, object]] = []
        txn_no = 0

        for row in invoices.itertuples(index=False):
            profile = row.customer_payment_profile
            amount = float(row.invoice_amount)
            due = row.due_date
            issued = row.invoice_date

            never_pays = rng.random() < NEVER_PAY_RATE[profile]
            disputed = (not never_pays) and (rng.random() < self.config.dispute_rate)
            if disputed and rng.random() < 0.5:
                never_pays = True
            if never_pays:
                continue

            partial = rng.random() < PARTIAL_RATE[profile]
            n_inst = 1
            if partial:
                n_inst = 2 if rng.random() < 0.85 else 3

            delay = self._delay_days(profile)
            if disputed:
                delay += int(rng.uniform(45, 120))

            first_date = due + dt.timedelta(days=delay)
            if first_date <= issued:
                first_date = issued + dt.timedelta(days=int(rng.integers(1, 5)))
            first_date = shift_to_business_day(first_date, self._holidays)

            fractions = self._instalment_fractions(n_inst)
            dates = [first_date]
            for _ in range(n_inst - 1):
                nxt = dates[-1] + dt.timedelta(days=int(rng.integers(12, 36)))
                dates.append(shift_to_business_day(nxt, self._holidays))

            amounts = [round(amount * f, 2) for f in fractions]
            # Absorb rounding drift into the final instalment so the ledger
            # reconciles to the invoice amount exactly.
            amounts[-1] = round(amount - sum(amounts[:-1]), 2)

            for idx, (pay_date, pay_amount) in enumerate(zip(dates, amounts), start=1):
                txn_no += 1
                if n_inst == 1:
                    kind = "full_payment"
                elif idx < n_inst:
                    kind = "partial_payment"
                else:
                    kind = "final_payment"
                records.append(
                    {
                        "transaction_id": f"TXN-{txn_no:07d}",
                        "invoice_id": row.invoice_id,
                        "customer_id": row.customer_id,
                        "payment_date": pay_date,
                        "amount_received": max(0.01, float(pay_amount)),
                        "currency": row.currency,
                        "transaction_type": kind,
                        "instalment_number": idx,
                        "instalments_total": n_inst,
                        "source_type": SYNTHETIC_SOURCE,
                    }
                )

        txns = pd.DataFrame(records)
        txns["payment_date"] = pd.to_datetime(txns["payment_date"]).dt.date
        return txns

    # -- reconciliation and censoring ---------------------------------------
    def _finalise_invoices(
        self, invoices: pd.DataFrame, txns: pd.DataFrame
    ) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, int]]:
        obs_end = self._period_end
        true_totals = txns.groupby("invoice_id")["amount_received"].sum()
        last_true_date = txns.groupby("invoice_id")["payment_date"].max()

        observed = txns.loc[txns["payment_date"] <= obs_end].copy()
        observed_totals = observed.groupby("invoice_id")["amount_received"].sum()
        observed_last = observed.groupby("invoice_id")["payment_date"].max()

        amounts = invoices.set_index("invoice_id")["invoice_amount"]
        due = invoices.set_index("invoice_id")["due_date"]

        received = observed_totals.reindex(amounts.index, fill_value=0.0).round(2)
        outstanding = (amounts - received).clip(lower=0).round(2)

        # An invoice is censored when its eventual outcome is not observable:
        # a payment lands after the window, or it is still unpaid but only
        # recently fell due.
        has_future_payment = last_true_date.reindex(amounts.index) > obs_end
        unpaid_observed = received <= 0
        still_maturing = due > (obs_end - dt.timedelta(days=90))
        censored = has_future_payment.fillna(False) | (
            unpaid_observed & still_maturing
        )

        status = np.where(
            received >= (amounts - 0.01),
            "paid",
            np.where(received > 0, "partially_paid", "open"),
        )

        final = invoices.copy()
        final["total_amount_received"] = received.reindex(final["invoice_id"]).to_numpy()
        final["outstanding_amount"] = outstanding.reindex(final["invoice_id"]).to_numpy()
        final["payment_status"] = status
        final["is_censored"] = censored.reindex(final["invoice_id"]).fillna(False).to_numpy()
        final["is_complete"] = ~final["is_censored"]
        final["final_payment_date"] = (
            observed_last.reindex(final["invoice_id"]).to_numpy()
        )
        final["days_to_pay"] = [
            (p - i).days if isinstance(p, dt.date) else np.nan
            for p, i in zip(final["final_payment_date"], final["invoice_date"])
        ]
        final["is_late"] = [
            (p > d) if isinstance(p, dt.date) else np.nan
            for p, d in zip(final["final_payment_date"], final["due_date"])
        ]
        final["observation_end"] = obs_end

        stats = {
            "observed_transactions": int(len(observed)),
            "withheld_transactions": int(len(txns) - len(observed)),
            "censored_invoices": int(final["is_censored"].sum()),
        }
        return final, observed, stats

    # -- public API ----------------------------------------------------------
    def generate(self) -> dict[str, object]:
        customers = self._build_customers()
        counts = self._invoice_counts(customers)
        invoices = self._issue_invoices(customers, counts)
        txns = self._simulate_payments(invoices)
        invoices_out, txns_out, stats = self._finalise_invoices(invoices, txns)

        metadata = {
            "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "generator_version": self.config.version,
            "source_type": SYNTHETIC_SOURCE,
            "synthetic": True,
            "disclaimer": (
                "Simulated data. These are not genuine historical business "
                "transactions and must not be presented as such."
            ),
            "random_seed": self.config.seed,
            "n_invoices": int(len(invoices_out)),
            "n_customers": int(len(customers)),
            "n_transactions": int(len(txns_out)),
            "simulation_period": {
                "start": str(self._period_start),
                "end": str(self._period_end),
                "months": self.config.months,
            },
            "observation_end": str(self._period_end),
            "currency_distribution": {
                str(k): int(v)
                for k, v in invoices_out["currency"].value_counts().items()
            },
            "profile_assumptions": PROFILE_SHARES,
            "profile_distribution": {
                str(k): int(v)
                for k, v in customers["payment_profile"].value_counts().items()
            },
            "payment_term_assumptions": {
                "choices_days": list(self.config.term_choices),
                "weights": list(self.config.term_weights),
            },
            "partial_payment_rates": PARTIAL_RATE,
            "never_pay_rates": NEVER_PAY_RATE,
            "censoring": {
                "observation_end": str(self._period_end),
                "settlement_horizon": str(self._settlement_horizon),
                **stats,
            },
            "config": self.config.as_dict(),
        }
        return {
            "invoices": invoices_out,
            "transactions": txns_out,
            "customers": customers,
            "metadata": metadata,
        }


__all__ = [
    "GENERATOR_VERSION",
    "SYNTHETIC_SOURCE",
    "PROFILES",
    "PROFILE_SHARES",
    "GeneratorConfig",
    "SyntheticFinancialDataGenerator",
    "month_sequence",
    "month_end",
    "business_days",
    "largest_remainder",
    "shift_to_business_day",
]
