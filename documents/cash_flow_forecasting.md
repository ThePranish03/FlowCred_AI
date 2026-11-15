# Cash-Flow Forecasting (Model 4)

Technical documentation for the fourth machine-learning module in FlowCred AI.
Everything below is reproducible from the repository: derived data in
`data/processed/cash_flow_*.csv`, candidates and metrics in
`reports/cash_flow/`, and one production artifact per currency in `models/`.

---

## 1. Business problem

FlowCred AI already answers two questions about receivables:

1. Will this invoice be paid late? (classifier)
2. How many days late? (regressor)

Both are **invoice-level** questions. Finance teams also need an **aggregate**
question: *how much cash will actually clear over the next week, month and
quarter?* That is a time-series forecasting problem, not a classification
problem, and it needs its own data shape, its own validation scheme and its own
failure modes.

Model 4 therefore forecasts **weekly collections per currency** for 7-, 30- and
90-day horizons, reporting uncertainty and refusing to overstate what the data
can support.

---

## 2. Target definition

For each calendar date and currency:

```
collections(date, currency) = SUM(invoice_amount)
    over invoices where invoice_status = 'paid'
    and payment_date = date
    and invoice_currency = currency
```

Rows are filtered to `paid` invoices with a valid `payment_date`, a positive
`invoice_amount`, and USD or CAD only. The observed window is
**2019-01-03 → 2020-03-13**.

### This is a proxy, not verified cash

The dataset contains **no payment ledger, no amount-received column and no
partial-payment marker**. `invoice_amount` is the source's `total_open_amount`,
which for a partially settled invoice may be a **residual balance** rather than
the cash that actually arrived.

Therefore:

- the target is an **invoice-clearance proxy**: `collection ≈ invoice_amount` on
  the clearing date;
- it assumes the invoice amount represents the collection associated with that
  date;
- it must **never** be described as bank-verified cash inflow;
- transaction-level payment data is required before any claim of verified cash.

The proxy lives in exactly one function, `build_target(source)` in
`backend/app/cash_flow_target.py`, which returns
`date, currency, collections, invoice_count, is_complete`. A future payment
ledger can replace that implementation without touching feature building,
training or serving.

---

## 3. Dataset limitations

| Limitation | Consequence |
|---|---|
| Right-censored extract: 0% of March-2020+ invoices are marked paid | Everything after 2020-03-13 is excluded; no "current" forecast is possible |
| No payment ledger | Target is a clearance proxy (section 2) |
| `baseline_create_date` and both `document_create_date` columns are all `1970-01-01` | Only `invoice_date` can be used as an issuance timestamp |
| Median payment term ≈ 15 days | Beyond ~2 weeks the open book is sparsely populated (section 5) |
| Only 61 complete weekly observations | No annual seasonality can be estimated; parameter budgets must stay tiny |
| Mixed USD/CAD with no FX table | Currencies are modelled independently; aggregates are nominal |
| 6 paid CAD rows have a blank `invoice_id` | Kept as genuine observations; they cannot be deduplicated but are not duplicates |
| Holdout contains a structural break | Week of 2020-01-06 collapses (USD 1.02M vs 17.4M mean; CAD 0). All models degrade there |

---

## 4. Daily and weekly aggregation

- **Daily series**: one row per (date, currency) for all 436 calendars days,
  including **genuine zero-collection days** (USD 84, CAD 146). Zeros are real
  observations and are never forward-filled.
- **Weekly series**: Monday-start weeks, aggregated from daily. Only weeks
  **fully bounded** by the observed window are used: **61 weeks,
  2019-01-07 → 2020-03-02**.
- Two weeks are excluded as truncated:
  - `2018-12-31 → 2019-01-06` (window begins Thursday, so Mon–Wed are unobserved)
  - `2020-03-09 → 2020-03-15` (window ends Friday, so the weekend is unobserved)

Weekly totals are the modelled quantity. Daily values are **derived estimates**
(section 12), never independently trained forecasts.

---

## 5. Baseline methodology

### B1 — Seasonal-naive

Next week equals the most recently observed week. With 61 weekly points there
is no annual cycle to exploit, so at weekly frequency this is a carry-forward
forecast. It is a weak reference (section 11).

### B2 — Due-date schedule (leak-free reconstruction)

Expected collections for week `w` are the sum of amounts **due** in `w`,
restricted to invoices **issued at or before the forecast origin**
(`invoice_date ≤ week_end(origin)`). No payment outcome and no future-issued
invoice is visible. Including only `paid` invoices would have been hindsight —
paid status is a future outcome — so all issued invoices are counted.

Measured per forecast step:

| Currency | step 1 | step 2 | step 4 | step 8 | step 13 |
|---|---:|---:|---:|---:|---:|
| USD WAPE | **0.062** | **0.069** | 0.923 | 0.986 | 0.998 |
| CAD WAPE | **0.146** | 0.303 | 0.977 | 1.000 | 1.000 |

**Interpretation, and an important nuance.** The descriptive correlation of
~0.94 reported during exploration was computed with *all* invoices, including
ones issued after the date being predicted — that is hindsight. Under a strict
leak-free reconstruction the schedule is still strong **one to two weeks
ahead** (USD 6.2% then 6.9%; CAD 14.6% then 30.3%) and then collapses sharply at
step 4 (92%+). The reason is structural: median payment terms are ~15 days, so
by the end of the origin week the invoices falling due one and two weeks later
have already been issued, while week three onwards has not.

B2 is therefore treated as a **1–2 week reference benchmark**. It is *not* a
valid multi-step baseline for a 30- or 90-day product, and its preliminary
6.4%/19.3% descriptive figures are **not** presented as validated
multi-horizon performance.

---

## 6. XGBoost methodology

Two variants, both trained only on data available at each origin.

### C1a — direct multi-horizon on weekly totals

One model is trained on stacked rows `(features at origin i, step k) → y[i+k]`,
so a single fit covers every horizon and `k` is itself a feature.

Features: weekly lags 1–4, rolling means (4/8/12) and standard deviations (4/12),
the step index, target month/week-of-year, the leak-free due-date amount for the
target week, that amount relative to the 4-week mean, and the available history
length.

### C1b — recursive daily model aggregated to weeks

A daily model (lags 1–3/7/14/28, rolling 7/14/28, weekday, weekend flag,
due-today amount and its ratio to the 28-day mean) is rolled forward one day at
a time for `7 × steps` days, then aggregated into weekly totals.

### Overfitting controls

61 weekly observations cannot support tuning. Hyper-parameters are **fixed and
conservative** (`max_depth` 2–3, `learning_rate` 0.03, `reg_lambda` 2.0,
`min_child_weight` 5), and no search is performed, so validation folds are not
used for model selection *and* tuning at once.

---

## 7. Exponential smoothing

Damped-trend Holt (`trend="add"`, `damped_trend=True`, `seasonal=None`).

- Damping prevents an estimated trend from extrapolating indefinitely, which
  matters for a series that mean-reverts.
- **No seasonal terms**: 61 weeks is under two annual cycles, so any annual
  seasonality estimate would be an artefact.
- A 12-combination deterministic grid over (α, β, φ) is selected by in-sample
  one-step SSE. Predictions are clipped at zero.

## 8. ARIMA

Weekly ARIMA with the differencing order chosen by ADF on the levels
(d = 0 if p < 0.05, else 1), then a **5-candidate** (p, q) grid selected by AIC.
Seasonal terms are deliberately absent: there is no annual cycle to model, and
a weekly seasonal term would consume degrees of freedom the sample cannot
afford. Failed fits are caught; if every candidate fails the model falls back to
a naive last-value forecast (flagged on the object). Negative forecasts are
clipped to zero.

`statsmodels 0.15.0` was verified to install and run on **CPython 3.14.7** with
numpy 2.4.3 / pandas 3.0.1 / scipy 1.17.1, so ETS and ARIMA are genuine
candidates rather than documented-unavailable placeholders.

---

## 9. Chronological backtesting

Expanding-origin, strictly chronological. No shuffling, no random split.

| Purpose | Origins (weekly index) | Dates | Folds |
|---|---|---|---:|
| Validation / selection | 22 … 47 | 2019-06-16 → 2019-12-08 | 26 |
| Untouched holdout | 48 … 59 | 2019-12-15 → 2020-03-01 | 12 |
| Production origin | 60 | week ending 2020-03-08 | — |

A forecast at origin `o` may use only `y[0..o]`. Every candidate is evaluated on
**identical** folds by the same harness (`backend/scripts/cashflow/harness.py`),
which is also what enforces the leakage boundary.

An automated test mutates every value after an origin and asserts that the
prediction is unchanged, and a separate test asserts that an invoice issued
after the origin cannot enter the due-date schedule.

---

## 10. Metrics

- **MAE**, **RMSE**, **WAPE** at (a) pooled weekly steps 1–13 and (b) 7/30/90-day
  horizon totals.
- **MAPE is never used.** Zero-collection weeks exist (CAD has one) and the daily
  denominator spans three orders of magnitude; MAPE would be undefined or
  meaningless.
- WAPE = Σ|actual − predicted| / Σ|actual|, so it is scale-free and defined with
  zeros present.

---

## 11. Model selection and results

Rule, declared before candidates were scored (see
`reports/cash_flow/DECISIONS.md`): a candidate must beat the best valid baseline
by **≥ 10% relative WAPE** on the **weekly path (steps 1–13)** *and* beat it on
**≥ 4 validation origins**; otherwise the baseline ships. Selection is separate
per currency.

### Validation — weekly path WAPE (26 origins, 338 weekly points)

| Candidate | USD | CAD |
|---|---:|---:|
| Due-date schedule (1–2 week reference only) | 0.8171 | 0.8573 |
| Seasonal-naive | 0.1774 | 0.3555 |
| XGBoost — weekly direct | 0.1406 | 0.3439 |
| **XGBoost — daily recursive** | **0.1219** | 0.3475 |
| Exponential smoothing | 0.1913 | 0.3520 |
| ARIMA | 0.1701 | **0.2992** |

### Horizon totals — validation WAPE

| Candidate | USD h7 | USD h30 | USD h90 | CAD h7 | CAD h30 | CAD h90 |
|---|---:|---:|---:|---:|---:|---:|
| Due-date schedule | **0.0622** | 0.4995 | 0.8102 | 0.1462 | 0.5651 | 0.8456 |
| Seasonal-naive | 0.1041 | 0.0945 | 0.1183 | 0.2131 | 0.1920 | 0.2387 |
| XGBoost weekly | 0.0978 | 0.0821 | 0.0805 | 0.1871 | 0.1572 | 0.2201 |
| **XGBoost daily** | 0.0778 | **0.0532** | **0.0538** | 0.2261 | 0.1691 | 0.1623 |
| ETS | 0.0875 | 0.0798 | 0.1333 | 0.1958 | 0.1552 | 0.2281 |
| **ARIMA** | 0.0995 | 0.0881 | 0.1045 | 0.1792 | **0.1318** | **0.1237** |

### Selection

| Currency | Selected | Weekly WAPE | Best baseline | Relative improvement | Origins beating baseline |
|---|---|---:|---|---:|---:|
| **USD** | **XGBoost (daily → weekly)** | 0.1219 | seasonal-naive 0.1774 | **31.3%** | 25 / 26 |
| **CAD** | **ARIMA (weekly)** | 0.2992 | seasonal-naive 0.3555 | **15.8%** | 19 / 26 |

Both clear the 10%/4-origin bar, so no baseline is forced into production and no
ML model is forced in either. The two currencies legitimately select **different
algorithms** — CAD is far more volatile (weekly CV 0.434 vs 0.234) and has a
zero week, which favours a well-specified linear time-series model over tree
ensembles.

### Untouched holdout — and why it looks worse

| Candidate | USD h30 | CAD h30 |
|---|---:|---:|
| XGBoost daily / ARIMA selected | 0.2839 | 0.6446 |
| Seasonal-naive | 0.4833 | 0.8676 |

Holdout errors are several times validation errors for **every** model,
including the baselines. The cause is visible in the data: the week of
2020-01-06 collapses to USD 1,018,573 (vs a 17.4M mean) and CAD **0**, then
recovers slowly. That is a structural break in the extract, not a modelling
failure. It is reported rather than excluded, and it is the reason validation —
not holdout — is the pre-declared selection basis.

---

## 12. Forecast horizons and derived daily estimates

- Horizons are exactly **7, 30 and 90 days**, starting the day after `asOf`.
- Weekly predictions are authoritative; a 30-day horizon touches 5 weekly blocks,
  a 90-day horizon 13.
- Daily values are derived: `daily(day) = week_total × weekday_share(weekday)`,
  with **currency-specific** shares computed from training-window data only
  (never hardcoded, never uniform ÷7 — CAD's Friday share is 0.34, so uniform
  division would be badly wrong).
- Every daily point carries `isEstimate: true`.
- `SUM(daily) == horizonTotal` to within 0.01, asserted by an automated test for
  all three horizons.
- Intervals are empirical residual quantiles from validation folds, mapped per
  step and allocated to days the same way, so
  `lower ≤ predicted ≤ upper` holds for every day and every total.

**90-day honesty:** the holdout cannot contain a 90-day fold (only 12 weeks of
holdout remain), so 90-day accuracy is validated on the 26 validation origins
only. Beyond the observed regime this is extrapolation and is labelled as such.

---

## 13. Dashboard integration

- `GET /api/v1/cash-flow/forecast?currency=&horizon=&asOf=` — pure, writes
  nothing, served from the artifact's frozen `replay` grid so the same `asOf`
  always reproduces the same numbers.
- `GET /api/v1/cash-flow/health` — forecast-only readiness.
- `GET /api/v1/cash-flow/runs` — persisted run history.
- `POST /api/v1/cash-flow/runs` — admin / business_owner only, audited.

The frontend page shows summary cards, the weekly forecast against history with
the backtest band, the model-comparison table, the selected model and its
selection reason, the derived daily estimates table, the as-of banner and the
proxy disclaimer. Demo mode serves a fixture generated from the real artifacts.

Forecasting readiness is deliberately **separate** from the three-model health
gate: `MODEL_IDS` is unchanged, and a missing forecast artifact leaves
`/api/v1/health` at 200. A test asserts exactly that.

---

## 14. Assumptions

1. The invoice amount approximates the collection on its clearing date.
2. USD and CAD evolve independently; no FX conversion.
3. Historical weekday collection shares are stable enough to allocate weekly
   totals across days.
4. The 2019–2020 regime is informative for the forecast origin, with a
   documented break in early 2020.
5. Weekly totals are the right modelling frequency; daily noise is largely
   weekday seasonality.
6. Backtest residual quantiles are a reasonable interval proxy.

## 15. Limitations and future improvements

- **Proxy target.** Verified cash forecasting needs a payment ledger with
  amount-received and partial-payment support.
- **Censored history.** No data after 2020-03-13; every forecast is a historical
  simulation, not a live projection.
- **Short sample.** 61 weekly observations limit model complexity and make the
  due-date schedule unusable beyond one week — an information limit, not a bug.
- **Regime break.** Early-2020 behaviour is anomalous; change-point detection or
  robust loss would help.
- **No FX.** Mixed-currency totals remain nominal.
- **Improvements worth trying:** hierarchical reconciliation between daily and
  weekly, conformal prediction intervals, exogenous drivers (customer segments,
  payment terms, holidays), and automated retraining once fresh data arrives.

---

## Presenting this to a professor (short version)

> We built a fourth model that forecasts how much cash will come in each week,
> separately for USD and CAD.
>
> The data has one big catch: there is no payment ledger, so we cannot know the
> exact cash received per invoice. We therefore forecast an **invoice-clearance
> proxy** and say so explicitly.
>
> We modelled **weekly totals**, because daily data is dominated by weekday
> patterns. Daily numbers you see in the dashboard are estimates derived from
> weekly totals using historical weekday shares — never a separate model.
>
> We compared six approaches: two baselines, XGBoost (two variants), exponential
> smoothing and ARIMA. All were judged with **chronological rolling-origin
> backtesting** — we never shuffle time — using MAE, RMSE and WAPE, and we never
> use MAPE because some weeks have zero collections.
>
> The headline result is that **no single algorithm wins everywhere**. USD chose
> XGBoost on daily features aggregated to weeks (31% better than the best
> baseline); CAD chose ARIMA (16% better). That is the honest outcome of a
> pre-declared selection rule, not a preference.
>
> The most interesting finding is a **structural** one: the due-date schedule is
> extremely accurate one to two weeks ahead (about 6–7% WAPE on USD) and useless
> from roughly week three, because invoices are issued only about two weeks
> before they fall due. It tells you what is already in the open book, not what
> will be invoiced later. Early exploratory numbers that made it look strong
> everywhere were leaking invoices issued in the future.
>
> Finally, forecasting readiness is kept separate from the existing three-model
> health check, so a missing forecast model can never take the product down.
