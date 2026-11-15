# Cash-flow data quality report (Model 4)

Source: `data/processed/flowcred_cleaned.csv` — 48,839 rows.

Observed window: **2019-01-03 → 2020-03-13** (436 calendar days).
Complete Monday-start weeks: **61** (2019-01-07 → 2020-03-02).
Excluded (truncated): 2018-12-31→2019-01-06 and 2020-03-09→2020-03-15.

## Row reconciliation

| Filter | Rows dropped |
|---|---:|
| not `paid` | 9,681 |
| currency not USD/CAD | 0 |
| missing `payment_date` | 0 |
| invalid/non-positive amount | 0 |
| `payment_date` outside window | 343 |
| **retained** | **38,815** |

## Per-currency series

| Currency | Weekly n | Mean | CV | Zero weeks | Zero days | Active days | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| USD | 61 | 17,414,225 | 0.234 | 0 | 84 | 352 | 1,075,224,732 |
| CAD | 61 | 2,783,854 | 0.434 | 1 | 146 | 290 | 170,644,111 |

Zero-collection days are genuine observations and are never forward-filled.

## Target definition (proxy — not verified cash)

```
collection_proxy(date, currency) = SUM(invoice_amount) of invoices with invoice_status == 'paid' whose payment_date falls on that date, grouped by invoice_currency. Invoice-clearance proxy, not verified cash received.
```

Limitations:

- Source data has no payment ledger and no amount-received column; invoice_amount is the source's total_open_amount.
- For partially settled invoices, invoice_amount may be a residual balance, so the clearing-date amount can over- or under-state cash actually received.
- The model therefore forecasts invoice clearance, not bank-confirmed cash inflow.
- A transaction-level payment ledger is required before these figures may be described as verified cash received.

## Weekday shares (training-window, used for partial-week allocation)

| Currency | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---:|---:|---:|---:|---:|---:|---:|
| USD | 0.233 | 0.232 | 0.167 | 0.160 | 0.203 | 0.003 | 0.000 |
| CAD | 0.229 | 0.144 | 0.131 | 0.155 | 0.341 | 0.000 | 0.000 |
