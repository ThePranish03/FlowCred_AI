# Synthetic financial dataset

> **Simulated data.** Nothing in this document describes real customers,
> invoices or payments. The generator produces a plausible portfolio so the
> forecasting pipeline can be exercised against a known ground truth. It must
> never be presented as genuine historical business transactions.

The real dataset `data/processed/flowcred_cleaned.csv` is read-only: the
generator does not read it, derive from it, or modify it. No model artifact is
touched by anything in this pipeline.

---

## 1. Purpose

The real extract has properties that make experimentation hard:

- no payment ledger, so only an invoice-clearance proxy can be observed;
- a single 15-month window with a structural break in early 2020;
- no partial payments, so instalment logic cannot be tested;
- no control over difficulty, so "did the model learn something real?" and
  "was this window easy?" cannot be separated.

A simulator fixes all four. It is an instrument for testing code and reasoning,
not evidence about the business.

## 2. Design goals

| Goal | How it is met |
|---|---|
| Determinism | one seeded `numpy.random.Generator` drives every draw; output hashes are recorded in metadata |
| Persistent behaviour | each customer owns a profile, terms, size and activity for the whole simulation |
| Ledger-first | payments are simulated as transactions; invoices are reconciled from them |
| Explicit censoring | the simulation runs past the window so eventual outcomes are known, then later events are withheld |
| Leak-free reuse | `build_asof_invoice_view()` reconstructs state at any date |

## 3. Entity model

### `synthetic_customers.csv` (1,400 rows)

| Column | Meaning |
|---|---|
| `customer_id` | `CUST-00001` … |
| `customer_region` | north / south / east / west |
| `currency` | USD or CAD, fixed for the customer |
| `payment_profile` | early / on_time / occasional_late / chronic_late / high_risk |
| `payment_terms_days` | contractual 15 / 30 / 45 / 60 |
| `size_factor` | lognormal multiplier on invoice size |
| `activity_level` | gamma-distributed issuance propensity |
| `source_type` | `synthetic_simulation` |

### `synthetic_invoices.csv` (50,000 rows)

`invoice_id`, `customer_id`, `invoice_date`, `due_date`, `invoice_amount`,
`currency`, `payment_terms`, `payment_terms_days`,
`customer_payment_profile`, `invoice_month`, `source_type`, plus the observed
settlement state: `payment_status`, `total_amount_received`,
`outstanding_amount`, `final_payment_date`, `days_to_pay`, `is_late`,
`is_censored`, `is_complete`, `observation_end`.

`payment_status` is one of `paid`, `partially_paid`, `open` **as observed**.

### `synthetic_payment_transactions.csv` (~52,600 rows)

`transaction_id`, `invoice_id`, `customer_id`, `payment_date`,
`amount_received`, `currency`, `transaction_type`, `instalment_number`,
`instalments_total`, `source_type`.

`transaction_type` is `full_payment`, `partial_payment` or `final_payment`.

## 4. Generation algorithm

1. **Customers.** Profiles are assigned by exact quota (largest-remainder
   allocation over the target shares), then shuffled. Currency, terms, size and
   activity are drawn per customer.
2. **Issuance.** A weight matrix `activity[customer] × month_factor[month]` is
   normalised and converted to integer invoice counts so the total is **exactly**
   the configured number for any configuration — no truncation or padding.
3. **Dates.** Business days within each month, sampled without replacement with
   weekday weights (Monday heaviest, Friday lightest).
4. **Amounts.** `base(currency) × size_factor × lognormal(0, 0.55)`, multiplied by
   1.25 in quarter-end months and rounded to cents with a floor of 50.
5. **Payments.** One delay draw per invoice from the customer's profile; partial
   invoices split into 2–3 instalments whose amounts are rounded and then
   corrected on the final instalment so the ledger sums to the invoice amount
   exactly.

`month_factor` combines a 12-month sinusoid, a quarter-end bump, a December dip
and a January uptick.

## 5. Payment behaviour

| Profile | Share | Delay (days, clipped) | Never pays | Partial rate |
|---|---:|---|---:|---:|
| early | 20% | N(−8, 2.5) ∈ [−35, −2] | 0.2% | 6% |
| on_time | 35% | N(−2, 2.0) ∈ [−10, 3] | 0.4% | 8% |
| occasional_late | 25% | 65% N(0, 3); 35% N(14, 8) | 2% | 15% |
| chronic_late | 15% | N(25, 12) ∈ [8, 70] | 5% | 22% |
| high_risk | 5% | N(45, 20) ∈ [15, 120] | 45% | 30% |

`on_time` is centred *before* the due date so the label means what it says. A
dispute flag (~0.6%) adds a 45–120 day delay and sometimes converts the invoice
into a non-payer.

Because `is_late` is measured at **final settlement**, an instalment invoice can
be late even when its first payment was on time. That is intentional and
matches how the real dataset records a single clearing date.

## 6. Temporal patterns

- **Posting holidays.** About 1.2% of business days are closed; payments that
  would land on them shift to the next business day.
- **Weekends.** Payments never post on Saturday or Sunday, which is why genuine
  zero-collection days appear (they are not injected noise).
- **Business cycles.** Monthly issuance varies approximately ±12% seasonally,
  with quarter-end peaks and a December slowdown.

## 7. Right-censoring

The simulation settles invoices up to 180 days past the window end. Those events
are then withheld, so the dataset contains what an operator would actually have
seen:

- `is_censored = true` when a payment lands after `observation_end`, **or** when
  the invoice is still unsettled but fell due within the last 90 days;
- `is_complete = false` for those rows;
- `payment_status` reflects only observed receipts.

Forecast targets therefore end 90 days before `observation_end`, so every week
used for modelling is fully observed. The metadata records how many transactions
were withheld.

## 8. Forecast targets

| File | Granularity |
|---|---|
| `data/processed/synthetic/synthetic_cash_flow_daily.csv` | one row per date × currency, including zero days |
| `data/processed/synthetic/synthetic_cash_flow_weekly.csv` | Monday-start weeks, complete weeks only |

Two measures are emitted side by side:

- **`collections_received`** — true cash: `SUM(amount_received)` at
  `payment_date`. This is what a system with a ledger would forecast.
- **`collections_clearance`** — the invoice-clearance proxy the real dataset can
  produce: full invoice amount dated at final clearing.

Keeping both means synthetic and real pipelines stay comparable.

## 9. Leak-free as-of views

`build_asof_invoice_view(invoices, transactions, as_of)` recomputes
`received_asof`, `outstanding_asof`, `status_asof` and `days_since_invoice` using
only payments dated on or before `as_of`. Features built at a forecast origin
must go through this helper rather than reading the final `payment_status`
column, which is future information.

## 10. Validation

`validate_dataset()` runs 28 checks and the CLI exits non-zero on any failure:

| Category | Checks |
|---|---|
| Schema | required columns on invoices and transactions |
| Counts | exactly the configured invoice count; unique invoice and transaction ids; referential integrity to customers |
| Dates | due date after invoice date; payments parse; no payment predates its invoice; nothing dated after the window |
| Currency | only USD/CAD; transaction currency matches its invoice |
| Amounts | positive invoices and payments; no overpayment; non-negative outstanding |
| Reconciliation | ledger sum equals `total_amount_received` (≤ 0.01); `outstanding = amount − received` |
| Status | partial invoices have receipts; paid invoices are fully covered; open invoices have none |
| Censoring | censored rows exist; recent unsettled invoices are flagged rather than called unpaid |
| Metadata | required keys present, counts match, dataset explicitly marked synthetic |

## 11. Reproducibility

```bash
backend/.venv/bin/python backend/scripts/generate_synthetic_data.py
backend/.venv/bin/python backend/scripts/generate_synthetic_data.py --seed 7 --invoices 5000
backend/.venv/bin/python -m pytest backend/tests/test_synthetic_generator.py
```

The same configuration and seed reproduce identical files; `generation_metadata.json`
stores a content hash per frame so this is checkable after the fact.

## 12. Current output (seed 20260101)

| Property | Value |
|---|---|
| Invoices | 50,000 |
| Customers | 1,400 |
| Transactions | 52,591 |
| Period | 2021-01-01 → 2023-12-31 (36 months) |
| Currency split | USD 43,595 · CAD 6,405 |
| Profile split | on_time 490 · occasional_late 350 · early 280 · chronic_late 210 · high_risk 70 |
| Censored invoices | 1,924 |
| Withheld transactions | 2,003 |
| Validation | 28 passed, 0 failed |

## 13. Limitations

- **Assumptions, not facts.** Every distribution in this document is a
  simulation choice. None is estimated from the real portfolio.
- **Easier than reality.** There is no regime break, no censoring shock and no
  data-quality dirt. Error rates on synthetic data are therefore optimistic and
  must not be quoted as expected real-world performance.
- **Simplified economics.** No credit notes, taxes, FX, write-offs or customer
  credit limits.
- **Not a benchmark.** The dataset is for code correctness, leakage testing and
  controlled experiments.

## 14. Relationship to the Model 4 experiments

Three experiments are defined in `reports/cash_flow_synthetic/AMENDMENT.md`:

| Id | Training | Evaluation |
|---|---|---|
| A | real only | real validation + holdout |
| B | synthetic only | synthetic validation + holdout |
| C | synthetic prefix + real | untouched real validation + holdout |

No production artifact changes as a result. Experiment C relocates the synthetic
history before the real window and rescales it, because the simulation covers
2021–2023 while the real extract ends in 2020; concatenating them by date would
train on the future.
