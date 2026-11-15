from __future__ import annotations

import json
import hashlib
import logging
import math
import os
import shutil
import sys
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from sqlalchemy import select, func, text, or_
from sqlalchemy.orm import Session

from .auth import audit, hash_password, issue_pair, verify_password, current_user, allow_roles, ROLES
from .database import Base, engine, get_db, SessionLocal
from .db_models import User, RefreshToken, Prediction, Customer, Invoice, CustomerSegment, DatasetUpload, ModelRegistry, InvoiceScoringState, ScoringJob, CashFlowForecastRun, CashFlowForecastPoint
from . import forecasting

_main_path = Path(__file__).resolve()
ROOT = next((candidate for candidate in (_main_path.parents[2], _main_path.parents[1]) if (candidate / "frontend" / "public" / "demo-data").is_dir()), _main_path.parents[2])
FRONTEND_DATA = ROOT / "frontend" / "public" / "demo-data"
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(ROOT / "models"))).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT / "data"))).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
LOGGER = logging.getLogger("flowcred")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
FIXTURES: dict[str, Any] = {}
MODEL_STATUS: dict[str, dict[str, Any]] = {}
MODEL_IDS = ("late-payment", "payment-delay", "clustering")
ANALYTICS_ROLES = ("business_owner", "accountant")
INVOICES: list[dict[str, Any]] = []
CUSTOMERS: list[dict[str, Any]] = []


def business_today() -> date:
    """Current business date in BUSINESS_TIMEZONE (UTC unless configured)."""
    return datetime.now(ZoneInfo(os.getenv("BUSINESS_TIMEZONE", "UTC"))).date()


def load_json(name: str) -> Any:
    if name not in FIXTURES:
        try:
            FIXTURES[name] = json.loads((FRONTEND_DATA / f"{name}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(503, f"Required source snapshot {name}.json is unavailable") from exc
    return FIXTURES[name]


def load_models() -> None:
    """Load exact saved estimators and preprocessing objects once at startup."""
    import joblib
    MODEL_STATUS.clear()
    LOGGER.info("Loading feature engineering helper...")
    backend_dir = str(Path(__file__).resolve().parents[1])
    if backend_dir not in sys.path: sys.path.insert(0, backend_dir)
    try:
        import feature_engineering_utils
        sys.modules["__main__"].LeakageSafeCustomerHistoryTransformer = feature_engineering_utils.LeakageSafeCustomerHistoryTransformer
        from .ml import cluster_inference, delay_inference, late_inference
    except Exception as exc:
        LOGGER.exception("Original feature engineering helper could not be imported")
        for key in MODEL_IDS:
            MODEL_STATUS[key] = {"status": "unavailable", "version": None, "error": f"Feature helper unavailable ({type(exc).__name__})"}
        return
    LOGGER.info("Feature engineering helper loaded successfully.")
    specs = {
        "late-payment": {"label": "Late-payment classifier", "model": "late_payment_classifier.joblib", "pipeline": "late_payment_feature_pipeline.joblib", "metadata": "late_payment_model_metadata.json", "model_key": None},
        "payment-delay": {"label": "Payment-delay regressor", "model": "payment_delay_regressor.joblib", "pipeline": "payment_delay_feature_pipeline.joblib", "metadata": "payment_delay_model_metadata.json", "model_key": "model"},
        "clustering": {"label": "Customer behaviour clusterer", "model": "customer_behavior_clusterer.joblib", "pipeline": "customer_behavior_feature_pipeline.joblib", "metadata": "customer_behavior_clustering_metadata.json", "model_key": "model"},
    }
    for key, spec in specs.items():
        LOGGER.info("Loading %s...", spec["label"].lower())
        try:
            meta = json.loads((MODEL_DIR / spec["metadata"]).read_text(encoding="utf-8"))
            if not isinstance(meta, dict):
                raise ValueError(f"{spec['metadata']} must contain a JSON object")
            model_artifact = joblib.load(MODEL_DIR / spec["model"])
            pipeline_artifact = joblib.load(MODEL_DIR / spec["pipeline"])
            estimator = model_artifact[spec["model_key"]] if spec["model_key"] else model_artifact
            version = meta.get("dataset_version") or meta.get("training_date")
            if not isinstance(pipeline_artifact, dict):
                raise ValueError(f"{spec['pipeline']} must contain a preprocessing dictionary")

            if key == "late-payment":
                if not {"history_transformer", "feature_pipeline"}.issubset(pipeline_artifact):
                    raise ValueError("Late-payment preprocessing artifact is missing required fitted components")
                if not callable(getattr(pipeline_artifact["feature_pipeline"], "transform", None)):
                    raise ValueError("Late-payment fitted feature pipeline does not provide transform()")
                state = {"model": estimator, "pipeline": pipeline_artifact, "metadata": meta, "version": str(version)}
                result = late_inference(
                    state,
                    {"amount": 1200.5, "currency": "USD", "invoiceDate": "2020-01-10", "dueDate": "2020-02-09", "paymentTerms": "NAA8"},
                    {"previousInvoiceCount": 8, "previousLateCount": 3, "previousLateRatio": 0.375},
                )
                if not math.isfinite(result["probability"]) or not 0 <= result["probability"] <= 1:
                    raise ValueError("Late-payment classifier returned an invalid probability")
            elif key == "payment-delay":
                if not {"preprocess", "numeric_features", "categorical_features"}.issubset(pipeline_artifact):
                    raise ValueError("Payment-delay preprocessing artifact is missing required fitted components")
                state = {"model": estimator, "pipeline": pipeline_artifact, "metadata": meta, "version": str(version)}
                result = delay_inference(
                    state,
                    {"amount": 1200.5, "currency": "USD", "invoiceDate": "2020-01-10", "dueDate": "2020-02-09", "paymentTerms": "NAA8"},
                    {"previousInvoiceCount": 8, "previousLateCount": 3, "previousLateRatio": 0.375},
                )
                if not math.isfinite(result["predictedDelayDays"]):
                    raise ValueError("Payment-delay regressor returned a non-finite delay")
            else:
                if not {"pipeline", "features"}.issubset(pipeline_artifact):
                    raise ValueError("Customer-clustering preprocessing artifact is missing required fitted components")
                cluster_input_path = DATA_DIR / "processed" / "customer_behavior_features.csv"
                cluster_rows = pd.read_csv(cluster_input_path, nrows=1)
                required_features = pipeline_artifact["features"]
                missing_features = [name for name in required_features if name not in cluster_rows.columns]
                if cluster_rows.empty or missing_features:
                    raise ValueError("Representative customer-clustering input does not match the saved feature contract")
                state = {"model": estimator, "pipeline": pipeline_artifact, "metadata": meta, "version": str(version)}
                result = cluster_inference(state, cluster_rows.iloc[0].to_dict())
                cluster_count = int(meta.get("number_of_clusters", getattr(estimator, "n_clusters", 0)))
                if not 0 <= result["clusterId"] < cluster_count:
                    raise ValueError("Customer-behaviour clusterer returned an invalid cluster assignment")

            MODEL_STATUS[key] = {
                **state,
                "status": "available",
                "lastLoadedAt": datetime.now(timezone.utc).isoformat(),
                "artifact": spec["model"],
                "preprocessing": spec["pipeline"],
            }
            LOGGER.info("%s ready.", spec["label"])
        except Exception as exc:
            LOGGER.exception("Model %s could not be loaded", key)
            MODEL_STATUS[key] = {"status": "unavailable", "version": None, "error": f"Model load or inference validation failed ({type(exc).__name__})"}
    if all(MODEL_STATUS.get(key, {}).get("status") == "available" for key in MODEL_IDS):
        LOGGER.info("All three ML models are ready.")


def initialize_snapshot() -> None:
    global INVOICES, CUSTOMERS
    INVOICES = load_json("invoices")
    CUSTOMERS = load_json("customers")


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_snapshot()
    load_models()
    # Model 4 loads independently: a missing/broken cash-flow artifact must not
    # affect MODEL_STATUS or the three-model health gate.
    try:
        forecasting.load_forecast_models()
        LOGGER.info("Cash-flow forecasting status: %s", forecasting.forecast_status()["status"])
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.warning("Cash-flow forecast loader failed: %s: %s", type(exc).__name__, exc)
    if os.getenv("APP_ENV", "development").lower() != "production":
        Base.metadata.create_all(bind=engine)
    # Keep local/development startup safe for databases created before the
    # Alembic role migration was enabled there.
    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET role = 'business_owner' WHERE role = 'admin'"))
        connection.execute(text("UPDATE users SET role = 'collection_user' WHERE role = 'collections'"))
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    seed_database()
    yield


app = FastAPI(title="FlowCred AI API", version="1.0.0", description="Explainable Accounts Receivable Intelligence System", lifespan=lifespan)
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])


def _invoice_key(value: Any) -> str:
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else str(value)
    except (ValueError, TypeError): return str(value)


def _backfill_invoice_payment_terms(db: Session) -> None:
    terms_by_invoice = {
        _invoice_key(item.get("id")): str(item["paymentTerms"]).strip()
        for item in INVOICES
        if item.get("id") is not None
        and isinstance(item.get("paymentTerms"), str)
        and item["paymentTerms"].strip()
    }
    missing_terms = db.scalars(
        select(Invoice).where(
            or_(Invoice.payment_terms.is_(None), Invoice.payment_terms == "")
        )
    ).all()
    updated = 0
    for invoice in missing_terms:
        terms = terms_by_invoice.get(invoice.invoice_id)
        if terms:
            invoice.payment_terms = terms
            updated += 1
    if updated:
        LOGGER.info("Backfilled payment terms for %d existing invoices", updated)
    unresolved = len(missing_terms) - updated
    if unresolved:
        LOGGER.warning("Payment terms remain unavailable for %d invoices", unresolved)


def seed_database() -> None:
    """Import the immutable cleaned source into an empty DB; never retrain/change it."""
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Invoice)):
            _backfill_invoice_payment_terms(db)
            _sync_model_registry(db)
            db.commit()
            return
        source = DATA_DIR / "processed" / "flowcred_cleaned.csv"
        if not source.exists():
            LOGGER.warning("Cleaned source dataset missing; database seed skipped: %s", source)
            return
        frame = pd.read_csv(source)
        cluster_path = DATA_DIR / "processed" / "customer_behavior_clusters.csv"
        cluster_map = {}
        if cluster_path.exists():
            clusters = pd.read_csv(cluster_path, dtype={"customer_id": str})
            cluster_col = "cluster_id" if "cluster_id" in clusters else "cluster"
            cluster_map = dict(zip(clusters["customer_id"].astype(str), clusters[cluster_col]))
        customers = frame[["customer_id", "name_customer"]].dropna(subset=["customer_id"]).drop_duplicates("customer_id", keep="last")
        customer_rows = []
        segment_rows = []
        for r in customers.itertuples(index=False):
            customer_id = str(r.customer_id)
            cluster = cluster_map.get(customer_id)
            cluster_id = int(cluster) if cluster is not None and pd.notna(cluster) else None
            customer_rows.append({"customer_id": customer_id, "customer_name": str(r.name_customer), "cluster_id": cluster_id})
            if cluster_id is not None:
                segment_rows.append({"customer_id": customer_id, "cluster_id": cluster_id, "model_version": "KMeans-K6"})
        db.bulk_insert_mappings(Customer, customer_rows)
        if segment_rows:
            db.bulk_insert_mappings(CustomerSegment, segment_rows)
        for col in ("invoice_date", "due_date", "payment_date"):
            frame[col] = pd.to_datetime(frame[col], errors="coerce").dt.date
            frame[col] = frame[col].astype(object).where(frame[col].notna(), None)
        frame = frame.dropna(subset=["invoice_id", "customer_id"])
        frame["invoice_id"] = frame["invoice_id"].map(_invoice_key)
        frame["customer_id"] = frame["customer_id"].astype(str)
        frame["invoice_amount"] = pd.to_numeric(frame["invoice_amount"], errors="coerce")
        frame["delay_days"] = pd.to_numeric(frame["delay_days"], errors="coerce")
        frame["is_late"] = pd.to_numeric(frame["is_late"], errors="coerce")
        frame = frame.dropna(subset=["invoice_id", "customer_id", "invoice_amount"])
        records = []
        for r in frame[["invoice_id", "customer_id", "invoice_amount", "invoice_currency", "invoice_date", "due_date", "payment_date", "delay_days", "is_late", "invoice_status", "cust_payment_terms"]].itertuples(index=False, name=None):
            invoice_id, customer_id, amount, currency, inv_date, due, paid, delay_days, late, status, payment_terms = r
            records.append({"invoice_id": invoice_id, "customer_id": customer_id, "invoice_amount": float(amount), "invoice_currency": str(currency), "invoice_date": inv_date, "due_date": due, "payment_date": paid, "delay_days": None if pd.isna(delay_days) else float(delay_days), "is_late": None if pd.isna(late) else bool(int(late)), "invoice_status": None if pd.isna(status) else str(status), "payment_terms": str(payment_terms).strip() if pd.notna(payment_terms) and str(payment_terms).strip() else None})
        db.bulk_insert_mappings(Invoice, records)
        _sync_model_registry(db)
        db.commit()
        LOGGER.info("Seeded %d customer and %d invoice records from the unchanged cleaned source", len(customers), len(records))


def _sync_model_registry(db: Session) -> None:
    for model_id, state in MODEL_STATUS.items():
        meta = state.get("metadata", {})
        db.merge(ModelRegistry(
            id=model_id,
            algorithm=meta.get("algorithm", meta.get("model_type", "unknown")),
            version=state.get("version"),
            artifact_path=str(MODEL_DIR / state.get("artifact", "")),
            preprocessing_path=str(MODEL_DIR / state.get("preprocessing", "")),
            status=state.get("status", "unavailable"),
            metadata_json={k:v for k,v in meta.items() if k not in {"feature_names", "feature_list", "cluster_feature_names"}},
        ))


class PredictionInput(BaseModel):
    invoice: dict[str, Any]
    customerHistory: dict[str, Any] = Field(default_factory=dict)


class RegisterInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    role: str = "accountant"


class LoginInput(BaseModel):
    email: str
    password: str


class RefreshInput(BaseModel):
    refreshToken: str


def _valid_email(email: str) -> bool:
    import re
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email))


@app.post("/api/v1/auth/register", status_code=201)
def register(body: RegisterInput, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not _valid_email(email): raise HTTPException(422, "A valid email address is required")
    if body.role not in ROLES: raise HTTPException(422, "Unknown role")
    # Only an operator-configured first account can bootstrap ownership.
    count = db.scalar(select(User.id).limit(1))
    bootstrap_owner = os.getenv("BOOTSTRAP_OWNER_EMAIL", os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")).strip().lower()
    role = "business_owner" if count is None and bootstrap_owner and email == bootstrap_owner else "accountant"
    if db.scalar(select(User.id).where(User.email == email)): raise HTTPException(409, "An account with this email already exists")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password), role=role)
    db.add(user); db.flush(); audit(db, user, "auth.register", "user", str(user.id)); result = issue_pair(user, db); db.commit()
    return result


@app.post("/api/v1/auth/login")
def login(body: LoginInput, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    result = issue_pair(user, db); audit(db, user, "auth.login", "user", str(user.id)); db.commit(); return result


@app.post("/api/v1/auth/refresh")
def refresh(body: RefreshInput, db: Session = Depends(get_db)):
    import jwt
    try:
        claims = jwt.decode(body.refreshToken, os.getenv("JWT_SECRET_KEY", "local-development-only-change-this-secret"), algorithms=[os.getenv("JWT_ALGORITHM", "HS256")])
        if claims.get("type") != "refresh": raise ValueError("wrong token type")
        old = db.get(RefreshToken, claims["jti"])
        if not old or old.revoked_at or old.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc): raise ValueError("revoked or expired token")
        user = db.get(User, old.user_id)
        if not user or not user.is_active: raise ValueError("inactive user")
    except Exception as exc: raise HTTPException(401, "Invalid, expired, or revoked refresh token") from exc
    old.revoked_at = datetime.now(timezone.utc)
    result = issue_pair(user, db)
    result_claims = jwt.decode(result["refreshToken"], os.getenv("JWT_SECRET_KEY", "local-development-only-change-this-secret"), algorithms=[os.getenv("JWT_ALGORITHM", "HS256")])
    old.replaced_by = result_claims["jti"]; audit(db, user, "auth.refresh", "user", str(user.id)); db.commit()
    return result


@app.post("/api/v1/auth/logout")
def logout(body: RefreshInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    import jwt
    try:
        claims = jwt.decode(body.refreshToken, os.getenv("JWT_SECRET_KEY", "local-development-only-change-this-secret"), algorithms=[os.getenv("JWT_ALGORITHM", "HS256")])
        token = db.get(RefreshToken, claims.get("jti"))
        if claims.get("type") != "refresh" or not token or token.user_id != user.id: raise ValueError("invalid token")
        token.revoked_at = datetime.now(timezone.utc)
        audit(db, user, "auth.logout", "user", str(user.id)); db.commit()
    except Exception as exc: raise HTTPException(401, "Invalid refresh token") from exc
    return {"ok": True}


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role, "company": "FlowCred Workspace"}


def paginated(items: list[dict[str, Any]], page: int, page_size: int) -> dict[str, Any]:
    total = len(items)
    return {"items": items[(page-1)*page_size:page*page_size], "page": page, "pageSize": page_size, "total": total, "totalPages": (total + page_size - 1)//page_size}


def sort_items(items: list[dict[str, Any]], by: str | None, order: str | None) -> list[dict[str, Any]]:
    key = by if by and all(by in i for i in items[:20]) else "id"
    return sorted(items, key=lambda x: (x.get(key) is None, str(x.get(key, "")).lower()), reverse=order == "desc")


def _latest_prediction_value(field, kind: str):
    return (
        select(field)
        .where(Prediction.invoice_id == Invoice.invoice_id, Prediction.prediction_type == kind)
        .order_by(Prediction.predicted_at.desc(), Prediction.id.desc())
        .limit(1)
        .correlate(Invoice)
        .scalar_subquery()
    )


def _invoice_record(row) -> dict[str, Any]:
    invoice, customer, late_probability, band, predicted_delay = row
    return {
        "id": invoice.invoice_id,
        "customerId": invoice.customer_id,
        "customerName": customer.customer_name or "",
        "amount": float(invoice.invoice_amount),
        "currency": invoice.invoice_currency,
        "invoiceDate": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "dueDate": invoice.due_date.isoformat() if invoice.due_date else None,
        "paymentDate": invoice.payment_date.isoformat() if invoice.payment_date else None,
        "paymentTerms": invoice.payment_terms or "",
        "status": invoice.invoice_status,
        "delayDays": float(invoice.delay_days) if invoice.delay_days is not None else None,
        "isLate": bool(invoice.is_late) if invoice.is_late is not None else None,
        "lateProbability": float(late_probability) if late_probability is not None else None,
        "riskBand": band,
        "predictedDelay": float(predicted_delay) if predicted_delay is not None else None,
    }


@app.get("/api/v1/health")
def health(db: Session = Depends(get_db)):
    models_ready = all(MODEL_STATUS.get(key, {}).get("status") == "available" for key in MODEL_IDS)
    try:
        db.execute(text("SELECT 1"))
        database = {"status": "available"}
    except Exception as exc:
        LOGGER.warning("Health database connectivity check failed (%s)", type(exc).__name__)
        database = {"status": "unavailable", "error": "Database connectivity check failed"}
    models = [
        {
            "id": key,
            "status": MODEL_STATUS.get(key, {}).get("status", "unavailable"),
            "version": MODEL_STATUS.get(key, {}).get("version"),
            "algorithm": MODEL_STATUS.get(key, {}).get("metadata", {}).get("algorithm", MODEL_STATUS.get(key, {}).get("metadata", {}).get("model_type")),
            "loadingStatus": "loaded" if MODEL_STATUS.get(key, {}).get("status") == "available" else "unavailable",
            "lastLoadedAt": MODEL_STATUS.get(key, {}).get("lastLoadedAt"),
            **({"error": MODEL_STATUS[key]["error"]} if MODEL_STATUS.get(key, {}).get("error") else {}),
        }
        for key in MODEL_IDS
    ]
    status_value = "ok" if models_ready and database["status"] == "available" else "degraded"
    payload = {"status": status_value, "mode": "live", "apiVersion": app.version, "environment": os.getenv("APP_ENV", "development"), "businessDate": business_today().isoformat(), "authentication": {"jwt": "active", "sso": "not_configured"}, "database": database, "models": models, "timestamp": datetime.now(timezone.utc).isoformat()}
    return payload if status_value == "ok" else JSONResponse(status_code=503, content=payload)



@app.get("/api/v1/models/status")
def models_status():
    specs = {
        "late-payment": ("Late-payment classification", "XGBoost Classifier"),
        "payment-delay": ("Payment-delay regression", "HistGradientBoosting Regressor"),
        "clustering": ("Customer behaviour clustering", "K-Means"),
    }
    forecast = forecasting.forecast_status()
    forecast_versions = [m.get("version") for m in forecast.get("models", []) if m.get("version")]
    return {"models": [{
        "id": key, "name": specs[key][0], "algorithm": specs[key][1],
        "availability": MODEL_STATUS.get(key, {}).get("status", "unavailable"),
        "loadingStatus": "loaded" if MODEL_STATUS.get(key, {}).get("status") == "available" else "unavailable",
        "version": MODEL_STATUS.get(key, {}).get("version"),
        "lastLoadedAt": MODEL_STATUS.get(key, {}).get("lastLoadedAt"),
        **({"error": MODEL_STATUS[key]["error"]} if MODEL_STATUS.get(key, {}).get("error") else {}),
    } for key in MODEL_IDS] + [{
        "id": "cash-flow", "name": "Cash-flow forecasting", "algorithm": "Weekly currency-specific forecaster",
        "availability": forecast.get("status", "unavailable"),
        "loadingStatus": "loaded" if forecast.get("status") == "available" else "unavailable",
        "version": ", ".join(map(str, forecast_versions)) or None,
        "lastLoadedAt": None,
    }]}


@app.get("/api/v1/capabilities")
def capabilities():
    """Expose route registration metadata; never invokes mutations to probe support."""
    contracts = [
        ("GET", "/dashboard/summary", ANALYTICS_ROLES), ("GET", "/invoices", ANALYTICS_ROLES), ("GET", "/invoices/{invoice_id}", ANALYTICS_ROLES),
        ("GET", "/customers", ANALYTICS_ROLES), ("GET", "/customers/{customer_id}", ANALYTICS_ROLES), ("GET", "/customers/segments", ANALYTICS_ROLES),
        ("GET", "/payment-risk/summary", ANALYTICS_ROLES), ("GET", "/delay-predictions/summary", ANALYTICS_ROLES), ("GET", "/models/metrics", ("business_owner",)),
        ("GET", "/insights", ("business_owner", "accountant")), ("GET", "/datasets/quality", ("business_owner", "accountant")),
        ("GET", "/datasets", ("business_owner", "accountant")), ("POST", "/datasets/scoring-jobs", ANALYTICS_ROLES), ("GET", "/datasets/scoring-jobs/{job_id}", ANALYTICS_ROLES), ("GET", "/search?q=", ANALYTICS_ROLES), ("GET", "/health", ()),
        ("POST", "/invoices/predict/late-payment", ANALYTICS_ROLES), ("POST", "/invoices/predict/payment-delay", ANALYTICS_ROLES), ("POST", "/datasets/upload", ("business_owner",)),
        ("GET", "/cash-flow/health", ()), ("GET", "/cash-flow/forecast", ROLES), ("GET", "/cash-flow/runs", ROLES), ("POST", "/cash-flow/runs", ("admin", "business_owner")),
    ]
    registered = {(method, route.path) for route in app.routes for method in getattr(route, "methods", set())}
    rows = []
    for method, path, roles in contracts:
        route_path = path.split("?", 1)[0]
        rows.append({"method": method, "path": path, "implemented": (method, f"/api/v1{route_path}") in registered, "authenticationRequired": bool(roles), "roles": list(roles)})
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "endpoints": rows, "authentication": {"jwt": "active", "sso": "not_configured"}, "reports": {"scheduledDelivery": "not_implemented", "serverStorage": "not_implemented"}}




# =====
# Model 4 — cash-flow forecasting
# =====
class CashFlowRunInput(BaseModel):
    currency: str = Field(default="USD")
    horizon: int = Field(default=30)
    asOf: str | None = None


def _forecast_params(currency: str, horizon: int, as_of: str | None) -> tuple[str, int, str | None]:
    ccy = (currency or "").strip().upper()
    if ccy not in forecasting.CURRENCIES:
        raise HTTPException(422, f"currency must be one of {list(forecasting.CURRENCIES)}")
    if horizon not in forecasting.HORIZONS:
        raise HTTPException(422, f"horizon must be one of {list(forecasting.HORIZONS)}")
    return ccy, int(horizon), (as_of or None)


@app.get("/api/v1/cash-flow/health")
def cash_flow_health():
    """Forecast-only readiness. Independent of the three-model health gate."""
    status = forecasting.forecast_status()
    payload = {"apiVersion": "v1", **status, "timestamp": datetime.now(timezone.utc).isoformat()}
    if status["status"] != "available":
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/api/v1/cash-flow/forecast", dependencies=[Depends(allow_roles(*ROLES))])
def cash_flow_forecast(
    currency: str = Query("USD"),
    horizon: int = Query(30),
    asOf: str | None = Query(None),
):
    """Pure read: generates a forecast from stored artifacts and writes nothing."""
    ccy, h, as_of = _forecast_params(currency, horizon, asOf)
    try:
        return forecasting.build_forecast_payload(ccy, h, as_of)
    except forecasting.ForecastUnavailable as exc:
        raise HTTPException(503, f"cash-flow model pipeline unavailable: {exc}") from exc
    except forecasting.ForecastError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/v1/cash-flow/runs", dependencies=[Depends(allow_roles(*ROLES))])
def list_cash_flow_runs(currency: str | None = Query(None), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = select(CashFlowForecastRun).order_by(CashFlowForecastRun.created_at.desc()).limit(limit)
    if currency:
        query = query.where(CashFlowForecastRun.currency == currency.strip().upper())
    runs = db.scalars(query).all()
    return {
        "items": [
            {
                "runId": run.id,
                "currency": run.currency,
                "asOf": str(run.as_of),
                "horizonDays": run.horizon_days,
                "modelId": run.model_id,
                "modelVersion": run.model_version,
                "status": run.status,
                "totals": run.metrics_json,
                "createdAt": run.created_at.isoformat() if run.created_at else None,
            }
            for run in runs
        ]
    }


@app.post("/api/v1/cash-flow/runs", dependencies=[Depends(allow_roles("admin", "business_owner"))])
def create_cash_flow_run(payload: CashFlowRunInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ccy, horizon, as_of = _forecast_params(payload.currency, payload.horizon, payload.asOf)
    try:
        data = forecasting.build_forecast_payload(ccy, horizon, as_of)
    except forecasting.ForecastUnavailable as exc:
        raise HTTPException(503, f"cash-flow model pipeline unavailable: {exc}") from exc
    except forecasting.ForecastError as exc:
        raise HTTPException(422, str(exc)) from exc

    run = CashFlowForecastRun(
        id=str(uuid4()),
        as_of=date.fromisoformat(data["asOf"]),
        horizon_days=horizon,
        currency=ccy,
        model_id=data["model"]["id"],
        model_version=data["model"]["version"],
        status="generated",
        metrics_json=data["totals"],
        assumptions_json={"assumptions": data["assumptions"], "disclaimer": data["disclaimer"], "model": data["model"]},
        created_by=user.id,
    )
    db.add(run)
    for week in data["weekly"]:
        db.add(CashFlowForecastPoint(
            run_id=run.id, granularity="weekly", point_date=date.fromisoformat(week["weekStart"]),
            predicted=week["predicted"], lower=week["lower"], upper=week["upper"],
        ))
    for day in data["daily"]:
        db.add(CashFlowForecastPoint(
            run_id=run.id, granularity="daily", point_date=date.fromisoformat(day["date"]),
            predicted=day["estimated"], lower=day["lower"], upper=day["upper"],
        ))
    audit(db, user, "prediction.cash-flow", "cash_flow_run", run.id)
    db.commit()
    LOGGER.info("Cash-flow forecast run persisted: %s %s %sd", ccy, data["asOf"], horizon)
    return {"runId": run.id, "createdAt": datetime.now(timezone.utc).isoformat(), "forecast": data}



@app.get("/api/v1/dashboard/summary", dependencies=[Depends(allow_roles("business_owner", "accountant"))])

def dashboard(): return load_json("dashboard")


@app.get("/api/v1/invoices", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def list_invoices(page: int = Query(1, ge=1), pageSize: int = Query(25, ge=1, le=1000), search: str | None = None, customerId: str | None = None, status: str | None = None, riskBand: str | None = None, dateFrom: str | None = None, dateTo: str | None = None, amountMin: float | None = None, amountMax: float | None = None, hasPrediction: bool | None = None, hasDelayPrediction: bool | None = None, sortBy: str | None = None, sortOrder: str | None = "desc", db: Session = Depends(get_db)):
    late_probability = _latest_prediction_value(Prediction.probability, "late-payment")
    late_band = _latest_prediction_value(Prediction.risk_band, "late-payment")
    predicted_delay = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    filters = []
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Invoice.invoice_id.ilike(term), Invoice.customer_id.ilike(term), Customer.customer_name.ilike(term)))
    if customerId: filters.append(Invoice.customer_id == customerId)
    if status and status != "all": filters.append(Invoice.invoice_status == status)
    if riskBand and riskBand != "all": filters.append(late_band == riskBand)
    if dateFrom:
        try: filters.append(Invoice.invoice_date >= date.fromisoformat(dateFrom))
        except ValueError as exc: raise HTTPException(422, "dateFrom must be YYYY-MM-DD") from exc
    if dateTo:
        try: filters.append(Invoice.invoice_date <= date.fromisoformat(dateTo))
        except ValueError as exc: raise HTTPException(422, "dateTo must be YYYY-MM-DD") from exc
    if amountMin is not None: filters.append(Invoice.invoice_amount >= amountMin)
    if amountMax is not None: filters.append(Invoice.invoice_amount <= amountMax)
    if hasPrediction is not None: filters.append(late_probability.is_not(None) if hasPrediction else late_probability.is_(None))
    if hasDelayPrediction is not None: filters.append(predicted_delay.is_not(None) if hasDelayPrediction else predicted_delay.is_(None))
    base = select(Invoice, Customer, late_probability, late_band, predicted_delay).join(Customer, Customer.customer_id == Invoice.customer_id).where(*filters)
    total = db.scalar(select(func.count()).select_from(Invoice).join(Customer, Customer.customer_id == Invoice.customer_id).where(*filters)) or 0
    sortable = {"id": Invoice.invoice_id, "invoiceDate": Invoice.invoice_date, "dueDate": Invoice.due_date, "amount": Invoice.invoice_amount, "status": Invoice.invoice_status, "customerName": Customer.customer_name, "lateProbability": late_probability, "riskBand": late_band, "predictedDelay": predicted_delay}
    sort_column = sortable.get(sortBy or "invoiceDate", Invoice.invoice_date)
    direction = sort_column.asc() if sortOrder == "asc" else sort_column.desc()
    rows = db.execute(base.order_by(direction, Invoice.invoice_id.asc()).offset((page-1)*pageSize).limit(pageSize)).all()
    return {"items": [_invoice_record(row) for row in rows], "page": page, "pageSize": pageSize, "total": total, "totalPages": (total+pageSize-1)//pageSize}


@app.get("/api/v1/invoices/{invoice_id}", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def invoice_detail(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None: raise HTTPException(404, "Invoice not found")
    customer_db = db.get(Customer, invoice.customer_id)
    late_probability = _latest_prediction_value(Prediction.probability, "late-payment")
    late_band = _latest_prediction_value(Prediction.risk_band, "late-payment")
    predicted_delay = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    current = db.execute(select(Invoice, Customer, late_probability, late_band, predicted_delay).join(Customer).where(Invoice.invoice_id == invoice_id)).one()
    invoice_data = _invoice_record(current)
    customer = next((c for c in CUSTOMERS if str(c.get("id")) == invoice.customer_id), None)
    if customer is None:
        customer = {"id": invoice.customer_id, "name": customer_db.customer_name or "", "clusterId": customer_db.cluster_id, "totalInvoices": 0, "activeMonths": 0, "totalInvoiceAmount": None, "outstandingAmount": None, "avgInvoiceAmount": None, "medianInvoiceAmount": None, "paidInvoices": 0, "openInvoices": 0, "lateInvoices": 0, "onTimeInvoices": 0, "latePaymentRatio": None, "avgPaymentDelay": None, "medianPaymentDelay": None, "invoiceFrequency": 0, "customerLifetimeDays": 0, "daysSinceLastInvoice": 0, "recentAvgDelay": None, "recentLateRatio": None, "paymentTermConsistency": None, "lastInvoiceDate": None}
    history_query = select(Invoice, Customer, late_probability, late_band, predicted_delay).join(Customer).where(Invoice.customer_id == invoice.customer_id, Invoice.invoice_date < invoice.invoice_date).order_by(Invoice.invoice_date.desc(), Invoice.invoice_id.desc()).limit(8)
    history = [_invoice_record(row) for row in db.execute(history_query).all()]
    prediction_rows = db.scalars(select(Prediction).where(Prediction.invoice_id == invoice_id).order_by(Prediction.predicted_at.desc(), Prediction.id.desc()).limit(100)).all()
    prediction_history = [{
        "id": item.id, "type": item.prediction_type, "value": float(item.predicted_value) if item.predicted_value is not None else None,
        "probability": float(item.probability) if item.probability is not None else None, "riskBand": item.risk_band,
        "modelVersion": item.model_version, "predictedAt": item.predicted_at.isoformat(), "details": item.details,
    } for item in prediction_rows]
    scoring_state = db.get(InvoiceScoringState, invoice_id)
    seg = load_json("segments")
    cluster_id = customer_db.cluster_id
    cluster = next((x for x in seg.get("sizes", []) if x.get("clusterId") == cluster_id), {})
    days = (invoice.due_date - invoice.invoice_date).days if invoice.due_date and invoice.invoice_date else 0
    context_features = (
        _history_features_as_of(
            invoice, _prior_paid_invoices_as_of(db, invoice), "late-payment"
        )
        if invoice.invoice_date is not None
        else {}
    )
    context = {
        "previousAvgDelay": _optional_float(context_features.get("previous_avg_delay")),
        "previousLateRatio": _optional_float(context_features.get("previous_late_ratio")),
        "previousInvoiceCount": context_features.get("previous_invoice_count", 0),
        "previousMedianDelay": _optional_float(context_features.get("previous_median_delay")),
        "hasPaymentHistory": bool(context_features.get("has_payment_history", 0)),
        "daysUntilDue": days,
    }
    return {"invoice": invoice_data, "customer": customer, "clusterId": cluster_id, "cluster": cluster, "history": history, "predictionHistory": prediction_history, "scoringState": ({"status": scoring_state.status, "reason": scoring_state.reason, "updatedAt": scoring_state.updated_at.isoformat()} if scoring_state else None), "context": context}


def _empty_customer(customer: Customer) -> dict[str, Any]:
    return {
        "id": customer.customer_id, "name": customer.customer_name or "", "clusterId": customer.cluster_id,
        "totalInvoices": 0, "activeMonths": 0, "totalInvoiceAmount": None, "outstandingAmount": None,
        "avgInvoiceAmount": None, "medianInvoiceAmount": None, "paidInvoices": 0, "openInvoices": 0,
        "lateInvoices": 0, "onTimeInvoices": 0, "latePaymentRatio": None, "avgPaymentDelay": None,
        "medianPaymentDelay": None, "invoiceFrequency": 0, "customerLifetimeDays": 0,
        "daysSinceLastInvoice": 0, "recentAvgDelay": None, "recentLateRatio": None,
        "paymentTermConsistency": None, "lastInvoiceDate": None, "scoredInvoices": 0,
        "avgLateProbability": None, "highRiskInvoices": 0,
    }


@app.get("/api/v1/customers", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def list_customers(page: int = Query(1, ge=1), pageSize: int = Query(25, ge=1, le=1000), search: str | None = None, clusterId: str | None = None, sortBy: str | None = None, sortOrder: str | None = "asc", db: Session = Depends(get_db)):
    profiles = {str(c["id"]): c for c in CUSTOMERS}
    rows = [profiles.get(c.customer_id, _empty_customer(c)) for c in db.scalars(select(Customer).order_by(Customer.customer_id)).all()]
    if search: rows = [c for c in rows if search.lower() in f"{c.get('id','')} {c.get('name','')}".lower()]
    if clusterId and clusterId != "all": rows = [c for c in rows if str(c.get("clusterId")) == clusterId]
    return paginated(sort_items(rows, sortBy, sortOrder), page, pageSize)


@app.get("/api/v1/customers/segments", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def segments(): return load_json("segments")


@app.get("/api/v1/customers/{customer_id}", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def customer_detail(customer_id: str, db: Session = Depends(get_db)):
    customer_db = db.get(Customer, customer_id)
    if not customer_db: raise HTTPException(404, "Customer not found")
    customer = next((c for c in CUSTOMERS if str(c.get("id")) == customer_id), _empty_customer(customer_db))
    seg = load_json("segments"); cluster_id = customer.get("clusterId", 0)
    cluster = next((x for x in seg.get("sizes", []) if x.get("clusterId") == cluster_id), {})
    late_probability = _latest_prediction_value(Prediction.probability, "late-payment")
    late_band = _latest_prediction_value(Prediction.risk_band, "late-payment")
    predicted_delay = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    history_query = select(Invoice, Customer, late_probability, late_band, predicted_delay).join(Customer).where(Invoice.customer_id == customer_id).order_by(Invoice.invoice_date.desc(), Invoice.invoice_id.desc())
    history = [_invoice_record(row) for row in db.execute(history_query).all()]
    comparisons = []
    features = [("avgInvoiceAmount", "Average invoice"), ("latePaymentRatio", "Late payment ratio"), ("avgPaymentDelay", "Average payment delay")]
    cluster_values = {
        "avgInvoiceAmount": cluster.get("avgInvoiceAmount"),
        "latePaymentRatio": cluster.get("avgLatePaymentRatio"),
        "avgPaymentDelay": cluster.get("avgPaymentDelay"),
    }
    for key, label in features:
        vals = [float(c[key]) for c in CUSTOMERS if isinstance(c.get(key), (int,float))]
        comparisons.append({"feature": key, "label": label, "customerValue": customer.get(key), "clusterValue": cluster_values[key], "globalMedian": float(pd.Series(vals).median()) if vals else None})
    scored = [i for i in history if i.get("lateProbability") is not None]
    high = [i for i in scored if i.get("riskBand") == "High"]
    risk = {
        "scoredInvoices": len(scored),
        "avgProbability": sum(i["lateProbability"] for i in scored)/len(scored) if scored else None,
        "highRiskInvoices": len(high),
        "predictedLateInvoices": sum(i["lateProbability"] >= .45 for i in scored),
        "avgPredictedDelay": sum(i["predictedDelay"] for i in history if i.get("predictedDelay") is not None) / max(1, sum(i.get("predictedDelay") is not None for i in history)) if any(i.get("predictedDelay") is not None for i in history) else None,
        "outstanding": customer.get("outstandingAmount"),
    }
    return {"customer": customer, "cluster": cluster, "history": history[:100], "scoredInvoices": scored, "comparison": comparisons, "risk": risk}


@app.get("/api/v1/payment-risk/summary", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def risk(db: Session = Depends(get_db)):
    summary = dict(load_json("risk"))
    probability = _latest_prediction_value(Prediction.probability, "late-payment")
    band = _latest_prediction_value(Prediction.risk_band, "late-payment")
    delay_value = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    rows = db.execute(select(Invoice, Customer, probability, band, delay_value).join(Customer).where(probability.is_not(None))).all()
    records = [{
        "id": inv.invoice_id, "customerId": inv.customer_id, "customerName": customer.customer_name or "",
        "amount": float(inv.invoice_amount), "currency": inv.invoice_currency,
        "invoiceDate": inv.invoice_date.isoformat() if inv.invoice_date else "",
        "dueDate": inv.due_date.isoformat() if inv.due_date else "", "status": inv.invoice_status,
        "lateProbability": float(prob), "riskBand": saved_band,
        "predictedDelay": float(delay) if delay is not None else None,
    } for inv, customer, prob, saved_band, delay in rows]
    total = len(records)
    counts = {name: sum(row["riskBand"] == band_name for row in records) for name, band_name in (("low", "Low"), ("medium", "Medium"), ("high", "High"))}
    open_rows = [row for row in records if row["status"] in {"open", "overdue"}]
    open_counts = {name: sum(row["riskBand"] == band_name for row in open_rows) for name, band_name in (("openLow", "Low"), ("openMedium", "Medium"), ("openHigh", "High"))}
    summary["counts"] = {**counts, **open_counts, "totalScored": total, "totalOpenScored": len(open_rows)}
    summary["distribution"] = [{"band": name, "count": counts[key], "percentage": round(counts[key] * 100 / total, 2) if total else 0} for key, name in (("low", "Low"), ("medium", "Medium"), ("high", "High"))]
    summary["exposureByBand"] = [{"band": name, "invoices": counts[key], "openInvoices": open_counts[open_key], "outstanding": round(sum(row["amount"] for row in open_rows if row["riskBand"] == name), 2)} for key, open_key, name in (("low", "openLow", "Low"), ("medium", "openMedium", "Medium"), ("high", "openHigh", "High"))]
    summary["queue"] = sorted(records, key=lambda row: row["lateProbability"], reverse=True)
    customers: dict[str, list[dict[str, Any]]] = {}
    for row in records: customers.setdefault(row["customerId"], []).append(row)
    summary["customerRisk"] = [{"id": cid, "name": items[0]["customerName"], "scoredInvoices": len(items), "avgProbability": sum(i["lateProbability"] for i in items) / len(items), "highRiskInvoices": sum(i["riskBand"] == "High" for i in items), "totalAmount": sum(i["amount"] for i in items), "latestInvoice": max((i["invoiceDate"] for i in items), default="")} for cid, items in customers.items()]
    trend_groups: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        if row["invoiceDate"]:
            trend_groups.setdefault(row["invoiceDate"][:7], []).append(row)
    summary["trend"] = [{
        "month": pd.Timestamp(f"{month_key}-01").strftime("%b %Y"), "monthKey": month_key,
        "scored": len(items), "avgProbability": sum(i["lateProbability"] for i in items) / len(items),
        "highRisk": sum(i["riskBand"] == "High" for i in items),
        "mediumRisk": sum(i["riskBand"] == "Medium" for i in items),
        "outstanding": sum(i["amount"] for i in items if i["status"] in {"open", "overdue"}),
    } for month_key, items in sorted(trend_groups.items())]
    return summary

@app.get("/api/v1/delay-predictions/summary", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def delay(db: Session = Depends(get_db)):
    summary = dict(load_json("delay"))
    predicted = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    rows = db.execute(select(Invoice, Customer, predicted).join(Customer).where(predicted.is_not(None))).all()
    records = [{"invoice": inv, "customer": customer, "value": float(value)} for inv, customer, value in rows]
    values = [row["value"] for row in records]
    early = [value for value in values if value < -0.5]
    on_time = [value for value in values if -0.5 <= value <= 0.5]
    late = [value for value in values if value > 0.5]
    summary["counts"] = {"early": len(early), "onTime": len(on_time), "late": len(late), "scored": len(values)}
    total = max(1, len(values))
    summary["averagePredictedDelay"] = sum(values) / total if values else 0
    summary["medianPredictedDelay"] = float(pd.Series(values).median()) if values else 0
    summary["earlyPercentage"] = len(early) * 100 / total if values else 0
    summary["onTimePercentage"] = len(on_time) * 100 / total if values else 0
    summary["latePercentage"] = len(late) * 100 / total if values else 0
    bounds = [(-float("inf"), -13), (-13, -6), (-6, -0.5), (-0.5, 0.5), (0.5, 6), (6, 13), (13, float("inf"))]
    labels = ["14+ days early", "7–13 days early", "1–6 days early", "On time (0)", "1–6 days late", "7–13 days late", "14+ days late"]
    summary["distribution"] = [{"bucket": label, "count": sum(low <= value < high for value in values)} for label, (low, high) in zip(labels, bounds)]
    by_customer: dict[str, list[dict[str, Any]]] = {}
    for row in records: by_customer.setdefault(row["invoice"].customer_id, []).append(row)
    summary["customerDelay"] = [{
        "id": cid, "name": items[0]["customer"].customer_name or "", "invoices": len(items),
        "avgPredictedDelay": sum(i["value"] for i in items) / len(items),
        "avgActualDelay": (sum(float(i["invoice"].delay_days) for i in items if i["invoice"].payment_date is not None and i["invoice"].delay_days is not None) / sum(i["invoice"].payment_date is not None and i["invoice"].delay_days is not None for i in items)) if any(i["invoice"].payment_date is not None and i["invoice"].delay_days is not None for i in items) else None,
        "maxPredictedDelay": max(i["value"] for i in items),
    } for cid, items in by_customer.items()]
    return summary
@app.get("/api/v1/models/metrics", dependencies=[Depends(allow_roles("business_owner"))])
def metrics(): return load_json("model-metrics")
@app.get("/api/v1/insights", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def insights(): return load_json("insights")
@app.get("/api/v1/datasets/quality", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def quality(): return load_json("data-quality")
@app.get("/api/v1/datasets", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def datasets(): return load_json("datasets")


@app.get("/api/v1/search", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def search(q: str = Query("", min_length=0)):
    term = q.strip().lower()
    if len(term) < 2: return {"invoices": [], "customers": []}
    invoices = [i for i in INVOICES if term in f"{i.get('id','')} {i.get('customerName','')} {i.get('customerId','')}".lower()][:6]
    customers = [{"id": c["id"], "name": c["name"], "clusterId": c["clusterId"]} for c in CUSTOMERS if term in f"{c.get('id','')} {c.get('name','')}".lower()][:5]
    return {"invoices": invoices, "customers": customers}


def unavailable(model: str):
    state = MODEL_STATUS.get(model, {})
    if state.get("status") != "available":
        raise HTTPException(503, f"{model} model pipeline unavailable: {state.get('error', 'artifacts not loaded')}")
    return state


def _saved_invoice_from_payload(db: Session, invoice_data: dict[str, Any]) -> Invoice | None:
    raw_id = invoice_data.get("id", invoice_data.get("invoice_id", invoice_data.get("invoiceId")))
    if raw_id is None or str(raw_id).strip() == "":
        return None
    raw_key = str(raw_id)
    return db.get(Invoice, raw_key) or db.get(Invoice, _invoice_key(raw_key))


def _history_features_as_of(
    invoice: Invoice,
    previous_invoices: list[Invoice],
    model_id: str,
) -> dict[str, Any]:
    if invoice.invoice_date is None:
        raise HTTPException(422, "Stored invoice is missing invoice_date")

    prior = sorted(
        (
            previous
            for previous in previous_invoices
            if previous.invoice_date is not None
            and previous.invoice_date < invoice.invoice_date
            and previous.payment_date is not None
            and previous.payment_date < invoice.invoice_date
            and previous.delay_days is not None
        ),
        key=lambda previous: (previous.invoice_date, previous.invoice_id),
    )
    delays = [float(previous.delay_days) for previous in prior]
    amounts = [float(previous.invoice_amount) for previous in prior]
    late_count = sum(
        bool(previous.is_late)
        if model_id == "late-payment" and previous.is_late is not None
        else float(previous.delay_days) > 0
        for previous in prior
    )
    count = len(prior)
    last_invoice_date = prior[-1].invoice_date if prior else None
    days_since_previous = (
        float((invoice.invoice_date - last_invoice_date).days) if last_invoice_date else float("nan")
    )
    return {
        "previous_invoice_count": count,
        "previous_paid_invoice_count": count,
        "previous_late_count": late_count,
        "previous_late_ratio": late_count / count if count else 0.0,
        "previous_avg_delay": sum(delays) / count if count else float("nan"),
        "previous_median_delay": float(pd.Series(delays).median()) if count else float("nan"),
        "previous_max_delay": max(delays) if count else float("nan"),
        "previous_min_delay": min(delays) if count else float("nan"),
        "previous_avg_invoice_amount": sum(amounts) / count if count else float("nan"),
        "previous_total_invoice_amount": sum(amounts) if count else 0.0,
        "previous_days_since_invoice": days_since_previous,
        "days_since_previous_invoice": days_since_previous,
        "has_payment_history": int(bool(count)),
    }


def _prior_paid_invoices_as_of(db: Session, invoice: Invoice) -> list[Invoice]:
    if invoice.invoice_date is None:
        raise HTTPException(422, "Stored invoice is missing invoice_date")
    return db.scalars(
        select(Invoice)
        .where(
            Invoice.customer_id == invoice.customer_id,
            Invoice.invoice_date < invoice.invoice_date,
            Invoice.payment_date.is_not(None),
            Invoice.payment_date < invoice.invoice_date,
        )
        .order_by(Invoice.invoice_date, Invoice.invoice_id)
    ).all()


def _optional_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _prediction_inputs(
    db: Session,
    payload: PredictionInput,
    model_id: str,
) -> tuple[Invoice | None, dict[str, Any], dict[str, Any]]:
    saved_invoice = _saved_invoice_from_payload(db, payload.invoice)
    if saved_invoice is None:
        return None, payload.invoice, payload.customerHistory

    if saved_invoice.invoice_status == "paid" or saved_invoice.payment_date is not None:
        raise HTTPException(422, "Paid invoices are not eligible for future payment predictions")

    if not saved_invoice.payment_terms or not saved_invoice.payment_terms.strip():
        raise HTTPException(422, "Stored invoice is missing payment terms")
    if saved_invoice.invoice_date is None:
        raise HTTPException(422, "Stored invoice is missing invoice_date")
    if saved_invoice.due_date is None:
        raise HTTPException(422, "Stored invoice is missing due_date")

    previous_invoices = _prior_paid_invoices_as_of(db, saved_invoice)
    customer_history = _history_features_as_of(
        saved_invoice, previous_invoices, model_id
    )
    resolved_invoice = {
        "id": saved_invoice.invoice_id,
        "amount": float(saved_invoice.invoice_amount),
        "currency": saved_invoice.invoice_currency,
        "invoiceDate": saved_invoice.invoice_date.isoformat(),
        "dueDate": saved_invoice.due_date.isoformat(),
        "paymentTerms": saved_invoice.payment_terms,
    }
    return saved_invoice, resolved_invoice, customer_history


def risk_band(p: float) -> str: return "Low" if p < .3 else "Medium" if p < .7 else "High"


@app.post("/api/v1/invoices/predict/late-payment", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def predict_late(payload: PredictionInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    state = unavailable("late-payment")
    saved_invoice, invoice_data, customer_history = _prediction_inputs(
        db, payload, "late-payment"
    )
    from .ml import late_inference
    result = late_inference(state, invoice_data, customer_history)
    db.add(Prediction(id=str(uuid4()), invoice_id=saved_invoice.invoice_id if saved_invoice else None, customer_id=saved_invoice.customer_id if saved_invoice else None, prediction_type="late-payment", predicted_value=result["probability"], probability=result["probability"], risk_band=result["riskBand"], model_version=result["modelVersion"], details={"threshold": result["threshold"], "predictedLate": result["predictedLate"]}))
    audit(db, user, "prediction.late-payment", "invoice", saved_invoice.invoice_id if saved_invoice else None)
    LOGGER.info("Inference completed: model=late-payment")
    db.commit()
    return result


@app.post("/api/v1/invoices/predict/payment-delay", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def predict_delay(payload: PredictionInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    state = unavailable("payment-delay")
    saved_invoice, invoice_data, customer_history = _prediction_inputs(
        db, payload, "payment-delay"
    )
    from .ml import delay_inference
    result = delay_inference(state, invoice_data, customer_history)
    db.add(Prediction(id=str(uuid4()), invoice_id=saved_invoice.invoice_id if saved_invoice else None, customer_id=saved_invoice.customer_id if saved_invoice else None, prediction_type="payment-delay", predicted_value=result["predictedDelayDays"], model_version=result["modelVersion"]))
    audit(db, user, "prediction.payment-delay", "invoice", saved_invoice.invoice_id if saved_invoice else None)
    LOGGER.info("Inference completed: model=payment-delay")
    db.commit()
    return result


class BulkScoringInput(BaseModel):
    rescore: bool = False


def _scoring_job_payload(job: ScoringJob) -> dict[str, Any]:
    return {
        "id": job.id, "status": job.status, "total": job.total,
        "processed": job.processed, "succeeded": job.succeeded,
        "skipped": job.skipped, "failed": job.failed,
        "progressPercent": round(job.processed * 100 / job.total) if job.total else 100,
        "results": job.results or {}, "createdAt": job.created_at.isoformat(),
        "updatedAt": job.updated_at.isoformat(),
    }


def _new_scoring_job(db: Session, user: User, *, rescore: bool = False) -> ScoringJob:
    total = db.scalar(select(func.count()).select_from(Invoice).where(Invoice.invoice_status.in_(["open", "overdue"]))) or 0
    job = ScoringJob(
        id=str(uuid4()), status="queued", total=total, requested_by=user.id,
        results={"rescore": rescore, "successful": [], "skippedInvoices": [], "failures": []},
    )
    db.add(job)
    db.flush()
    return job


def _bulk_score_job(job_id: str) -> None:
    """Score unpaid invoices in committed pages, reusing the saved inference artifacts."""
    from .ml import late_inference, delay_inference

    db = SessionLocal()
    try:
        job = db.get(ScoringJob, job_id)
        if job is None:
            return
        job.status = "running"
        db.commit()
        late_state = MODEL_STATUS.get("late-payment", {})
        delay_state = MODEL_STATUS.get("payment-delay", {})
        if late_state.get("status") != "available" or delay_state.get("status") != "available":
            job.status = "failed"
            job.failed = job.total
            job.processed = job.total
            job.results = {**(job.results or {}), "failures": [{"reason": "Saved classifier or regressor model is unavailable"}]}
            db.commit()
            return

        rescore = bool((job.results or {}).get("rescore"))
        run_nonce = job.id if rescore else None
        page_size = 100
        offset = 0
        while True:
            batch = db.scalars(
                select(Invoice)
                .where(Invoice.invoice_status.in_(["open", "overdue"]))
                .order_by(Invoice.invoice_id).offset(offset).limit(page_size)
            ).all()
            if not batch:
                break
            offset += len(batch)
            for invoice in batch:
                job = db.get(ScoringJob, job_id)
                try:
                    if invoice.payment_date is not None:
                        reason = "Invoice has a payment date but is marked open or overdue; resolve the payment status before scoring"
                        source_fingerprint = hashlib.sha256(f"{invoice.invoice_id}|{invoice.invoice_status}|{invoice.payment_date}|{late_state.get('version')}|{delay_state.get('version')}".encode("utf-8")).hexdigest()
                        _record_score_state(db, invoice, "ineligible", reason, source_fingerprint, late_state, delay_state)
                        _append_job_result(job, "skippedInvoices", {"invoiceId": invoice.invoice_id, "reason": reason})
                        job.skipped += 1
                        job.processed += 1
                        continue
                    source_snapshot = {
                        "invoiceId": invoice.invoice_id,
                        "amount": str(invoice.invoice_amount), "currency": invoice.invoice_currency,
                        "invoiceDate": str(invoice.invoice_date), "dueDate": str(invoice.due_date),
                        "paymentTerms": invoice.payment_terms, "status": invoice.invoice_status,
                        "lateModel": late_state.get("version"), "delayModel": delay_state.get("version"),
                        "run": run_nonce,
                    }
                    source_fingerprint = hashlib.sha256(json.dumps(source_snapshot, sort_keys=True).encode("utf-8")).hexdigest()
                    required = {
                        "invoice_amount": invoice.invoice_amount,
                        "invoice_currency": invoice.invoice_currency,
                        "invoice_date": invoice.invoice_date,
                        "due_date": invoice.due_date,
                        "payment_terms": invoice.payment_terms,
                    }
                    missing = [key for key, value in required.items() if value is None or (isinstance(value, str) and not value.strip())]
                    if invoice.invoice_amount is not None and float(invoice.invoice_amount) <= 0:
                        missing.append("invoice_amount must be positive")
                    if missing:
                        reason = "Missing or invalid required model features: " + ", ".join(missing)
                        prior_state = db.get(InvoiceScoringState, invoice.invoice_id)
                        if prior_state and prior_state.status == "ineligible" and prior_state.input_fingerprint == source_fingerprint and not rescore:
                            reason = prior_state.reason or reason
                        else:
                            _record_score_state(db, invoice, "ineligible", reason, source_fingerprint, late_state, delay_state)
                        _append_job_result(job, "skippedInvoices", {"invoiceId": invoice.invoice_id, "reason": reason})
                        job.skipped += 1
                        job.processed += 1
                        continue

                    previous_state = db.get(InvoiceScoringState, invoice.invoice_id)
                    if previous_state and previous_state.status == "ineligible" and previous_state.input_fingerprint == source_fingerprint and not rescore:
                        _append_job_result(job, "skippedInvoices", {"invoiceId": invoice.invoice_id, "reason": previous_state.reason or "Previously marked ineligible"})
                        job.skipped += 1
                        job.processed += 1
                        continue

                    invoice_data = {
                        "id": invoice.invoice_id, "amount": float(invoice.invoice_amount),
                        "currency": invoice.invoice_currency, "invoiceDate": invoice.invoice_date.isoformat(),
                        "dueDate": invoice.due_date.isoformat(), "paymentTerms": invoice.payment_terms,
                    }
                    previous = _prior_paid_invoices_as_of(db, invoice)
                    late_history = _history_features_as_of(invoice, previous, "late-payment")
                    delay_history = _history_features_as_of(invoice, previous, "payment-delay")
                    fingerprint_data = {
                        "source": source_fingerprint,
                        "invoice": invoice_data,
                        "lateHistory": late_history,
                        "delayHistory": delay_history,
                        "lateModel": late_state.get("version"),
                        "delayModel": delay_state.get("version"),
                        "run": run_nonce,
                    }
                    serialized = json.dumps(fingerprint_data, sort_keys=True, default=str, allow_nan=True)
                    fingerprint = hashlib.sha256(serialized.encode("utf-8")).hexdigest()

                    late_existing = db.scalar(select(Prediction).where(
                        Prediction.invoice_id == invoice.invoice_id,
                        Prediction.prediction_type == "late-payment",
                        Prediction.model_version == str(late_state.get("version")),
                        Prediction.input_fingerprint == fingerprint,
                    ))
                    delay_existing = db.scalar(select(Prediction).where(
                        Prediction.invoice_id == invoice.invoice_id,
                        Prediction.prediction_type == "payment-delay",
                        Prediction.model_version == str(delay_state.get("version")),
                        Prediction.input_fingerprint == fingerprint,
                    ))
                    if late_existing and delay_existing and not rescore:
                        _record_score_state(db, invoice, "scored", None, fingerprint, late_state, delay_state)
                        _append_job_result(job, "skippedInvoices", {"invoiceId": invoice.invoice_id, "reason": "Predictions are current for this data and model version"})
                        job.skipped += 1
                        job.processed += 1
                        continue


                    late_result = None if late_existing else late_inference(late_state, invoice_data, late_history)
                    delay_result = None if delay_existing else delay_inference(delay_state, invoice_data, delay_history)
                    late_output = late_result or ({
                        "probability": float(late_existing.probability),
                        "predictedLate": bool((late_existing.details or {}).get("predictedLate")),
                        "riskBand": late_existing.risk_band,
                        "modelVersion": late_existing.model_version,
                        "predictedAt": late_existing.predicted_at.isoformat(),
                    } if late_existing else None)
                    delay_output = delay_result or ({
                        "predictedDelayDays": float(delay_existing.predicted_value),
                        "modelVersion": delay_existing.model_version,
                        "predictedAt": delay_existing.predicted_at.isoformat(),
                    } if delay_existing else None)
                    if late_result:
                        db.add(Prediction(
                            id=str(uuid4()), invoice_id=invoice.invoice_id, customer_id=invoice.customer_id,
                            prediction_type="late-payment", predicted_value=late_result["probability"],
                            probability=late_result["probability"], risk_band=late_result["riskBand"],
                            model_version=late_result["modelVersion"], input_fingerprint=fingerprint,
                            predicted_at=datetime.fromisoformat(late_result["predictedAt"].replace("Z", "+00:00")),
                            details={"threshold": late_result["threshold"], "predictedLate": late_result["predictedLate"]},
                        ))
                    if delay_result:
                        db.add(Prediction(
                            id=str(uuid4()), invoice_id=invoice.invoice_id, customer_id=invoice.customer_id,
                            prediction_type="payment-delay", predicted_value=delay_result["predictedDelayDays"],
                            model_version=delay_result["modelVersion"], input_fingerprint=fingerprint,
                            predicted_at=datetime.fromisoformat(delay_result["predictedAt"].replace("Z", "+00:00")),
                        ))
                    _record_score_state(db, invoice, "scored", None, fingerprint, late_state, delay_state)
                    _append_job_result(job, "successful", {
                        "invoiceId": invoice.invoice_id,
                        "probability": late_output["probability"] if late_output else None,
                        "predictedLate": late_output["predictedLate"] if late_output else None,
                        "riskBand": late_output["riskBand"] if late_output else None,
                        "predictedDelayDays": delay_output["predictedDelayDays"] if delay_output else None,
                        "lateModelVersion": late_output["modelVersion"] if late_output else late_state.get("version"),
                        "delayModelVersion": delay_output["modelVersion"] if delay_output else delay_state.get("version"),
                        "predictedAt": (late_output or delay_output)["predictedAt"],
                    })
                    job.succeeded += 1
                    job.processed += 1
                except HTTPException as exc:
                    if exc.status_code == 422:
                        reason = str(exc.detail)
                        _record_score_state(db, invoice, "ineligible", reason, source_fingerprint, late_state, delay_state)
                        _append_job_result(job, "skippedInvoices", {"invoiceId": invoice.invoice_id, "reason": reason})
                        job.skipped += 1
                    else:
                        _append_job_result(job, "failures", {"invoiceId": invoice.invoice_id, "reason": str(exc.detail)})
                        job.failed += 1
                    job.processed += 1
                except Exception as exc:
                    LOGGER.exception("Bulk invoice scoring failed for %s", invoice.invoice_id)
                    _append_job_result(job, "failures", {"invoiceId": invoice.invoice_id, "reason": f"Inference or persistence error ({type(exc).__name__})"})
                    job.failed += 1
                    job.processed += 1
            db.commit()
        job = db.get(ScoringJob, job_id)
        job.status = "completed" if not job.failed else "completed_with_errors"
        db.commit()
    except Exception:
        db.rollback()
        LOGGER.exception("Bulk scoring job failed (%s)", job_id)
        job = db.get(ScoringJob, job_id)
        if job:
            job.status = "failed"
            db.commit()
    finally:
        db.close()


def _record_score_state(db: Session, invoice: Invoice, status: str, reason: str | None, fingerprint: str, late_state=None, delay_state=None) -> None:
    state = db.get(InvoiceScoringState, invoice.invoice_id)
    if state is None:
        state = InvoiceScoringState(invoice_id=invoice.invoice_id, status=status, reason=reason, input_fingerprint=fingerprint)
        db.add(state)
    else:
        state.status, state.reason, state.input_fingerprint = status, reason, fingerprint
    state.late_model_version = late_state.get("version") if late_state else None
    state.delay_model_version = delay_state.get("version") if delay_state else None


def _append_job_result(job: ScoringJob, key: str, value: dict[str, Any]) -> None:
    results = dict(job.results or {})
    rows = list(results.get(key, []))
    rows.append(value)
    rows = rows[-200:] if key == "successful" else rows[:200]
    results[key] = rows
    job.results = results


def _start_scoring_job(db: Session, user: User, background_tasks: BackgroundTasks, *, rescore: bool = False) -> ScoringJob:
    job = _new_scoring_job(db, user, rescore=rescore)
    audit(db, user, "prediction.bulk-score", "scoring-job", job.id, {"total": job.total, "rescore": rescore})
    db.commit()
    background_tasks.add_task(_bulk_score_job, job.id)
    return job


@app.post("/api/v1/datasets/scoring-jobs", dependencies=[Depends(allow_roles("business_owner", "accountant"))], status_code=202)
def start_bulk_scoring(payload: BulkScoringInput, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = _start_scoring_job(db, user, background_tasks, rescore=payload.rescore)
    return _scoring_job_payload(job)


@app.get("/api/v1/datasets/scoring-jobs/{job_id}", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def get_scoring_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(ScoringJob, job_id)
    if job is None:
        raise HTTPException(404, "Scoring job not found")
    return _scoring_job_payload(job)


@app.post("/api/v1/customers/predict/segment", dependencies=[Depends(allow_roles("business_owner", "accountant"))])
def predict_segment(payload: dict[str, Any]):
    state = unavailable("clustering")
    from .ml import cluster_inference
    features = payload.get("features", payload)
    return cluster_inference(state, features)


@app.post("/api/v1/datasets/upload", dependencies=[Depends(allow_roles("business_owner"))])
async def upload_dataset(background_tasks: BackgroundTasks, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not file.filename or Path(file.filename).suffix.lower() != ".csv": raise HTTPException(400, "Upload must be a .csv file")
    content = await file.read()
    if len(content) > 25 * 1024 * 1024: raise HTTPException(413, "Maximum upload size is 25 MB")
    try:
        import io
        frame = pd.read_csv(io.BytesIO(content), dtype={"invoice_id": "string", "customer_id": "string"})
    except Exception as exc: raise HTTPException(422, f"Could not parse CSV: {exc}") from exc
    if frame.empty:
        raise HTTPException(422, "CSV contains no invoice rows; no data was imported")
    required = ["invoice_id", "customer_id", "name_customer", "invoice_amount", "invoice_date", "due_date", "invoice_currency", "cust_payment_terms", "invoice_status"]
    missing = [c for c in required if c not in frame.columns]
    if missing: raise HTTPException(422, {"message": "Required columns are missing", "missing": missing})
    issues: list[dict[str, Any]] = []
    id_missing = frame["invoice_id"].isna() | frame["invoice_id"].astype(str).str.strip().eq("")
    customer_missing = frame["customer_id"].isna() | frame["customer_id"].astype(str).str.strip().eq("")
    dupes = ~id_missing & frame["invoice_id"].duplicated(keep=False)
    amounts = pd.to_numeric(frame["invoice_amount"], errors="coerce")
    date_values: dict[str, pd.Series] = {}
    for col in ["invoice_date", "due_date"]:
        iso_format = frame[col].astype(str).str.fullmatch(r"\d{4}-\d{2}-\d{2}")
        parsed = pd.to_datetime(frame[col].where(iso_format), format="%Y-%m-%d", errors="coerce")
        date_values[col] = parsed
        for idx in frame.index[parsed.isna()][:200]: issues.append({"row": int(idx)+2, "column": col, "message": "Invalid or missing date"})
    curr = frame["invoice_currency"].astype(str).str.strip().str.upper()
    statuses = frame["invoice_status"].fillna("").astype(str).str.strip().str.lower()
    supported_statuses = {"paid", "open", "overdue"}
    status_valid = statuses.isin(supported_statuses)
    validation_date = business_today()
    validation_timestamp = pd.Timestamp(validation_date)
    names_missing = frame["name_customer"].isna() | frame["name_customer"].astype(str).str.strip().eq("")
    terms_missing = frame["cust_payment_terms"].isna() | frame["cust_payment_terms"].astype(str).str.strip().eq("")
    for mask, column, message in [(id_missing,"invoice_id","Invoice ID is required"),(customer_missing,"customer_id","Customer ID is required"),(names_missing,"name_customer","Customer name is required"),(terms_missing,"cust_payment_terms","Payment terms are required")]:
        for idx in frame.index[mask][:200]: issues.append({"row": int(idx)+2, "column": column, "message": message})
    for idx in frame.index[~curr.isin(["USD", "CAD"])][:200]: issues.append({"row": int(idx)+2, "column": "invoice_currency", "message": "Currency must be USD or CAD"})
    for idx in frame.index[~status_valid][:200]: issues.append({"row": int(idx)+2, "column": "invoice_status", "message": "Status must be paid, open, or overdue"})
    for idx in frame.index[amounts.isna() | (amounts <= 0)][:200]: issues.append({"row": int(idx)+2, "column": "invoice_amount", "message": "Amount must be a positive number"})
    for idx in frame.index[dupes][:200]: issues.append({"row": int(idx)+2, "column": "invoice_id", "message": "Duplicate invoice ID"})
    dates_invoice = date_values["invoice_date"]; dates_due = date_values["due_date"]
    for idx in frame.index[(dates_due < dates_invoice).fillna(False)][:200]: issues.append({"row": int(idx)+2, "column": "due_date", "message": "Due date precedes invoice date"})
    payment_raw = frame.get("payment_date", pd.Series("", index=frame.index, dtype="string"))
    payment_text = payment_raw.fillna("").astype(str).str.strip()
    payment_present = payment_text.ne("")
    payment_iso = payment_text.str.fullmatch(r"\d{4}-\d{2}-\d{2}")
    dates_payment = pd.to_datetime(payment_text.where(payment_iso), format="%Y-%m-%d", errors="coerce")
    invalid_payment = payment_present & dates_payment.isna()
    before_invoice = payment_present & dates_payment.notna() & (dates_payment < dates_invoice)
    future_payment = payment_present & dates_payment.notna() & (dates_payment > validation_timestamp)
    paid_missing_payment = statuses.eq("paid") & ~payment_present
    unpaid_has_payment = statuses.isin(["open", "overdue"]) & payment_present
    overdue_not_due = statuses.eq("overdue") & dates_due.notna() & (dates_due >= validation_timestamp)
    for idx in frame.index[invalid_payment][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Invalid payment date; expected YYYY-MM-DD"})
    for idx in frame.index[before_invoice][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Payment date precedes invoice date"})
    for idx in frame.index[future_payment][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": f"Payment date is after the business validation date ({validation_date.isoformat()})"})
    for idx in frame.index[paid_missing_payment][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Paid invoices require a valid payment date"})
    for idx in frame.index[unpaid_has_payment][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Open and overdue invoices must not have a payment date"})
    for idx in frame.index[overdue_not_due][:200]: issues.append({"row": int(idx)+2, "column": "due_date", "message": f"Overdue invoices must have a due date earlier than the business validation date ({validation_date.isoformat()})"})
    invalid_mask = id_missing | customer_missing | names_missing | terms_missing | dupes | amounts.isna() | (amounts <= 0) | dates_invoice.isna() | dates_due.isna() | (dates_due < dates_invoice).fillna(False) | ~curr.isin(["USD", "CAD"]) | ~status_valid | invalid_payment | before_invoice | future_payment | paid_missing_payment | unpaid_has_payment | overdue_not_due
    if "delay_days" in frame.columns:
        delay_values = pd.to_numeric(frame["delay_days"], errors="coerce")
        delay_present = frame["delay_days"].notna() & frame["delay_days"].astype(str).str.strip().ne("")
        invalid_delay = delay_present & delay_values.isna()
        unpaid_delay = statuses.isin(["open", "overdue"]) & delay_present
        for idx in frame.index[invalid_delay][:200]: issues.append({"row": int(idx)+2, "column": "delay_days", "message": "Delay must be numeric when supplied"})
        for idx in frame.index[unpaid_delay][:200]: issues.append({"row": int(idx)+2, "column": "delay_days", "message": "Unpaid invoices must not supply derived delay_days"})
        invalid_mask |= invalid_delay | unpaid_delay
    if "is_late" in frame.columns:
        late_values = frame["is_late"].astype(str).str.strip().str.lower()
        late_present = frame["is_late"].notna() & late_values.ne("")
        invalid_late = late_present & ~late_values.isin(["0", "1", "0.0", "1.0", "true", "false"])
        unpaid_late = statuses.isin(["open", "overdue"]) & late_present
        for idx in frame.index[invalid_late][:200]: issues.append({"row": int(idx)+2, "column": "is_late", "message": "is_late must be a boolean or 0/1 when supplied"})
        for idx in frame.index[unpaid_late][:200]: issues.append({"row": int(idx)+2, "column": "is_late", "message": "Unpaid invoices must not supply derived is_late"})
        invalid_mask |= invalid_late | unpaid_late
    # Reject IDs already present in the database so a repeat upload cannot silently
    # replace customer financial records or create ambiguous prediction history.
    invoice_ids = [str(value).strip() for value in frame.loc[~id_missing, "invoice_id"]]
    existing_ids = set(db.scalars(select(Invoice.invoice_id).where(Invoice.invoice_id.in_(invoice_ids))).all()) if invoice_ids else set()
    existing_mask = frame["invoice_id"].astype(str).str.strip().isin(existing_ids)
    for idx in frame.index[existing_mask][:200]: issues.append({"row": int(idx)+2, "column": "invoice_id", "message": "Invoice ID already exists"})
    invalid_mask |= existing_mask
    valid_rows = len(frame) - int(invalid_mask.sum())
    if issues:
        existing_count = int(existing_mask.sum())
        other_invalid_count = int((invalid_mask & ~existing_mask).sum())
        if existing_count and not other_invalid_count:
            message = f"Upload rejected: {existing_count} invoice IDs already exist. No rows were imported; repeated invoice IDs are not overwritten."
        else:
            message = f"CSV validation failed for {int(invalid_mask.sum())} rows; no rows were imported."
            if existing_count:
                message += f" {existing_count} invoice IDs already exist."
        raise HTTPException(422, {"message": message, "totalRows": len(frame), "validRows": valid_rows, "invalidRows": int(invalid_mask.sum()), "rejectedRows": int(invalid_mask.sum()), "duplicateRows": int(dupes.sum()), "existingInvoiceRows": existing_count, "issues": issues})
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid4().hex}_{Path(file.filename).name}"
    (UPLOAD_DIR / safe_name).write_bytes(content)
    created_customer_ids: set[str] = set()
    reused_customer_ids: set[str] = set()
    try:
        customer_cache: dict[str, Customer] = {}
        for idx, row in frame.loc[~invalid_mask].iterrows():
            customer_id = str(row["customer_id"]).strip()
            customer = customer_cache.get(customer_id)
            if customer is None:
                customer = db.get(Customer, customer_id)
                if customer is None:
                    customer = Customer(customer_id=customer_id, customer_name=str(row["name_customer"]).strip())
                    db.add(customer)
                    created_customer_ids.add(customer_id)
                else:
                    reused_customer_ids.add(customer_id)
                    if not customer.customer_name:
                        customer.customer_name = str(row["name_customer"]).strip()
            customer_cache[customer_id] = customer
            invoice_day = dates_invoice.loc[idx].date()
            due_day = dates_due.loc[idx].date()
            payment_day = dates_payment.loc[idx].date() if statuses.loc[idx] == "paid" else None
            delay_days = (payment_day - due_day).days if payment_day is not None else None
            invoice = Invoice(
                invoice_id=str(row["invoice_id"]).strip(), customer_id=customer_id,
                invoice_amount=float(amounts.loc[idx]), invoice_currency=str(curr.loc[idx]),
                invoice_date=invoice_day, due_date=due_day, payment_date=payment_day,
                delay_days=delay_days,
                is_late=(delay_days > 0) if delay_days is not None else None,
                invoice_status=str(statuses.loc[idx]), payment_terms=str(row["cust_payment_terms"]).strip(),
            )
            db.add(invoice)
        db.add(DatasetUpload(id=uuid4().hex, filename=Path(file.filename).name, storage_path=str(UPLOAD_DIR / safe_name), total_rows=len(frame), valid_rows=valid_rows, uploaded_by=user.id))
        audit(db, user, "dataset.upload", "dataset", safe_name, {"rows": len(frame), "validRows": valid_rows})
        db.commit()
    except Exception:
        db.rollback()
        (UPLOAD_DIR / safe_name).unlink(missing_ok=True)
        raise
    scoring_job = None
    scoring_queue_error = None
    try:
        scoring_job = _start_scoring_job(db, user, background_tasks)
    except Exception:
        db.rollback()
        scoring_queue_error = "Invoices were imported, but automatic scoring could not be queued. Start a bulk scoring run from Data Management."
        LOGGER.exception("Invoice upload %s committed, but automatic scoring job creation failed", safe_name)
    return {
        "fileName": file.filename, "sizeKb": round(len(content)/1024, 2),
        "totalRows": len(frame), "validRows": valid_rows, "invalidRows": 0,
        "rejectedRows": 0, "duplicateRows": int(dupes.sum()),
        "importedInvoices": valid_rows, "importedCustomers": len(created_customer_ids) + len(reused_customer_ids),
        "customersCreated": len(created_customer_ids), "customersReused": len(reused_customer_ids),
        "missingValues": [{"column": str(c), "missing": int(n)} for c,n in frame.isna().sum().items() if n],
        "issues": issues, "headers": list(frame.columns),
        "preview": frame.head(10).fillna("").astype(str).to_dict(orient="records"),
        "validationDate": validation_date.isoformat(), "validatedAt": datetime.now(timezone.utc).isoformat(),
        "uploadStatus": "imported", "scoringStatus": "queued" if scoring_job else "queue_failed",
        "scoringJob": _scoring_job_payload(scoring_job) if scoring_job else None,
        "scoringError": scoring_queue_error,
    }
