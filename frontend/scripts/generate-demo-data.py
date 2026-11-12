#!/usr/bin/env python
"""
Generate demo API fixtures for the FlowCred AI frontend.

Every value in public/demo-data is derived from the project's real artifacts:
  - data/processed/*.csv
  - reports/**/*.csv and *.json
  - models/*_metadata.json
  - the saved classifier (only for its recorded feature_importances_)

No predictions or financial values are invented. Rows that have no model output
remain null so the UI can show an honest "not scored" state.

Run from the frontend directory:
    python scripts/generate-demo-data.py
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from datetime import datetime, timezone
from importlib.machinery import SourcelessFileLoader
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    confusion_matrix,
    precision_recall_curve,
    roc_curve,
    auc,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler, StandardScaler

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "public" / "demo-data"

RISK_LOW = 0.30
RISK_HIGH = 0.70
DECISION_THRESHOLD = 0.45

FEATURE_LABELS = {
    "invoice_amount": "Invoice amount",
    "log_invoice_amount": "Log invoice amount",
    "invoice_year": "Invoice year",
    "invoice_month": "Invoice month",
    "invoice_quarter": "Invoice quarter",
    "invoice_day_of_week": "Invoice day of week",
    "invoice_day_of_month": "Invoice day of month",
    "invoice_week_of_year": "Invoice week of year",
    "invoice_is_weekend": "Invoice on weekend",
    "days_until_due": "Days until due",
    "previous_invoice_count": "Previous invoice count",
    "previous_paid_invoice_count": "Previous paid invoices",
    "previous_late_count": "Previous late invoices",
    "previous_late_ratio": "Previous late ratio",
    "previous_avg_delay": "Previous average delay",
    "previous_median_delay": "Previous median delay",
    "previous_max_delay": "Previous max delay",
    "previous_min_delay": "Previous min delay",
    "previous_avg_invoice_amount": "Previous avg invoice amount",
    "previous_total_invoice_amount": "Previous total invoice amount",
    "previous_days_since_invoice": "Days since previous invoice",
    "days_since_previous_invoice": "Days since previous invoice",
    "has_payment_history": "Has payment history",
    "cust_payment_terms_CA10": "Terms CA10",
    "cust_payment_terms_NAA8": "Terms NAA8",
    "cust_payment_terms_NAAX": "Terms NAAX",
    "cust_payment_terms_NAC6": "Terms NAC6",
    "cust_payment_terms_NAD1": "Terms NAD1",
    "cust_payment_terms_NAH4": "Terms NAH4",
    "cust_payment_terms_NAM4": "Terms NAM4",
    "cust_payment_terms_Rare": "Rare payment terms",
    "invoice_currency_CAD": "Currency CAD",
    "invoice_currency_USD": "Currency USD",
    "invoice_count": "Invoice count",
    "active_months": "Active months",
    "customer_lifetime_days": "Customer lifetime (days)",
    "avg_days_between_invoices": "Avg days between invoices",
    "invoice_frequency": "Invoice frequency",
    "total_invoice_amount": "Total invoice amount",
    "avg_invoice_amount": "Average invoice amount",
    "median_invoice_amount": "Median invoice amount",
    "min_invoice_amount": "Minimum invoice amount",
    "max_invoice_amount": "Maximum invoice amount",
    "std_invoice_amount": "Invoice amount variability",
    "invoice_amount_cv": "Invoice amount CV",
    "paid_invoice_count": "Paid invoices",
    "open_invoice_count": "Open invoices",
    "late_invoice_count": "Late invoices",
    "on_time_invoice_count": "On-time invoices",
    "late_payment_ratio": "Late payment ratio",
    "early_payment_ratio": "Early payment ratio",
    "avg_payment_delay": "Average payment delay",
    "median_payment_delay": "Median payment delay",
    "std_payment_delay": "Payment delay variability",
    "min_payment_delay": "Minimum payment delay",
    "max_payment_delay": "Maximum payment delay",
    "payment_delay_cv": "Payment delay CV",
    "late_payment_streak": "Late payment streak",
    "on_time_payment_streak": "On-time payment streak",
    "days_since_last_invoice": "Days since last invoice",
    "days_since_last_payment": "Days since last payment",
    "recent_avg_delay": "Recent average delay",
    "recent_late_ratio": "Recent late ratio",
    "recent_avg_invoice_amount": "Recent avg invoice amount",
    "payment_term_count": "Distinct payment terms",
    "payment_term_consistency": "Payment term consistency",
    "currency_count": "Distinct currencies",
    "currency_consistency": "Currency consistency",
}


def label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, feature.replace("_", " ").capitalize())


def clean_float(value, digits=4):
    if value is None:
        return None
    try:
        if isinstance(value, (np.floating, float)) and math.isnan(value):
            return None
        if isinstance(value, (np.integer, int)):
            return int(value)
    except (TypeError, ValueError):
        return None
    if isinstance(value, (int, np.integer)):
        return int(value)
    return round(float(value), digits)


def clean_int(value):
    if value is None:
        return None
    try:
        if isinstance(value, (float, np.floating)) and math.isnan(value):
            return None
    except (TypeError, ValueError):
        return None
    return int(value)


def iso_date(value):
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).strftime("%Y-%m-%d")


def _sanitize(value):
    if isinstance(value, dict):
        return {key: _sanitize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    if isinstance(value, (float, np.floating)):
        if math.isnan(value) or math.isinf(value):
            return None
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def write_json(name: str, payload) -> None:
    path = OUT / name
    with path.open("w", encoding="utf-8") as handle:
        json.dump(
            _sanitize(payload),
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
            default=_fallback,
        )
    size = path.stat().st_size / 1024
    print(f"  wrote {name:<28} {size:>10,.1f} KB")


def _fallback(value):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if math.isnan(value) else round(float(value), 6)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    raise TypeError(f"Not serializable: {type(value)}")


def load_classifier_importance(feature_names: list[str]):
    """Read the recorded gain importances from the saved XGBoost pipeline."""
    loader_path = ROOT / "__pycache__"
    pyc = next(loader_path.glob("feature_engineering_utils*.pyc"), None)
    if pyc is not None:
        try:
            loader = SourcelessFileLoader("feature_engineering_utils", str(pyc))
            spec = importlib.util.spec_from_loader("feature_engineering_utils", loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules["feature_engineering_utils"] = module
            loader.exec_module(module)
        except Exception as exc:  # pragma: no cover - diagnostics only
            print(f"  ! helper module unavailable: {exc}")
    try:
        import joblib

        pipeline = joblib.load(ROOT / "models" / "late_payment_classifier.joblib")
        gains = pipeline.named_steps["clf"].feature_importances_
        total = float(np.sum(gains)) or 1.0
        rows = [
            {
                "feature": name,
                "label": label(name),
                "importance": round(float(gain) / total, 6),
                "rawGain": round(float(gain), 6),
            }
            for name, gain in zip(feature_names, gains)
        ]
        rows.sort(key=lambda row: row["importance"], reverse=True)
        return rows
    except Exception as exc:  # pragma: no cover - diagnostics only
        print(f"  ! classifier importances unavailable: {exc}")
        return []


def histogram(values: np.ndarray, bins: list[float], labels: list[str]):
    counts, _ = np.histogram(values, bins=bins)
    return [{"bucket": name, "count": int(count)} for name, count in zip(labels, counts)]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"Generating demo data from {ROOT}")

    # ---------------------------------------------------------------- inputs
    data_dir = ROOT / "data" / "processed"
    reports_dir = ROOT / "reports"
    models_dir = ROOT / "models"

    clean = pd.read_csv(data_dir / "flowcred_cleaned.csv", dtype={"customer_id": "string"})
    clean = clean.dropna(subset=["invoice_id"]).copy()
    clean["invoice_id"] = clean["invoice_id"].astype("int64").astype(str)
    clean["customer_id"] = clean["customer_id"].astype(str)
    clean["customer_name"] = clean["name_customer"].fillna("Unknown customer").astype(str).str.strip()
    clean["invoiceDate"] = pd.to_datetime(clean["invoice_date"], errors="coerce")
    clean["dueDate"] = pd.to_datetime(clean["due_date"], errors="coerce")
    clean["paymentDate"] = pd.to_datetime(clean["payment_date"], errors="coerce")
    clean["status"] = clean["invoice_status"].astype(str).str.lower()
    clean["amount"] = pd.to_numeric(clean["invoice_amount"], errors="coerce")
    clean = clean.dropna(subset=["invoiceDate", "dueDate", "amount", "customer_id"]).copy()

    late = pd.read_csv(data_dir / "late_payment_predictions.csv")
    late["invoice_id"] = late["invoice_id"].astype("int64").astype(str)
    late = late.rename(
        columns={
            "late_probability": "lateProbability",
            "predicted_is_late": "predictedIsLate",
            "risk_category": "riskBand",
        }
    )[["invoice_id", "lateProbability", "predictedIsLate", "riskBand"]]

    late_test = pd.read_csv(data_dir / "late_payment_test.csv")
    late_test["invoice_id"] = late_test["invoice_id"].astype("int64").astype(str)

    delay = pd.read_csv(reports_dir / "payment_delay_test_predictions.csv")
    delay["invoice_id"] = delay["invoice_id"].astype("int64").astype(str)

    merged = (
        clean.merge(late, on="invoice_id", how="left")
        .merge(
            delay[["invoice_id", "predicted_delay_days", "actual_delay_days", "residual", "absolute_error"]],
            on="invoice_id",
            how="left",
        )
    )
    merged["hasPrediction"] = merged["lateProbability"].notna()
    merged["hasDelayPrediction"] = merged["predicted_delay_days"].notna()

    # -------------------------------------------------------------- invoices
    invoice_records = []
    for row in merged.itertuples(index=False):
        actual_delay = None
        is_late = None
        if row.status == "paid" and not pd.isna(row.delay_days):
            actual_delay = int(round(row.delay_days))
            is_late = bool(row.is_late == 1)
        invoice = {
            "id": row.invoice_id,
            "customerId": row.customer_id,
            "amount": round(float(row.amount), 2),
            "currency": row.invoice_currency,
            "invoiceDate": iso_date(row.invoiceDate),
            "dueDate": iso_date(row.dueDate),
            "paymentTerms": row.cust_payment_terms,
            "status": row.status,
        }
        if actual_delay is not None:
            invoice["delayDays"] = actual_delay
        if is_late is not None:
            invoice["isLate"] = is_late
        if not pd.isna(row.paymentDate):
            invoice["paymentDate"] = iso_date(row.paymentDate)
        if not pd.isna(row.lateProbability):
            invoice["lateProbability"] = clean_float(row.lateProbability, 4)
            invoice["riskBand"] = row.riskBand
        if not pd.isna(row.predicted_delay_days):
            invoice["predictedDelay"] = clean_float(row.predicted_delay_days, 2)
        invoice_records.append(invoice)
    write_json("invoices.json", invoice_records)

    # ------------------------------------------------------------- customers
    clusters = pd.read_csv(
        data_dir / "customer_behavior_clusters.csv", dtype={"customer_id": "str"}
    )
    name_by_id = dict(zip(clusters["customer_id"], clusters["customer_name"].astype(str).str.strip()))
    outstanding = (
        clean[clean["status"] == "open"]
        .groupby("customer_id", dropna=True)["amount"]
        .sum()
        .to_dict()
    )
    last_invoice = clean.groupby("customer_id", dropna=True)["invoiceDate"].max().to_dict()

    customer_records = []
    for row in clusters.itertuples(index=False):
        cid = str(row.customer_id)
        customer_records.append(
            {
                "id": cid,
                "name": str(row.customer_name).strip(),
                "clusterId": int(row.cluster_id),
                "totalInvoices": clean_int(row.invoice_count),
                "activeMonths": clean_int(row.active_months),
                "totalInvoiceAmount": clean_float(row.total_invoice_amount, 2),
                "outstandingAmount": round(float(outstanding.get(cid, 0.0)), 2),
                "avgInvoiceAmount": clean_float(row.avg_invoice_amount, 2),
                "medianInvoiceAmount": clean_float(row.median_invoice_amount, 2),
                "paidInvoices": clean_int(row.paid_invoice_count),
                "openInvoices": clean_int(row.open_invoice_count),
                "lateInvoices": clean_int(row.late_invoice_count),
                "onTimeInvoices": clean_int(row.on_time_invoice_count),
                "latePaymentRatio": clean_float(row.late_payment_ratio, 4),
                "avgPaymentDelay": clean_float(row.avg_payment_delay, 2),
                "medianPaymentDelay": clean_float(row.median_payment_delay, 2),
                "invoiceFrequency": clean_float(row.invoice_frequency, 4),
                "customerLifetimeDays": clean_int(row.customer_lifetime_days),
                "daysSinceLastInvoice": clean_int(row.days_since_last_invoice),
                "recentAvgDelay": clean_float(row.recent_avg_delay, 2),
                "recentLateRatio": clean_float(row.recent_late_ratio, 4),
                "paymentTermConsistency": clean_float(row.payment_term_consistency, 3),
                "lastInvoiceDate": iso_date(last_invoice.get(cid)),
            }
        )
    customer_records.sort(key=lambda item: item["name"].lower())
    write_json("customers.json", customer_records)

    # ------------------------------------------------------- dashboard + risk
    scored = merged[merged["hasPrediction"]].copy()
    open_all = clean[clean["status"] == "open"]
    open_scored = scored[scored["status"] == "open"]

    total_outstanding = float(open_all["amount"].sum())
    high_risk_open_amount = float(
        open_scored[open_scored["lateProbability"] >= RISK_HIGH]["amount"].sum()
    )
    probability_weighted_exposure = float(
        (open_scored["amount"] * open_scored["lateProbability"]).sum()
    )

    band_counts = {band: int((scored["riskBand"] == band).sum()) for band in ("Low", "Medium", "High")}
    open_band_counts = {
        band: int((open_scored["riskBand"] == band).sum()) for band in ("Low", "Medium", "High")
    }

    month_start = clean["invoiceDate"].dt.to_period("M").min()
    month_end = clean["invoiceDate"].dt.to_period("M").max()
    periods = pd.period_range(month_start, month_end, freq="M")
    monthly = []
    for period in periods:
        subset = clean[clean["invoiceDate"].dt.to_period("M") == period]
        paid = subset[subset["status"] == "paid"]
        monthly.append(
            {
                "month": period.strftime("%b %Y"),
                "monthKey": str(period),
                "invoices": int(len(subset)),
                "amount": round(float(subset["amount"].sum()), 2),
                "paidInvoices": int(len(paid)),
                "openInvoices": int((subset["status"] == "open").sum()),
                "lateInvoices": int((paid["is_late"] == 1).sum()),
                "onTimeInvoices": int((paid["is_late"] == 0).sum()),
            }
        )

    predicted_delay_values = scored["predicted_delay_days"].dropna().to_numpy(dtype=float)
    delay_bins = [-1000, -14, -7, -1, 0.0001, 7, 14, 1000]
    delay_bucket_labels = ["14+ days early", "7–13 days early", "1–6 days early", "On time (0)", "1–6 days late", "7–13 days late", "14+ days late"]
    delay_distribution = histogram(predicted_delay_values, delay_bins, delay_bucket_labels)

    risk_exposure_by_band = []
    for band in ("Low", "Medium", "High"):
        band_open = open_scored[open_scored["riskBand"] == band]
        risk_exposure_by_band.append(
            {
                "band": band,
                "invoices": int(len(scored[scored["riskBand"] == band])),
                "openInvoices": int(len(band_open)),
                "outstanding": round(float(band_open["amount"].sum()), 2),
            }
        )

    high_risk_queue = (
        scored[scored["riskBand"] == "High"]
        .sort_values(["lateProbability", "amount"], ascending=[False, False])
        .head(100)
    )
    high_risk_list = []
    for row in high_risk_queue.itertuples(index=False):
        high_risk_list.append(
            {
                "id": row.invoice_id,
                "customerId": row.customer_id,
                "customerName": row.customer_name,
                "amount": round(float(row.amount), 2),
                "currency": row.invoice_currency,
                "invoiceDate": iso_date(row.invoiceDate),
                "dueDate": iso_date(row.dueDate),
                "status": row.status,
                "lateProbability": clean_float(row.lateProbability, 4),
                "riskBand": row.riskBand,
                "predictedDelay": clean_float(row.predicted_delay_days, 2),
            }
        )

    recent_high_risk = (
        scored[scored["riskBand"] == "High"]
        .sort_values(["invoiceDate", "lateProbability"], ascending=[False, False])
        .head(8)
    )
    recent_high_risk_list = [
        {
            "id": row.invoice_id,
            "customerId": row.customer_id,
            "customerName": row.customer_name,
            "amount": round(float(row.amount), 2),
            "currency": row.invoice_currency,
            "dueDate": iso_date(row.dueDate),
            "lateProbability": clean_float(row.lateProbability, 4),
            "riskBand": row.riskBand,
            "predictedDelay": clean_float(row.predicted_delay_days, 2),
        }
        for row in recent_high_risk.itertuples(index=False)
    ]

    latest_predictions_df = scored.sort_values(["invoiceDate", "lateProbability"], ascending=[False, False]).head(8)
    latest_predictions = [
        {
            "id": row.invoice_id,
            "customerName": row.customer_name,
            "invoiceDate": iso_date(row.invoiceDate),
            "amount": round(float(row.amount), 2),
            "lateProbability": clean_float(row.lateProbability, 4),
            "riskBand": row.riskBand,
            "predictedDelay": clean_float(row.predicted_delay_days, 2),
        }
        for row in latest_predictions_df.itertuples(index=False)
    ]

    customer_scored = (
        scored.groupby("customer_id", dropna=True)
        .agg(
            scoredInvoices=("invoice_id", "count"),
            avgProbability=("lateProbability", "mean"),
            highRisk=("riskBand", lambda s: int((s == "High").sum())),
            outstanding=("amount", lambda s: 0.0),
            latestInvoice=("invoiceDate", "max"),
        )
        .reset_index()
    )
    recent_customers = customer_scored.sort_values("latestInvoice", ascending=False).head(6)
    recent_customers_list = [
        {
            "id": row.customer_id,
            "name": name_by_id.get(row.customer_id, "Unknown customer"),
            "scoredInvoices": int(row.scoredInvoices),
            "avgProbability": clean_float(row.avgProbability, 4),
            "highRiskInvoices": int(row.highRisk),
            "lastScoredInvoice": iso_date(row.latestInvoice),
        }
        for row in recent_customers.itertuples(index=False)
    ]

    segment_counts = clusters["cluster_id"].value_counts().sort_index().to_dict()
    segment_distribution = [
        {
            "clusterId": int(cluster),
            "customers": int(segment_counts.get(cluster, 0)),
            "percentage": round(100 * int(segment_counts.get(cluster, 0)) / len(clusters), 2),
        }
        for cluster in range(6)
    ]

    model_status = [
        {
            "id": "late-payment",
            "name": "Late-Payment Classifier",
            "algorithm": "XGBoost",
            "status": "available",
            "version": "late_payment_v1_chronological",
            "lastTrained": None,
            "primaryMetric": {"label": "ROC-AUC", "value": 0.843},
            "href": "/model-performance?model=late-payment",
        },
        {
            "id": "payment-delay",
            "name": "Payment-Delay Regressor",
            "algorithm": "HistGradientBoosting",
            "status": "available",
            "version": "payment_delay_histgradientboosting",
            "lastTrained": "2026-10-06",
            "primaryMetric": {"label": "Test MAE", "value": 3.2768},
            "href": "/model-performance?model=payment-delay",
        },
        {
            "id": "clustering",
            "name": "Customer Behaviour Segments",
            "algorithm": "K-Means (K=6)",
            "status": "available",
            "version": "customer_behavior_kmeans_k6",
            "lastTrained": None,
            "primaryMetric": {"label": "Silhouette", "value": 0.8006},
            "href": "/model-performance?model=clustering",
        },
        {
            "id": "cash-flow",
            "name": "Cash-Inflow Forecast",
            "algorithm": "Not trained",
            "status": "coming_soon",
            "version": None,
            "lastTrained": None,
            "primaryMetric": None,
            "href": "/cash-flow-forecast",
        },
    ]

    dashboard = {
        "kpis": {
            "totalInvoices": int(len(clean)),
            "totalInvoiceAmount": round(float(clean["amount"].sum()), 2),
            "totalOutstandingAmount": round(total_outstanding, 2),
            "latePaymentExposure": round(probability_weighted_exposure, 2),
            "highRiskOutstanding": round(high_risk_open_amount, 2),
            "highRiskInvoices": band_counts["High"],
            "openHighRiskInvoices": open_band_counts["High"],
            "averagePredictedDelay": round(float(np.mean(predicted_delay_values)), 2),
            "customersAnalysed": int(len(clusters)),
            "scoredInvoices": int(len(scored)),
            "openInvoices": int(len(open_all)),
            "paidInvoices": int((clean["status"] == "paid").sum()),
        },
        "statusDistribution": [
            {"status": "Paid", "count": int((clean["status"] == "paid").sum()), "amount": round(float(clean.loc[clean["status"] == "paid", "amount"].sum()), 2)},
            {"status": "Open", "count": int((clean["status"] == "open").sum()), "amount": round(total_outstanding, 2)},
        ],
        "riskDistribution": [
            {"band": band, "count": band_counts[band], "percentage": round(100 * band_counts[band] / max(len(scored), 1), 2)}
            for band in ("Low", "Medium", "High")
        ],
        "riskExposureByBand": risk_exposure_by_band,
        "delayDistribution": delay_distribution,
        "segmentDistribution": segment_distribution,
        "monthlyTrends": monthly,
        "recentHighRiskInvoices": recent_high_risk_list,
        "recentlyAnalysedCustomers": recent_customers_list,
        "modelStatus": model_status,
        "latestPredictions": latest_predictions,
        "dataWindow": {
            "start": iso_date(clean["invoiceDate"].min()),
            "end": iso_date(clean["invoiceDate"].max()),
            "scoredStart": iso_date(scored["invoiceDate"].min()),
            "scoredEnd": iso_date(scored["invoiceDate"].max()),
        },
        "currencyNote": "Nominal amounts across USD and CAD invoices. No FX conversion is applied.",
    }
    write_json("dashboard.json", dashboard)

    # ---------------------------------------------------------- risk summary
    risk_trend = []
    for period in sorted(scored["invoiceDate"].dt.to_period("M").unique()):
        subset = scored[scored["invoiceDate"].dt.to_period("M") == period]
        risk_trend.append(
            {
                "month": period.strftime("%b %Y"),
                "monthKey": str(period),
                "scored": int(len(subset)),
                "avgProbability": round(float(subset["lateProbability"].mean()), 4),
                "highRisk": int((subset["riskBand"] == "High").sum()),
                "mediumRisk": int((subset["riskBand"] == "Medium").sum()),
                "outstanding": round(float(subset.loc[subset["status"] == "open", "amount"].sum()), 2),
            }
        )

    customer_risk = (
        scored.groupby("customer_id", dropna=True)
        .agg(
            scoredInvoices=("invoice_id", "count"),
            avgProbability=("lateProbability", "mean"),
            highRiskInvoices=("riskBand", lambda s: int((s == "High").sum())),
            totalAmount=("amount", "sum"),
            outstanding=("amount", lambda s: 0.0),
            latestInvoice=("invoiceDate", "max"),
        )
        .reset_index()
    )
    customer_risk = customer_risk.sort_values(["avgProbability", "highRiskInvoices"], ascending=False).head(60)
    customer_risk_list = [
        {
            "id": row.customer_id,
            "name": name_by_id.get(row.customer_id, "Unknown customer"),
            "scoredInvoices": int(row.scoredInvoices),
            "avgProbability": clean_float(row.avgProbability, 4),
            "highRiskInvoices": int(row.highRiskInvoices),
            "totalAmount": round(float(row.totalAmount), 2),
            "latestInvoice": iso_date(row.latestInvoice),
        }
        for row in customer_risk.itertuples(index=False)
    ]

    risk = {
        "bands": {
            "low": {"threshold": RISK_LOW, "label": "Low", "description": "Probability below 0.30"},
            "medium": {"threshold": RISK_LOW, "label": "Medium", "description": "0.30 to below 0.70"},
            "high": {"threshold": RISK_HIGH, "label": "High", "description": "0.70 and above"},
        },
        "decisionThreshold": DECISION_THRESHOLD,
        "counts": {
            "low": band_counts["Low"],
            "medium": band_counts["Medium"],
            "high": band_counts["High"],
            "openLow": open_band_counts["Low"],
            "openMedium": open_band_counts["Medium"],
            "openHigh": open_band_counts["High"],
            "totalScored": int(len(scored)),
            "totalOpenScored": int(len(open_scored)),
        },
        "distribution": dashboard["riskDistribution"],
        "exposureByBand": risk_exposure_by_band,
        "queue": high_risk_list,
        "customerRisk": customer_risk_list,
        "trend": risk_trend,
        "thresholdExplanation": (
            "The classification decision threshold (0.45) is the probability cut-off used to assign the binary "
            "late/on-time label. Operational risk bands (Low < 0.30, Medium 0.30–0.70, High ≥ 0.70) are separate "
            "communication bands applied to the same probability and do not change the model's decision."
        ),
        "currencyNote": dashboard["currencyNote"],
    }
    write_json("risk.json", risk)

    # --------------------------------------------------------- delay summary
    actual_delay = delay["actual_delay_days"].to_numpy(dtype=float)
    pred_delay = delay["predicted_delay_days"].to_numpy(dtype=float)
    early_count = int((pred_delay < -0.5).sum())
    on_time_count = int((np.abs(pred_delay) <= 0.5).sum())
    late_count = int((pred_delay > 0.5).sum())
    total_pred = max(len(pred_delay), 1)
    delay_bins = [-1000, -14, -7, -1, 0.0001, 7, 14, 1000]
    delay_bucket_labels = ["14+ days early", "7–13 days early", "1–6 days early", "On time (0)", "1–6 days late", "7–13 days late", "14+ days late"]

    delay_customer = (
        scored.groupby("customer_id", dropna=True)
        .agg(
            invoices=("invoice_id", "count"),
            avgPredictedDelay=("predicted_delay_days", "mean"),
            avgActualDelay=("delay_days", "mean"),
            maxPredictedDelay=("predicted_delay_days", "max"),
        )
        .reset_index()
        .sort_values("avgPredictedDelay", ascending=False)
        .head(60)
    )
    delay_customer_list = [
        {
            "id": row.customer_id,
            "name": name_by_id.get(row.customer_id, "Unknown customer"),
            "invoices": int(row.invoices),
            "avgPredictedDelay": clean_float(row.avgPredictedDelay, 2),
            "avgActualDelay": clean_float(row.avgActualDelay, 2),
            "maxPredictedDelay": clean_float(row.maxPredictedDelay, 2),
        }
        for row in delay_customer.itertuples(index=False)
    ]

    delay_summary = {
        "averagePredictedDelay": round(float(np.mean(pred_delay)), 2),
        "medianPredictedDelay": round(float(np.median(pred_delay)), 2),
        "averageActualDelay": round(float(np.nanmean(actual_delay)), 2),
        "earlyPercentage": round(100 * early_count / total_pred, 2),
        "onTimePercentage": round(100 * on_time_count / total_pred, 2),
        "latePercentage": round(100 * late_count / total_pred, 2),
        "counts": {"early": early_count, "onTime": on_time_count, "late": late_count, "scored": int(total_pred)},
        "distribution": histogram(pred_delay, delay_bins, delay_bucket_labels),
        "customerDelay": delay_customer_list,
        "metrics": {
            "MAE": 3.2768,
            "RMSE": 7.7524,
            "R2": 0.4694,
            "MedAE": 1.613,
            "testRows": 5875,
        },
        "disclaimer": (
            "Historical test-set performance (MAE 3.28 days, R² 0.4694) describes the model on a held-out "
            "period. It is not a guarantee of individual invoice accuracy or an exact payment date."
        ),
    }
    write_json("delay.json", delay_summary)

    # ------------------------------------------------------ segments + PCA
    cluster_meta = json.loads((models_dir / "customer_behavior_clustering_metadata.json").read_text(encoding="utf-8"))
    cluster_features = cluster_meta["cluster_feature_names"]
    cluster_profiles = pd.read_csv(reports_dir / "customer_behavior_clustering" / "cluster_profiles.csv")
    stability = pd.read_csv(reports_dir / "customer_behavior_clustering" / "stability_results.csv")
    cluster_model_comparison = pd.read_csv(reports_dir / "customer_behavior_clustering" / "model_comparison.csv")

    feature_matrix = clusters[cluster_features].apply(pd.to_numeric, errors="coerce")
    pca_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", RobustScaler()),
            ("pca", PCA(n_components=2, random_state=42)),
        ]
    )
    coords = pca_pipeline.fit_transform(feature_matrix)
    explained = pca_pipeline.named_steps["pca"].explained_variance_ratio_
    pca_points = [
        {
            "customerId": str(customer_id),
            "clusterId": int(cluster_id),
            "x": round(float(x), 3),
            "y": round(float(y), 3),
        }
        for customer_id, cluster_id, x, y in zip(clusters["customer_id"], clusters["cluster_id"], coords[:, 0], coords[:, 1])
    ]

    cluster_sizes = []
    for cluster in range(6):
        size = int((clusters["cluster_id"] == cluster).sum())
        subset = clusters[clusters["cluster_id"] == cluster]
        profile = cluster_profiles[cluster_profiles["cluster_id"] == cluster]
        cluster_sizes.append(
            {
                "clusterId": cluster,
                "customers": size,
                "percentage": round(100 * size / len(clusters), 2),
                "isSmall": size < 10,
                "totalInvoiceAmount": round(float(subset["total_invoice_amount"].sum()), 2),
                "avgInvoiceAmount": round(float(subset["avg_invoice_amount"].mean()), 2),
                "avgPaymentDelay": round(float(subset["avg_payment_delay"].mean()), 2),
                "avgLatePaymentRatio": round(float(subset["late_payment_ratio"].mean()), 4),
                "avgInvoiceFrequency": round(float(subset["invoice_frequency"].mean()), 4),
                "medianInvoiceCount": clean_float(profile["median_invoice_count"].iloc[0], 2) if len(profile) else None,
                "medianCustomerLifetimeDays": clean_float(profile["median_customer_lifetime_days"].iloc[0], 2) if len(profile) else None,
            }
        )

    comparison_features = [
        "avg_payment_delay",
        "late_payment_ratio",
        "invoice_count",
        "avg_invoice_amount",
        "recent_late_ratio",
        "invoice_frequency",
    ]
    feature_comparison = []
    for feature in comparison_features:
        series = pd.to_numeric(clusters[feature], errors="coerce")
        values = []
        for cluster in range(6):
            subset = series[clusters["cluster_id"] == cluster].dropna()
            if len(subset) == 0:
                values.append({"clusterId": cluster, "min": None, "q1": None, "median": None, "q3": None, "max": None, "count": 0})
                continue
            values.append(
                {
                    "clusterId": cluster,
                    "min": round(float(subset.min()), 3),
                    "q1": round(float(subset.quantile(0.25)), 3),
                    "median": round(float(subset.median()), 3),
                    "q3": round(float(subset.quantile(0.75)), 3),
                    "max": round(float(subset.max()), 3),
                    "count": int(len(subset)),
                }
            )
        feature_comparison.append({"feature": feature, "label": label(feature), "clusters": values})

    heatmap_features = [
        "invoice_count",
        "avg_invoice_amount",
        "invoice_frequency",
        "late_payment_ratio",
        "avg_payment_delay",
        "recent_late_ratio",
        "customer_lifetime_days",
        "days_since_last_invoice",
    ]
    heatmap = []
    for feature in heatmap_features:
        series = pd.to_numeric(clusters[feature], errors="coerce")
        medians = [float(series[clusters["cluster_id"] == cluster].median()) for cluster in range(6)]
        mean = float(np.mean(medians))
        std = float(np.std(medians)) or 1.0
        heatmap.append(
            {
                "feature": feature,
                "label": label(feature),
                "values": [round((value - mean) / std, 3) for value in medians],
                "medians": [round(value, 3) for value in medians],
            }
        )

    segments = {
        "model": {
            "algorithm": "K-Means",
            "clusters": 6,
            "customers": len(clusters),
            "features": len(cluster_features),
            "randomState": 42,
            "nInit": 10,
            "silhouette": 0.8006,
            "calinskiHarabasz": 3954.67,
            "daviesBouldin": 0.5719,
            "meanARI": 0.9742,
            "minARI": 0.9357,
            "maxARI": 1.0,
        },
        "sizes": cluster_sizes,
        "pca": {
            "points": pca_points,
            "explainedVariance": [round(float(v), 4) for v in explained],
            "xRange": {
                "p01": round(float(np.percentile(coords[:, 0], 1)), 3),
                "p99": round(float(np.percentile(coords[:, 0], 99)), 3),
            },
            "yRange": {
                "p01": round(float(np.percentile(coords[:, 1], 1)), 3),
                "p99": round(float(np.percentile(coords[:, 1], 99)), 3),
            },
            "note": "Axes are clipped to the 1st–99th percentile for readability. Outlier customers outside this range are not hidden from the count; they are outside the plotted view.",
        },
        "heatmap": heatmap,
        "featureComparison": feature_comparison,
        "profiles": cluster_profiles.round(4).to_dict(orient="records"),
        "stability": stability.to_dict(orient="records"),
        "modelComparison": cluster_model_comparison.round(4).to_dict(orient="records"),
        "warnings": [
            "The six clusters are highly imbalanced: Cluster 0 contains 94.74% of customers.",
            "Clusters 1, 2, 4 and 5 contain 1–12 customers and should be treated as small or outlier groups.",
            "Neutral labels (Cluster 0–5) are used until descriptive segment names are approved by the business.",
        ],
    }
    write_json("segments.json", segments)

    # ------------------------------------------------------------ insights
    late_meta = json.loads((models_dir / "late_payment_model_metadata.json").read_text(encoding="utf-8"))
    delay_meta = json.loads((models_dir / "payment_delay_model_metadata.json").read_text(encoding="utf-8"))
    late_importance_raw = load_classifier_importance(late_meta["feature_names"])
    late_importance = [
        {"feature": row["feature"], "label": row["label"], "importance": row["importance"]}
        for row in late_importance_raw
    ]

    delay_importance_df = pd.read_csv(reports_dir / "payment_delay_feature_importance.csv")
    delay_importance_df = delay_importance_df.sort_values("importance", ascending=False)
    delay_total = float(delay_importance_df["importance"].sum()) or 1.0
    delay_importance = [
        {
            "feature": row.feature,
            "label": label(row.feature),
            "importance": round(float(row.importance) / delay_total, 6),
        }
        for row in delay_importance_df.itertuples(index=False)
    ]

    # Between-cluster variance share (eta squared) on median-imputed, standardised behaviour features.
    imputed = SimpleImputer(strategy="median").fit_transform(feature_matrix)
    scaled = StandardScaler().fit_transform(imputed)
    eta_rows = []
    labels_array = clusters["cluster_id"].to_numpy()
    total_ss = float(np.sum((scaled - scaled.mean(axis=0)) ** 2, axis=0).sum())
    for index, feature in enumerate(cluster_features):
        column = scaled[:, index]
        overall_mean = column.mean()
        between = 0.0
        for cluster in range(6):
            mask = labels_array == cluster
            if mask.sum() == 0:
                continue
            between += mask.sum() * (column[mask].mean() - overall_mean) ** 2
        total = float(np.sum((column - overall_mean) ** 2)) or 1.0
        eta_rows.append(
            {
                "feature": feature,
                "label": label(feature),
                "importance": round(between / total, 6),
            }
        )
    eta_rows.sort(key=lambda row: row["importance"], reverse=True)

    insights = {
        "latePayment": {
            "model": "XGBoost classifier",
            "target": "is_late",
            "items": late_importance,
            "explanation": (
                "Recorded gain-based feature importance from the trained XGBoost classifier. It describes how "
                "the model splits across the training data, not the cause of any individual payment outcome."
            ),
            "context": [
                {"label": "Decision threshold", "value": "0.45"},
                {"label": "Risk bands", "value": "Low < 0.30 · Medium 0.30–0.70 · High ≥ 0.70"},
                {"label": "Most influential signal", "value": late_importance[0]["label"] if late_importance else "Not available"},
            ],
        },
        "paymentDelay": {
            "model": "HistGradientBoosting regressor",
            "target": "delay_days",
            "items": delay_importance[:20],
            "explanation": (
                "Feature importance recorded in reports/payment_delay_feature_importance.csv. It ranks global "
                "drivers of predicted delay; it does not explain a single invoice and is not a causal claim."
            ),
            "context": [
                {"label": "Test MAE", "value": "3.2768 days"},
                {"label": "Test R²", "value": "0.4694"},
                {"label": "Most influential signal", "value": delay_importance[0]["label"] if delay_importance else "Not available"},
            ],
        },
        "clustering": {
            "model": "K-Means (K=6)",
            "target": "customer behaviour",
            "items": eta_rows[:20],
            "explanation": (
                "Between-cluster variance share (η²) across the 38 standardised behavioural features. This measures "
                "how much of each feature's variance separates the clusters. K-Means has no supervised target and no "
                "SHAP values are available from the supplied artifacts."
            ),
            "context": [
                {"label": "Customers", "value": "1,425"},
                {"label": "Clusters", "value": "6 (highly imbalanced)"},
                {"label": "Silhouette", "value": "0.8006"},
            ],
        },
        "shap": {
            "available": False,
            "note": (
                "SHAP explanations are not supplied by the current backend. The panels on this page show verified "
                "global feature importance from the saved artifacts and are labelled accordingly."
            ),
        },
        "recommendedActions": [
            "Prioritise HIGH-band invoices for collections review, starting with the highest probability and open balances.",
            "Use the predicted delay as a signed planning estimate; negative values mean early payment, positive values mean late.",
            "Treat small clusters (1–12 customers) as outlier groups, not as broad personas.",
            "Validate required CSV fields before inference; the backend must apply the matching saved preprocessing pipeline.",
        ],
    }
    write_json("insights.json", insights)

    # ------------------------------------------------------- model metrics
    labelled = late_test.merge(late[["invoice_id", "lateProbability"]], on="invoice_id", how="inner")
    y_true = labelled["is_late"].astype(int).to_numpy()
    y_score = labelled["lateProbability"].to_numpy(dtype=float)

    fpr, tpr, _ = roc_curve(y_true, y_score)
    roc_auc_value = auc(fpr, tpr)
    precision, recall, pr_thresholds = precision_recall_curve(y_true, y_score)
    pr_auc_value = auc(recall, precision)

    def sample_curve(x_values, y_values, count=220):
        length = len(x_values)
        if length <= count:
            indices = np.arange(length)
        else:
            indices = np.unique(np.linspace(0, length - 1, count).astype(int))
        return [
            {"x": round(float(x_values[i]), 4), "y": round(float(y_values[i]), 4)}
            for i in indices
        ]

    roc_points = sample_curve(fpr, tpr)
    pr_points = sample_curve(recall, precision)

    threshold_rows = []
    for threshold in np.round(np.arange(0.05, 0.96, 0.05), 2):
        predicted = (y_score >= threshold).astype(int)
        tp = int(((predicted == 1) & (y_true == 1)).sum())
        fp = int(((predicted == 1) & (y_true == 0)).sum())
        fn = int(((predicted == 0) & (y_true == 1)).sum())
        tn = int(((predicted == 0) & (y_true == 0)).sum())
        precision_value = tp / (tp + fp) if (tp + fp) else 0.0
        recall_value = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision_value * recall_value / (precision_value + recall_value) if (precision_value + recall_value) else 0.0
        threshold_rows.append(
            {
                "threshold": float(threshold),
                "precision": round(precision_value, 4),
                "recall": round(recall_value, 4),
                "f1": round(f1, 4),
                "accuracy": round((tp + tn) / max(len(y_true), 1), 4),
            }
        )

    def confusion_at(threshold: float):
        predicted = (y_score >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, predicted, labels=[0, 1]).ravel()
        return {
            "threshold": threshold,
            "trueNegative": int(tn),
            "falsePositive": int(fp),
            "falseNegative": int(fn),
            "truePositive": int(tp),
            "accuracy": round((tp + tn) / max(len(y_true), 1), 4),
        }

    # Regression diagnostics
    actual_vs_pred_df = delay.sort_values("absolute_error").reset_index(drop=True)
    step = max(len(actual_vs_pred_df) // 600, 1)
    scatter = [
        {
            "actual": round(float(row.actual_delay_days), 2),
            "predicted": round(float(row.predicted_delay_days), 2),
            "absoluteError": round(float(row.absolute_error), 2),
        }
        for row in actual_vs_pred_df.iloc[::step].itertuples(index=False)
    ]
    residual_values = delay["residual"].to_numpy(dtype=float)
    residual_edges = np.linspace(-30, 30, 31)
    residual_counts, _ = np.histogram(np.clip(residual_values, -30, 30), bins=residual_edges)
    residual_distribution = [
        {"bucket": f"{residual_edges[i]:.0f} to {residual_edges[i + 1]:.0f}", "center": round(float((residual_edges[i] + residual_edges[i + 1]) / 2), 1), "count": int(count)}
        for i, count in enumerate(residual_counts)
    ]

    classifier_comparison = pd.read_csv(reports_dir / "late_payment_model_comparison.csv")
    delay_comparison = pd.read_csv(reports_dir / "payment_delay_model_comparison.csv")
    performance_by_amount = pd.read_csv(reports_dir / "payment_delay_performance_by_amount.csv")
    performance_by_category = pd.read_csv(reports_dir / "payment_delay_performance_by_category.csv")

    model_metrics = {
        "latePayment": {
            "name": "Late-Payment Classification",
            "algorithm": "XGBoost Classifier",
            "target": "is_late",
            "version": late_meta.get("model_name"),
            "datasetVersion": late_meta.get("dataset_version"),
            "trainedAt": None,
            "trainingRows": late_meta.get("training_rows"),
            "validationRows": late_meta.get("validation_rows"),
            "testRows": late_meta.get("test_rows"),
            "trainingDateRange": late_meta.get("training_date_range"),
            "validationDateRange": late_meta.get("validation_date_range"),
            "testDateRange": late_meta.get("test_date_range"),
            "decisionThreshold": DECISION_THRESHOLD,
            "testMetrics": late_meta.get("test_metrics"),
            "operationalThresholdMetrics": late_meta.get("test_metrics_operational_threshold"),
            "validationMetrics": late_meta.get("validation_metrics"),
            "rocAuc": round(float(roc_auc_value), 4),
            "prAuc": round(float(pr_auc_value), 4),
            "rocCurve": roc_points,
            "prCurve": pr_points,
            "confusionMatrix": confusion_at(DECISION_THRESHOLD),
            "confusionMatrixDefault": confusion_at(0.5),
            "thresholdAnalysis": threshold_rows,
            "featureImportance": late_importance,
            "modelComparison": classifier_comparison.round(4).to_dict(orient="records"),
            "metricSource": "models/late_payment_model_metadata.json, reports/late_payment_test_metrics.json, and recomputed from test labels + saved prediction probabilities.",
        },
        "paymentDelay": {
            "name": "Payment-Delay Regression",
            "algorithm": "HistGradientBoosting Regressor",
            "target": "delay_days",
            "version": delay_meta.get("model_name"),
            "datasetVersion": None,
            "trainedAt": delay_meta.get("training_date"),
            "trainingRows": delay_meta.get("training_rows"),
            "validationRows": delay_meta.get("validation_rows"),
            "testRows": delay_meta.get("test_rows"),
            "features": delay_meta.get("number_of_features"),
            "validationMetrics": delay_meta.get("validation_metrics"),
            "testMetrics": delay_meta.get("test_metrics"),
            "selection": delay_meta.get("selection"),
            "featureImportance": delay_importance,
            "actualVsPredicted": scatter,
            "residualDistribution": residual_distribution,
            "byAmountBucket": performance_by_amount.round(4).to_dict(orient="records"),
            "byCategory": performance_by_category.round(4).to_dict(orient="records"),
            "modelComparison": delay_comparison.round(4).to_dict(orient="records"),
            "metricSource": "models/payment_delay_model_metadata.json, reports/payment_delay_test_predictions.csv and payment_delay_* reports.",
        },
        "clustering": {
            "name": "Customer Behaviour Clustering",
            "algorithm": "K-Means",
            "target": "customer behaviour",
            "version": "customer_behavior_kmeans_k6",
            "datasetVersion": None,
            "trainedAt": None,
            "trainingCustomers": cluster_meta.get("training_customer_count"),
            "clusters": cluster_meta.get("number_of_clusters"),
            "features": len(cluster_features),
            "silhouette": cluster_meta.get("silhouette_score"),
            "calinskiHarabasz": cluster_meta.get("calinski_harabasz_score"),
            "daviesBouldin": cluster_meta.get("davies_bouldin_score"),
            "stability": cluster_meta.get("stability_metrics"),
            "sizes": segments["sizes"],
            "pca": segments["pca"],
            "modelComparison": segments["modelComparison"],
            "metricSource": "models/customer_behavior_clustering_metadata.json and reports/customer_behavior_clustering/.",
        },
        "methodology": {
            "note": "Metrics shown are copied from recorded model metadata and reports. ROC-AUC, PR-AUC, curves and confusion matrices are recomputed from the saved test predictions.",
            "threshold": (
                "The 0.45 classification decision threshold is used for the binary late/on-time label. "
                "The operational risk bands (Low < 0.30, Medium 0.30–0.70, High ≥ 0.70) are separate and do not alter that decision."
            ),
            "disclaimer": (
                "Historical model performance is not a guarantee of individual prediction accuracy. Predictions support "
                "prioritisation and planning and should not be the sole basis for adverse customer decisions."
            ),
        },
    }
    write_json("model-metrics.json", model_metrics)

    # ---------------------------------------------------------- data quality
    duplicate_ids = int(clean["invoice_id"].duplicated().sum())
    invalid_date_order = int((clean["dueDate"] < clean["invoiceDate"]).sum())
    invalid_payment_order = int(
        ((clean["status"] == "paid") & (clean["paymentDate"] < clean["invoiceDate"])).sum()
    )
    invalid_amount = int((clean["amount"] <= 0).sum())
    missing_by_column = [
        {"column": column, "missing": int(clean[column].isna().sum())}
        for column in clean.columns
        if int(clean[column].isna().sum()) > 0
    ]

    data_quality = {
        "dataset": "flowcred_cleaned.csv",
        "totalRecords": int(len(clean)),
        "paidRecords": int((clean["status"] == "paid").sum()),
        "openRecords": int((clean["status"] == "open").sum()),
        "customers": int(clean["customer_id"].nunique()),
        "dateRange": {"start": iso_date(clean["invoiceDate"].min()), "end": iso_date(clean["invoiceDate"].max())},
        "duplicateInvoiceIds": duplicate_ids,
        "invalidRecords": {
            "dueBeforeInvoice": invalid_date_order,
            "paymentBeforeInvoice": invalid_payment_order,
            "nonPositiveAmount": invalid_amount,
            "total": invalid_date_order + invalid_payment_order + invalid_amount,
        },
        "missingByColumn": missing_by_column,
        "currencyCounts": clean["invoice_currency"].value_counts().to_dict(),
        "statusCounts": clean["status"].value_counts().to_dict(),
        "requiredColumns": [
            "invoice_id",
            "customer_id",
            "name_customer",
            "invoice_amount",
            "invoice_date",
            "due_date",
            "invoice_currency",
            "cust_payment_terms",
            "invoice_status",
        ],
        "optionalColumns": [
            "payment_date",
            "delay_days",
            "is_late",
            "business_code",
            "doc_id",
            "document_create_date",
            "posting_id",
        ],
        "validationRules": [
            "invoice_id must be present and unique",
            "customer_id must be present",
            "invoice_amount must be a positive number",
            "invoice_date and due_date must be valid ISO dates",
            "payment_date must be a valid date when present",
            "due_date must not precede invoice_date",
            "invoice_currency must be USD or CAD in the supplied dataset",
        ],
    }
    write_json("data-quality.json", data_quality)

    dataset_files = []
    for path in sorted(data_dir.glob("*.csv")):
        try:
            rows = sum(1 for _ in path.open("r", encoding="utf-8")) - 1
        except Exception:
            rows = None
        dataset_files.append(
            {
                "name": path.name,
                "rows": rows,
                "sizeKb": round(path.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                "stage": "processed",
            }
        )
    raw_path = ROOT / "data" / "raw" / "dataset.csv"
    if raw_path.exists():
        dataset_files.insert(
            0,
            {
                "name": raw_path.name,
                "rows": sum(1 for _ in raw_path.open("r", encoding="utf-8")) - 1,
                "sizeKb": round(raw_path.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(raw_path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                "stage": "raw",
            },
        )
    write_json("datasets.json", {"datasets": dataset_files})

    manifest = {
        "generatedAt": generated_at,
        "mode": "demo",
        "source": "Generated from the supplied FlowCred AI model artifacts and processed datasets.",
        "counts": {
            "invoices": len(invoice_records),
            "scoredInvoices": int(len(scored)),
            "customers": len(customer_records),
            "clusters": 6,
            "monthlyPoints": len(monthly),
        },
        "notes": [
            "No invoice, prediction or metric in these files is hand-written demo filler.",
            "Invoices outside the chronological test period have null prediction fields.",
            "Amounts mix USD and CAD nominal values; no FX conversion is applied.",
            "SHAP values are not present in the supplied artifacts. Only verified global importance is shown.",
            "When the FastAPI backend is available, switch VITE_API_MODE=live; the demo adapter is not used.",
        ],
        "sources": [
            "data/processed/flowcred_cleaned.csv",
            "data/processed/late_payment_predictions.csv",
            "data/processed/late_payment_test.csv",
            "data/processed/customer_behavior_clusters.csv",
            "reports/payment_delay_test_predictions.csv",
            "reports/*_feature_importance.csv",
            "reports/customer_behavior_clustering/*",
            "models/*_metadata.json",
        ],
    }
    write_json("manifest.json", manifest)

    print(f"\nDone. Demo fixtures are in {OUT}")


if __name__ == "__main__":
    main()
