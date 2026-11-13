import json
import sys
from pathlib import Path

import joblib
import pandas as pd
import pytest
from fastapi import HTTPException

from app.ml import cluster_inference, delay_inference, late_inference

ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture(scope="module")
def artifacts():
    import feature_engineering_utils
    sys.modules["__main__"].LeakageSafeCustomerHistoryTransformer = feature_engineering_utils.LeakageSafeCustomerHistoryTransformer
    model_dir = ROOT / "models"
    def load(key, model_name, pipeline_name, metadata_name, model_key=None):
        artifact = joblib.load(model_dir / model_name)
        pipeline = joblib.load(model_dir / pipeline_name)
        metadata = json.loads((model_dir / metadata_name).read_text(encoding="utf-8"))
        return {"model": artifact[model_key] if model_key else artifact, "pipeline": pipeline, "metadata": metadata, "version": metadata.get("dataset_version") or metadata.get("training_date") or "KMeans-K6"}
    return {
        "late-payment": load("late", "late_payment_classifier.joblib", "late_payment_feature_pipeline.joblib", "late_payment_model_metadata.json"),
        "payment-delay": load("delay", "payment_delay_regressor.joblib", "payment_delay_feature_pipeline.joblib", "payment_delay_model_metadata.json", "model"),
        "clustering": load("cluster", "customer_behavior_clusterer.joblib", "customer_behavior_feature_pipeline.joblib", "customer_behavior_clustering_metadata.json", "model"),
    }

def test_late_payment_and_delay_are_actual_predictions(artifacts):
    invoice = {"amount": 1200.5, "currency": "USD", "invoiceDate": "2020-01-10", "dueDate": "2020-02-09", "paymentTerms": "NAA8"}
    history = {"previousInvoiceCount": 8, "previousLateCount": 3, "previousLateRatio": .375, "previousAvgDelay": 4.5, "previousMedianDelay": 2, "previousAvgInvoiceAmount": 900, "previousTotalInvoiceAmount": 7200, "daysSinceLastInvoice": 18}
    late = late_inference(artifacts["late-payment"], invoice, history)
    delay = delay_inference(artifacts["payment-delay"], invoice, history)
    assert 0 <= late["probability"] <= 1 and late["modelVersion"]
    assert isinstance(delay["predictedDelayDays"], float) and delay["interpretation"] in {"early", "on_time", "late"}

def test_customer_cluster_uses_saved_pipeline(artifacts):
    rows = pd.read_csv(ROOT / "data" / "processed" / "customer_behavior_features.csv", nrows=1)
    features = rows.iloc[0].to_dict()
    features.pop("customer_id", None); features.pop("customer_name", None)
    result = cluster_inference(artifacts["clustering"], features)
    assert result["clusterId"] in range(6)

def test_prediction_input_rejects_invalid_financial_or_date_values(artifacts):
    with pytest.raises(HTTPException) as exc:
        late_inference(artifacts["late-payment"], {"amount":0,"currency":"USD","invoiceDate":"bad","dueDate":"2020-01-02","paymentTerms":"NAA8"}, {})
    assert exc.value.status_code == 422
