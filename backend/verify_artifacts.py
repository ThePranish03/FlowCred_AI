"""Run actual saved-pipeline inference against held-out historical records."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import feature_engineering_utils  # noqa: E402,F401

sys.modules["__main__"].LeakageSafeCustomerHistoryTransformer = feature_engineering_utils.LeakageSafeCustomerHistoryTransformer

def main() -> None:
    models = ROOT / "models"
    data = ROOT / "data" / "processed"

    classifier = joblib.load(models / "late_payment_classifier.joblib")
    late_pipe = joblib.load(models / "late_payment_feature_pipeline.joblib")
    late_meta = json.loads((models / "late_payment_model_metadata.json").read_text(encoding="utf-8"))
    late_rows = pd.read_csv(data / "late_payment_test.csv")
    late_features = late_meta["feature_names"]
    # The training notebook evaluates the saved classifier directly on raw
    # engineered features; its embedded SimpleImputer is the fitted preprocessor.
    # The separate feature_pipeline (imputer + scaler) was not used to fit XGBoost.
    late_prob = classifier.predict_proba(late_rows[late_features])[:, 1]
    late_y = late_rows["is_late"].astype(int).to_numpy()
    late_auc = roc_auc_score(late_y, late_prob)
    late_acc = accuracy_score(late_y, late_prob >= float(late_meta["classification_threshold"]))
    recorded_late = pd.read_csv(data / "late_payment_predictions.csv")
    left = late_rows[["invoice_id"]].copy(); left["p"] = late_prob
    recorded_late["_id"] = pd.to_numeric(recorded_late["invoice_id"], errors="coerce")
    left["_id"] = pd.to_numeric(left["invoice_id"], errors="coerce")
    comparison = left.dropna(subset=["_id"]).merge(recorded_late[["_id", "late_probability"]].dropna(subset=["_id"]), on="_id", how="inner")
    max_delta = float((comparison["p"] - comparison["late_probability"]).abs().max()) if len(comparison) else float("nan")
    print(f"late-payment: {len(late_prob)} held-out predictions; ROC-AUC={late_auc:.6f}; accuracy@0.45={late_acc:.6f}; matched_saved_scores={len(comparison)}; max_score_delta={max_delta:.6f}")
    assert len(comparison) == len(late_rows) and max_delta <= 0.0001
    assert abs(late_auc - late_meta["test_metrics"]["roc_auc"]) < 0.002
    assert abs(late_acc - late_meta["test_metrics_operational_threshold"]["accuracy"]) < 0.002

    delay_artifact = joblib.load(models / "payment_delay_regressor.joblib")
    delay_pipe = joblib.load(models / "payment_delay_feature_pipeline.joblib")
    delay_split = pd.read_csv(data / "payment_delay_test.csv")
    delay_source = pd.read_csv(data / "flowcred_cleaned.csv", usecols=["invoice_id", "cust_payment_terms", "invoice_currency"])
    delay_split["_id"] = pd.to_numeric(delay_split["invoice_id"], errors="coerce")
    delay_source["_id"] = pd.to_numeric(delay_source["invoice_id"], errors="coerce")
    delay_rows = delay_split.merge(delay_source[["_id", "cust_payment_terms", "invoice_currency"]].dropna(subset=["_id"]).drop_duplicates("_id"), on="_id", how="left", validate="one_to_one")
    input_columns = delay_pipe["numeric_features"] + delay_pipe["categorical_features"]
    delay_x = delay_pipe["preprocess"].transform(delay_rows[input_columns])
    delay_pred = delay_artifact["model"].predict(delay_x)
    truth = delay_rows["delay_days"].to_numpy(dtype=float)
    mae = float(np.mean(np.abs(truth - delay_pred)))
    rmse = float(np.sqrt(np.mean(np.square(truth - delay_pred))))
    recorded_delay = pd.read_csv(ROOT / "reports" / "payment_delay_test_predictions.csv")
    delay_rows["_id"] = pd.to_numeric(delay_rows["invoice_id"], errors="coerce")
    recorded_delay["_id"] = pd.to_numeric(recorded_delay["invoice_id"], errors="coerce")
    delay_rows["predicted"] = delay_pred
    delay_cmp = delay_rows.merge(recorded_delay[["_id", "predicted_delay_days"]], on="_id", how="inner")
    delay_delta = float((delay_cmp["predicted"] - delay_cmp["predicted_delay_days"]).abs().max()) if len(delay_cmp) else float("nan")
    print(f"payment-delay: {len(delay_pred)} held-out predictions; MAE={mae:.6f}; RMSE={rmse:.6f}; matched_saved_predictions={len(delay_cmp)}; max_prediction_delta={delay_delta:.6f}")
    delay_meta = json.loads((models / "payment_delay_model_metadata.json").read_text(encoding="utf-8"))
    assert len(delay_cmp) == len(delay_rows) and delay_delta < 1e-8
    assert abs(mae - delay_meta["test_metrics"]["MAE"]) < 0.001
    assert abs(rmse - delay_meta["test_metrics"]["RMSE"]) < 0.001

    cluster_artifact = joblib.load(models / "customer_behavior_clusterer.joblib")
    cluster_pipe = joblib.load(models / "customer_behavior_feature_pipeline.joblib")
    cluster_rows = pd.read_csv(data / "customer_behavior_features.csv")
    cluster_x = cluster_pipe["pipeline"].transform(cluster_rows[cluster_pipe["features"]])
    cluster_pred = cluster_artifact["model"].predict(cluster_x)
    actual_cluster = pd.read_csv(data / "customer_behavior_clusters.csv")
    cluster_rows["_id"] = cluster_rows["customer_id"].astype(str)
    actual_cluster["_id"] = actual_cluster["customer_id"].astype(str)
    cluster_rows["predicted_cluster"] = cluster_pred
    cluster_cmp = cluster_rows.merge(actual_cluster[["_id", "cluster_id"]], on="_id", how="inner")
    agree = float((cluster_cmp["predicted_cluster"] == cluster_cmp["cluster_id"]).mean()) if len(cluster_cmp) else float("nan")
    print(f"customer-clustering: {len(cluster_pred)} customers; matched_saved_assignments={len(cluster_cmp)}; exact_agreement={agree:.6f}; clusters={sorted(set(cluster_pred.tolist()))}")
    assert len(cluster_cmp) == len(cluster_rows) and agree == 1.0

if __name__ == "__main__": main()
