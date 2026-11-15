from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException


LATE_FEATURES = [
    "invoice_amount", "log_invoice_amount", "invoice_year", "invoice_month", "invoice_quarter",
    "invoice_day_of_week", "invoice_day_of_month", "invoice_week_of_year", "invoice_is_weekend",
    "days_until_due", "previous_invoice_count", "previous_late_count", "previous_late_ratio",
    "previous_avg_delay", "previous_median_delay", "previous_avg_invoice_amount",
    "previous_total_invoice_amount", "days_since_previous_invoice", "has_payment_history",
]


def _number(obj: dict[str, Any], *names: str, default: float = 0.0) -> float:
    for name in names:
        if obj.get(name) is not None:
            try:
                value = float(obj[name])
                if math.isfinite(value): return value
            except (TypeError, ValueError):
                pass
    return default


def make_features(invoice: dict[str, Any], history: dict[str, Any]) -> tuple[pd.DataFrame, pd.DataFrame]:
    amount = _number(invoice, "amount", "invoice_amount", default=float("nan"))
    if not math.isfinite(amount) or amount <= 0:
        raise HTTPException(422, "invoice.amount must be a positive finite number")
    invoice_date = invoice.get("invoiceDate", invoice.get("invoice_date"))
    due_date = invoice.get("dueDate", invoice.get("due_date"))
    try:
        inv_dt = pd.Timestamp(invoice_date)
        due_dt = pd.Timestamp(due_date)
        if pd.isna(inv_dt) or pd.isna(due_dt): raise ValueError
    except Exception as exc:
        raise HTTPException(422, "invoice.invoiceDate and invoice.dueDate must be valid dates") from exc
    if due_dt < inv_dt: raise HTTPException(422, "invoice.dueDate cannot precede invoice.invoiceDate")
    h = history or {}
    count = _number(h, "previous_invoice_count", "previousInvoiceCount", "totalInvoices")
    late_count = _number(h, "previous_late_count", "previousLateCount", "lateInvoices")
    has_history = 1 if count > 0 or h.get("has_payment_history") or h.get("hasPaymentHistory") else 0
    # Defaults mirror the fitted history transformer: zero counts/ratio/totals,
    # undefined means/medians/recency left NaN for the saved imputer.
    features = {
        "invoice_amount": amount,
        "log_invoice_amount": math.log(amount),
        "invoice_year": inv_dt.year,
        "invoice_month": inv_dt.month,
        "invoice_quarter": inv_dt.quarter,
        "invoice_day_of_week": inv_dt.dayofweek,
        "invoice_day_of_month": inv_dt.day,
        "invoice_week_of_year": int(inv_dt.isocalendar().week),
        "invoice_is_weekend": int(inv_dt.dayofweek >= 5),
        "days_until_due": (due_dt.date() - inv_dt.date()).days,
        "previous_invoice_count": count,
        "previous_paid_invoice_count": _number(h, "previous_paid_invoice_count", "previousPaidInvoiceCount", default=count),
        "previous_late_count": late_count,
        "previous_late_ratio": _number(h, "previous_late_ratio", "previousLateRatio", "latePaymentRatio", default=(late_count/count if count else 0.0)),
        "previous_avg_delay": _number(h, "previous_avg_delay", "previousAvgDelay", "avgPaymentDelay", default=float("nan")),
        "previous_median_delay": _number(h, "previous_median_delay", "previousMedianDelay", "medianPaymentDelay", default=float("nan")),
        "previous_max_delay": _number(h, "previous_max_delay", "previousMaxDelay", default=float("nan")),
        "previous_min_delay": _number(h, "previous_min_delay", "previousMinDelay", default=float("nan")),
        "previous_avg_invoice_amount": _number(h, "previous_avg_invoice_amount", "previousAvgInvoiceAmount", "avgInvoiceAmount", default=float("nan")),
        "previous_total_invoice_amount": _number(h, "previous_total_invoice_amount", "previousTotalInvoiceAmount", default=0.0),
        "previous_days_since_invoice": _number(h, "previous_days_since_invoice", "previousDaysSinceInvoice", "daysSinceLastInvoice", default=float("nan")),
        "days_since_previous_invoice": _number(h, "days_since_previous_invoice", "previous_days_since_invoice", "previousDaysSinceInvoice", default=float("nan")),
        "has_payment_history": has_history,
    }
    currency = str(invoice.get("currency", invoice.get("invoice_currency", ""))).upper()
    terms = str(invoice.get("paymentTerms", invoice.get("cust_payment_terms", ""))).upper()
    if currency not in {"USD", "CAD"}: raise HTTPException(422, "invoice.currency must be USD or CAD")
    if not terms: raise HTTPException(422, "invoice.paymentTerms is required")
    late = pd.DataFrame([{k: features[k] for k in LATE_FEATURES}], columns=LATE_FEATURES)
    delay = pd.DataFrame([{**features, "cust_payment_terms": terms, "invoice_currency": currency}])
    return late, delay


def late_inference(artifacts: dict[str, Any], invoice: dict[str, Any], history: dict[str, Any]) -> dict[str, Any]:
    late, _ = make_features(invoice, history)
    # XGBoost was trained on the raw engineered 19-column frame. The saved
    # classifier is itself a Pipeline with the fitted median imputer. The
    # separate feature_pipeline artifact (standard scaling) was not applied in
    # the training notebook and degrades held-out metrics when applied here.
    probability = float(artifacts["model"].predict_proba(late)[0, 1])
    threshold = float(artifacts["metadata"].get("classification_threshold", .45))
    band = "Low" if probability < .3 else "Medium" if probability < .7 else "High"
    return {
        "probability": probability,
        "predictedLate": probability >= threshold,
        "riskBand": band,
        "threshold": threshold,
        "modelVersion": artifacts["version"],
        "predictedAt": datetime.now(timezone.utc).isoformat(),
    }


def delay_inference(artifacts: dict[str, Any], invoice: dict[str, Any], history: dict[str, Any]) -> dict[str, Any]:
    _, raw = make_features(invoice, history)
    prep = artifacts["pipeline"]["preprocess"]
    # ColumnTransformer receives raw categories; model_features records the
    # post-encoding feature names expected by the fitted estimator.
    model_features = artifacts["pipeline"]["numeric_features"] + artifacts["pipeline"]["categorical_features"]
    absent = [x for x in model_features if x not in raw.columns]
    if absent: raise HTTPException(500, f"Saved delay preprocessing feature contract could not be satisfied: {absent}")
    transformed = prep.transform(raw[model_features])
    prediction = float(artifacts["model"].predict(transformed)[0])
    interpretation = "early" if prediction < 0 else "late" if prediction > 0 else "on_time"
    return {"predictedDelayDays": prediction, "interpretation": interpretation, "modelVersion": artifacts["version"], "predictedAt": datetime.now(timezone.utc).isoformat()}


def cluster_inference(artifacts: dict[str, Any], features: dict[str, Any]) -> dict[str, Any]:
    names = artifacts["pipeline"]["features"]
    missing = [n for n in names if n not in features]
    if missing: raise HTTPException(422, {"message": "Missing customer behavioural features", "missing": missing})
    frame = pd.DataFrame([{n: features[n] for n in names}], columns=names)
    transformed = artifacts["pipeline"]["pipeline"].transform(frame)
    cluster = int(artifacts["model"].predict(transformed)[0])
    return {"clusterId": cluster, "features": frame.iloc[0].to_dict(), "modelVersion": artifacts["version"], "predictedAt": datetime.now(timezone.utc).isoformat()}
