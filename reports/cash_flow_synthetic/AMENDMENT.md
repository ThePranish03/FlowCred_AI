# Amendment — synthetic-data experiments for Model 4

This file extends `reports/cash_flow/DECISIONS.md` for work done **after** the
original Model 4 evaluation closed. It does not modify that contract and it does
not change any production selection.

## What this is

A deterministic simulator produces 50,000 invoices over 36 months with a real
transaction ledger. It exists to test whether the forecasting pipeline behaves
sensibly on data with a known ground truth, exotic censoring and partial
payments — the things the real extract cannot offer.

**The synthetic data is simulated. It says nothing about real customer
behaviour, and no synthetic observation enters any real-world holdout.**

## Amendment 1 — a second data source (A / B / C)

Three independent experiments are defined, sharing the same candidate set and
the same harness:

| Id | Training data | Evaluation data |
|---|---|---|
| A | real only | real validation + real holdout |
| B | synthetic only | synthetic validation + synthetic holdout |
| C | synthetic prefix + real | untouched real validation + real holdout |

Experiment A must reproduce the recorded real-world numbers. It does: for the
non-tree candidates the WAPE is identical to the production run, and the
XGBoost candidates match once the real invoice book is supplied (the due-date
feature is derived from it).

## Amendment 2 — how C places synthetic history in time

The simulation covers 2021-2023; the real extract ends 2020-03-13. Concatenating
them in date order would train on the future for a 2019-2020 origin, which is
inadmissible.

C therefore:

1. trims the synthetic daily series to its last **complete** week, so weekly and
   daily agree;
2. relocates that history to end the day before the real extract begins;
3. rescales the synthetic amounts by `mean(real) / mean(synthetic)` per
   currency.

Step 3 is a modelling choice, not a data claim. Without it the combined series
has a ~3x level break between the synthetic and real halves, and any model would
be measuring that break rather than the value of extra history. The scale factor
is recorded per currency in `experiment_detail.json`.

Synthetic observations are prepended only. The real validation and holdout
windows contain no synthetic weeks.

## Amendment 3 — candidate set for these experiments

The experimental candidate set is: `seasonal_naive`, `xgboost_weekly`,
`xgboost_daily`, `ets`, `arima`.

The **due-date schedule baseline is excluded** on purpose. It forecasts from the
open invoice book, and the real and synthetic books are different objects with
different terms and currencies. Including it would compare two different
information sets rather than two modelling approaches.

No new algorithm was introduced. In particular **no MLP was added**: with 61
real weekly observations a neural regressor would need its own pre-registered
protocol (architecture, regularisation, early-stopping rule, seed handling)
before it could be scored, and adding it retroactively would violate the rule
that new candidates are declared before evaluation. If one is wanted later, the
protocol must be written first, in this file, and the three experiments re-run.

## What is not allowed

* Replacing `models/cash_flow_forecaster_*.joblib` with anything trained on
  synthetic data.
* Quoting a synthetic-only metric (experiment B) as evidence about the real
  business.
* Re-tuning the real model on the real holdout after seeing these results.

## Reproduce

```bash
backend/.venv/bin/python backend/scripts/generate_synthetic_data.py
backend/.venv/bin/python backend/scripts/run_synthetic_experiment.py
```

Outputs: `data/raw/synthetic/`, `data/processed/synthetic/`, and
`reports/cash_flow_synthetic/`.
