# Experiment D — synthetic pretraining + real adaptation (MLP)

Protocol: `AMENDMENT_D.md`, committed before any MLP evaluation.
Production selection is unchanged; the MLP remains experimental.

| Currency | Arm | Validation WAPE (mean ± std over seeds) | Holdout WAPE |
|---|---|---|---:|
| USD | D0 real-only | 0.3998 ± 0.0915 | 1.1992 |
| USD | D1 pretrained | 0.2078 ± 0.0069 | 0.6142 |
| CAD | D0 real-only | 0.4782 ± 0.0667 | 1.1660 |
| CAD | D1 pretrained | 0.3747 ± 0.0260 | 1.0829 |

## Reference points (recorded, not re-tuned)

| Currency | Production model | Seasonal-naive |
|---|---:|---:|
| USD | 0.121885 | 0.177423 |
| CAD | 0.299219 | 0.355547 |

## Verdict on the pretraining question

* **USD: improved** — D1 vs D0 relative WAPE +48.0%, better on 23/26 validation origins, stable across seeds: True.
* **CAD: improved** — D1 vs D0 relative WAPE +21.6%, better on 20/26 validation origins, stable across seeds: True.

## Does the MLP qualify for production? No.

The original rule requires a candidate to beat the best valid baseline by
at least 10% relative WAPE. The MLP was never close:

| Currency | D1 (pretrained MLP) | Best reference | Gap | Qualifies |
|---|---:|---:|---:|---|
| USD | 0.2078 | 0.1219 | +70.5% worse | **no** |
| CAD | 0.3747 | 0.2992 | +25.2% worse | **no** |

So the answer is two-sided and both halves matter:

1. **Pretraining works.** Validation error falls by 48.0% (USD), 21.6% (CAD), and the
   effect is seed-stable. Holdout: USD 1.1992 -> 0.6142, CAD 1.1660 -> 1.0829.
2. **The neural model still loses.** Even pretrained it remains worse than
   the best reference on every currency, so synthetic data closed the gap
   between two weak models without producing a competitive one.

The MLP stays experimental and no production artifact changes.
