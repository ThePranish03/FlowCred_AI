# Experiment E — synthetic augmentation for XGBoost and statistical models

Protocol: `AMENDMENT_E.md`, registered before any candidate ran.
Production artifacts and selection are unchanged.

## Domain seam (why hybrid arms need scrutiny)

| Currency | Synthetic tail (matched) | Real head | Typical weekly change | Seam ratio (raw → matched) | Level factor |
|---|---:|---:|---:|---:|---:|
| USD | 14,056,592 | 9,847,696 | 1,820,031 | 3.16× → **2.31×** | 3.44 |
| CAD | 2,304,804 | 1,081,942 | 798,295 | 0.74× → **1.53×** | 4.69 |

A seam ratio near 1 means the join is indistinguishable from an ordinary
week. Larger values mean the hybrid series contains a step that a model
can see.

## Acceptance (>=10% relative improvement and >=4 origins, per currency)

| Currency | Candidate | Real-only WAPE | Augmented WAPE | Relative | Origins | Verdict |
|---|---|---:|---:|---:|---:|---|
| USD | XGBoost weekly (E1 pretrain) | 0.1426 | 0.1747 | -22.5% | 3/26 | **worsened** |
| USD | XGBoost weekly (E2w combined) | 0.1426 | 0.1652 | -15.8% | 6/26 | **worsened** |
| USD | XGBoost daily (E2d combined) | 0.1219 | 0.1475 | -21.0% | 4/26 | **worsened** |
| USD | ARIMA (hybrid) | 0.1701 | 0.1586 | +6.8% | 17/26 | **no material change** |
| USD | ETS (hybrid) | 0.1913 | 0.1640 | +14.3% | 13/26 | **improved** |
| CAD | XGBoost weekly (E1 pretrain) | 0.3381 | 0.3497 | -3.4% | 10/26 | **worsened** |
| CAD | XGBoost weekly (E2w combined) | 0.3381 | 0.2708 | +19.9% | 18/26 | **improved** |
| CAD | XGBoost daily (E2d combined) | 0.3475 | 0.3310 | +4.8% | 15/26 | **no material change** |
| CAD | ARIMA (hybrid) | 0.2992 | 0.2997 | -0.1% | 14/26 | **no material change** |
| CAD | ETS (hybrid) | 0.3520 | 0.3264 | +7.3% | 19/26 | **no material change** |

## Recommendation per algorithm

* **ARIMA (hybrid)** — does not qualify on any currency. Keep real-only.
* **XGBoost daily (E2d combined)** — does not qualify on any currency. Keep real-only.
* **XGBoost weekly (E1 pretrain)** — does not qualify on any currency. Keep real-only.
* **XGBoost weekly (E2w combined)** — qualifies on CAD. Still requires a
  separate decision before any production change; it was not promoted.
* **ETS (hybrid)** — qualifies on USD. Still requires a
  separate decision before any production change; it was not promoted.

## Seam warning

* **USD** — the level-matched seam is 2.31× a typical weekly move. Any hybrid gain on this currency may partly be the model reacting to that step rather than to genuine prior information, so the hybrid result is reported as inconclusive rather than as evidence.

## Synthetic-only arms

ARIMA and ETS were also fitted on the synthetic series alone and scored on
synthetic origins (`partition=synthetic`). Those numbers appear in
`experiment_e_results.csv`, are labelled, and can never be promoted: they
measure the simulator, not the business.

## Caveats

* CAD's synthetic series is smoother than the real one (CV 0.261 vs 0.438),
  so synthetic-only CAD results flatter any model that sees them.
* Hybrid arms place a rescaled synthetic history before the real window;
  the seam ratio above quantifies how artificial that join is.
* The real holdout is dominated by the 2020-01-06 collection collapse and is
  used only for confirmation, never for selection.
