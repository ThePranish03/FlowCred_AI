# Amendment E — synthetic augmentation for XGBoost and statistical models

Registered **before** any Experiment E candidate was evaluated. Extends
`reports/cash_flow/DECISIONS.md` and `AMENDMENT.md`/`AMENDMENT_D.md`. It does not
change Experiments A–D, the production selection, or any artifact.

## Verified inputs

| Input | Value |
|---|---|
| Real weekly | 61 weeks, 2019-01-07 → 2020-03-02 |
| Synthetic weekly | 143 weeks, 2021-01-04 → 2023-09-25 |
| Temporal overlap | none |
| USD | real mean 17.41M, CV 0.236 · synthetic mean 5.07M, CV 0.204 · **3.44× level gap** |
| CAD | real mean 2.78M, CV 0.438 · synthetic mean 0.59M, CV 0.261 · **4.69× level gap** |
| xgboost 3.4.1 | `fit(xgb_model=...)` continuation and `sample_weight` both supported |

CAD's synthetic series is markedly smoother than the real one (0.261 vs 0.438),
so synthetic-only results for CAD will look better than reality for reasons that
have nothing to do with augmentation.

## Feature parameterisations (declared)

Two are used, and they are never mixed within a comparison:

| Name | Definition | Used by |
|---|---|---|
| `raw` | production features: absolute amounts scaled by 1e6, due-date ratio | reference only (E0p) |
| `scaled` | identical structure, every amount divided by the mean of the fit window | E0s, E1, E2 |

Reason: with a 3.44×/4.69× level gap, a tree trained on synthetic thresholds is
meaningless on real features. Scaling is what makes transfer testable at all. It
is applied to **both** the ablation and the augmented arm, so the comparison
isolates augmentation rather than conflating it with a feature change.

E0s (`real-only`, scaled features) is therefore the correct ablation for E1/E2.
E0p (production numbers) is cited separately and never used as the E1/E2
comparison.

## Arms

| Id | Procedure |
|---|---|
| **E0p** | production result, cited from `reports/cash_flow/model_comparison.csv` |
| **E0s** | real-only XGBoost (weekly and daily) with `scaled` features |
| **E1** | synthetic-pretrained weekly XGBoost, continued on real rows via `xgb_model` |
| **E2w** | weekly XGBoost on level-matched synthetic rows + real rows, sample weights real 1.0 / synthetic 0.25 |
| **E2d** | daily-recursive XGBoost on level-matched synthetic days + real days, same weights |
| **E3** | ARIMA and ETS on three series each: real-only, synthetic-only, hybrid |

## What is deliberately not evaluated

**E1 for the daily-recursive model.** Warm-starting a daily booster across
domains is not technically valid here: the model predicts one day ahead and is
fed its own output, so a 4.7× level offset plus a different holiday calendar
would compound inside the recursion. The daily model is still compared in E0s
and E2d, where every input is level-matched. This is recorded as a limitation,
not silently skipped.

## Level matching and chronology

Synthetic history is always placed **before** the real window and never after
it. For E2/E3-hybrid the synthetic values are multiplied by
`mean(real) / mean(synthetic)` per currency so the two halves share a level;
the factor is recorded. Without it, every model would be measuring the seam.

No synthetic value is ever dated inside the real validation or holdout window.

## Transition validity (a result, not an assumption)

Concatenating two domains creates an artificial step. E3 reports it explicitly:

```
transition_ratio = |mean(last 4 synthetic weeks) - mean(first 4 real weeks)|
                   / MAD(week-over-week change within the real window)
```

A ratio near 1 means the seam is indistinguishable from ordinary weekly
movement; a large ratio means the hybrid series contains an artefact that a
model can see. For every hybrid result the ratio is reported next to the metric,
and **a hybrid that looks good only where the ratio is large is not evidence**.

## Evaluation

Existing harness and folds: validation origins 22–47 for the decision, holdout
48–59 for confirmation. Weekly-path WAPE primary; horizon-total WAPE at 7/30/90
and MAE/RMSE reported alongside. Per-origin WAPE is exported.

XGBoost runs with seeds `13, 42, 101` (bagging/column sampling); ETS and ARIMA
are deterministic and reported once.

Synthetic-only arms are evaluated on synthetic origins and are labelled
`partition=synthetic`. They exist for sensitivity only and can never be promoted.

## Acceptance rule

A candidate qualifies only if, per currency:

1. validation WAPE improves ≥ 10% relative versus its **corresponding**
   real-only arm (E1/E2 vs E0s; hybrid E3 vs real-only E3), and
2. it beats that arm on ≥ 4 validation origins.

Nothing else qualifies. A candidate that only wins in synthetic-only evaluation
is recorded as a failure.

## Prohibitions

- No holdout use for scaling, weighting, early stopping or tuning.
- No synthetic week inside the real holdout.
- No change to `models/*.joblib`, APIs, dashboard, or A–D outputs.
- Synthetic observations are never described as real historical observations.

## Reproduction

```bash
backend/.venv/bin/python backend/scripts/run_experiment_e.py
```
