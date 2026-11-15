# Amendment D — synthetic pretraining + real adaptation (MLP)

Registered **before** any MLP evaluation was run. This extends
`reports/cash_flow/DECISIONS.md` and `AMENDMENT.md`; it does not alter
Experiments A/B/C, the production selection, or any artifact.

## Question

Does pretraining on synthetic weekly collections improve a neural forecaster's
real-world accuracy, compared with the same architecture trained on real data
only?

## Verified inputs (checked, not assumed)

| Input | Value |
|---|---|
| Synthetic weekly | 143 weeks per currency, 2021-01-04 → 2023-09-25 |
| Real weekly | 61 weeks, 2019-01-07 → 2020-03-02 |
| Temporal overlap | none |
| Level gap | USD 5.07M vs 17.41M (3.4×); CAD 0.594M vs 2.78M (4.7×) |
| Folds | validation 22–47, holdout 48–59, production 60 |

## Representation — scale-free by construction

The two domains differ by 3–5× in level and never overlap in time. Raw-amount
training would force the output layer to relearn that offset during adaptation,
which would make "pretraining helped" indistinguishable from "the level was
rescaled".

Every quantity is therefore expressed relative to the **trailing mean of the
fit window**:

```
base = mean(y[0..origin])              # history only, never future
target_t = y[t] / base
feature  = y[t-k] / base, mean(...)/base, std(...)/base
```

Predictions are multiplied back by `base` after the fact. The base is computed
per origin from permitted history only, so this introduces no leakage.

## Architecture

```
11 inputs → Dense 64 (ReLU) → Dense 32 (ReLU) → Dense 1 (linear)
L2 alpha = 1e-3
Adam, lr 1e-3 (pretrain) / 3e-4 (adaptation)
batch = min(16, n_rows)
max_iter 400 (pretrain) / 200 (adaptation)
early_stopping = True, validation_fraction = 0.2, n_iter_no_change = 10
```

Early-stopping validation is carved from the rows being fitted at that stage.
It never touches the holdout, the validation origins, or the test window.

## Features (identical in both domains)

lag 1–4, rolling mean 4 / 8 / 12, rolling std 4 / 12 (all divided by `base`),
and week-of-year sine/cosine. Eleven inputs, no due-date feature: the invoice
book does not transfer between domains.

Rows start once lag-4 and rolling-12 exist, so a fit at origin `o` has `o - 11`
training rows. **This is the known weakness of the ablation**: at origin 22 the
real-only arm has 11 rows. That is a property of 61 weeks of data, not a flaw to
be tuned away, and per-origin results are reported rather than only averages.

## Arms

| Arm | Procedure |
|---|---|
| **D0** | MLP trained on real rows only, at each origin |
| **D1** | pretrain on all 143 synthetic weeks (once per currency/seed), then `warm_start` adaptation on real rows at each origin |

Pretraining uses a `StandardScaler` fitted on the synthetic feature matrix and
**reused** during adaptation, so the input space does not shift mid-transfer.
D0 fits its scaler on its own real training rows.

## Seeds

`13, 42, 101`. Every reported metric is mean ± std across seeds. The decision
uses `mean − 1 std`, so a lucky seed cannot carry the result.

## Evaluation

Existing harness, existing folds: validation origins 22–47 for the decision,
holdout 48–59 for one confirmation. Metrics: WAPE, MAE, RMSE at the weekly path
and at 7/30/90-day totals. Per-origin WAPE table included.

References: production USD XGBoost (daily→weekly), production CAD ARIMA and
seasonal-naive, taken from the recorded results — not re-tuned here.

## Decision rule

D1 is "materially better" for a currency only if all three hold:

1. weekly-path WAPE improves ≥ 10% relative versus **D0**;
2. it wins on ≥ 4 validation origins;
3. `mean − 1 std` across seeds still beats D0.

Otherwise the verdict is **"no material change"**, or "worsened", and the MLP
stays experimental. Passing does not change production: the shipped model keeps
its position unless D1 also beats it under the original rule.

## Prohibitions

- No synthetic week in the real holdout.
- No holdout use for scaling, early stopping, feature choice or tuning.
- No change to `models/*.joblib`, the API, or the dashboard.
- Synthetic weekly data is not evidence about real dynamics.

## Reproduction

```bash
backend/.venv/bin/python backend/scripts/run_experiment_d.py
```

## Implementation guards (registered before evaluation)

These are fixed by data scarcity rather than tuned:

| Condition | Behaviour |
|---|---|
| training rows < 3 | no fit; predict the trailing mean |
| training rows < 10 | early stopping disabled and `max_iter` capped at 100, because a 20% split of ≤9 rows leaves nothing to monitor |
| steps > 1 | recursive: the prediction is appended to the history and features are recomputed |

The `base` normaliser is held fixed at the value from the fit window for the
whole horizon, so multi-step forecasts cannot drift through a moving
denominator.
