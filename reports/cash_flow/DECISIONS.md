# Model 4 — pre-registered evaluation and selection contract

This file records the decisions **before** candidate results were inspected.
Anything changed after the fact is listed under "Amendments" with its reason.

## Target

`collection_proxy(date, currency) = SUM(invoice_amount)` over invoices with
`invoice_status = 'paid'` whose `payment_date` equals `date`, grouped by
`invoice_currency`.

This is an **invoice-clearance proxy, not verified cash received**. The source
has no payment ledger and no amount-received column. See
`documentation section 6` in `documents/cash_flow_forecasting.md`.

## Window

- Observed daily window: **2019-01-03 → 2020-03-13** (436 days).
- Weekly series: Monday-start weeks fully bounded by that window →
  **61 observations, 2019-01-07 → 2020-03-02**.
- Excluded as truncated: `2018-12-31→2019-01-06` (window starts Thursday) and
  `2020-03-09→2020-03-15` (window ends Friday).
- Genuine zero-collection days are kept as zeros. Nothing is forward-filled.

## Frequency

Weekly totals are the modelled target. Daily values are **derived estimates**
allocated by historical weekday shares; they are never independently trained
forecasts and are always labelled `isEstimate: true`.

## Candidate set

| Id | Candidate |
|---|---|
| B1 | Seasonal-naive (next week = last observed week) |
| B2 | Due-date schedule (sum of amounts due in the target week, restricted to invoices issued at or before the origin) |
| C1a | XGBoost, direct multi-horizon on weekly totals |
| C1b | XGBoost, recursive daily model aggregated to weeks |
| C2 | Exponential smoothing, damped trend, weekly |
| C3 | ARIMA on weekly totals, low-order search |

An extra `expanding_mean` reference is reported for context but is **not** a
selection baseline.

## Folds

Chronological, expanding origin, no shuffling.

| Purpose | Origins (weekly index) | Dates |
|---|---|---|
| Validation / selection | 22 … 47 (26 origins) | 2019-06-16 → 2019-12-08 |
| Untouched holdout | 48 … 59 (12 origins) | 2019-12-15 → 2020-03-01 |
| Production origin | 60 | week ending 2020-03-08 |

A forecast at origin `o` may use only `y[0..o]`. Due-date features may only use
invoices with `invoice_date <= week_end(o)`.

## Metrics

MAE, RMSE, WAPE. **MAPE is never used**: zero-collection weeks exist and the
daily denominator spans three orders of magnitude.

Reported at: pooled weekly steps 1–13, and horizon totals for 7 / 30 / 90 days.

## Selection rule (pre-declared)

1. Primary metric: **weekly-path WAPE pooled over steps 1–13** on the 26
   validation origins. It scores the actual weekly path rather than an
   aggregate that can average errors away.
2. The best **valid baseline** is the reference.
3. A model candidate qualifies only if it achieves **≥ 10% relative WAPE
   improvement** over that baseline **and** beats it on **≥ 4 validation
   origins**.
4. If no candidate qualifies, the best valid baseline ships.
5. Selection happens **separately per currency**.

## Baseline validity — a measured, not assumed, decision

B2 was reconstructed leak-free and measured per step. It is strong for two weeks
and then collapses:

| Currency | step 1 | step 2 | step 4 | step 8 |
|---|---:|---:|---:|---:|
| USD | 0.062 | 0.069 | 0.923 | 0.986 |
| CAD | 0.146 | 0.303 | 0.977 | 1.000 |

Cause: median invoice terms are ~15 days, so by the end of the origin week the
invoices falling due in the next two weeks have been issued; week three onwards
has not. B2 is therefore a **1–2 week reference**, not a valid multi-step
baseline, and it is excluded from the primary comparison for steps 3–13. Its
short-horizon performance is reported in full.

## Amendments

- **2026-11-15 — horizon alignment.** The first harness build started the
  horizon on the forecast origin (a Monday) instead of the following day,
  shifting every horizon total by six days. Fixed before any result was
  recorded. Re-run numbers only are reported.
- **2026-11-15 — due-date status filter.** The first reconstruction restricted
  the schedule to `paid` invoices, which is hindsight (paid status is a future
  outcome). Changed to include all issued invoices, open or paid.
- **2026-11-15 — due-date cut-off date.** `DueDateSchedule.fit` originally cut
  the schedule at the origin week's **Monday**, discarding invoices issued
  Tuesday–Sunday of that same week even though they were known by the week end.
  Corrected to the week **end**. This can only strengthen B2, never weaken it,
  and was applied before the final comparison run.
- **2026-11-15 — horizon intervals.** Interval bands for the 7/30/90-day totals
  are now estimated from **horizon-level** residuals rather than by summing
  per-week bands, which would have assumed quantiles scale linearly with the
  mean. Weekly points keep per-step bands.
- **2026-11-15 — replay shares.** Historical replays store the weekday shares
  known at each origin, so a replay never allocates days with shares estimated
  from later data.
