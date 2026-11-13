from __future__ import annotations

import json
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

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from sqlalchemy import select, func, text, or_
from sqlalchemy.orm import Session

from .auth import audit, hash_password, issue_pair, verify_password, current_user, allow_roles, ROLES
from .database import Base, engine, get_db, SessionLocal
from .db_models import User, RefreshToken, Prediction, Customer, Invoice, CustomerSegment, DatasetUpload, ModelRegistry

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
INVOICES: list[dict[str, Any]] = []
CUSTOMERS: list[dict[str, Any]] = []


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
            version = meta.get("dataset_version") or meta.get("training_date") or f"KMeans-K{meta.get('number_of_clusters', 6)}"
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
    if os.getenv("APP_ENV", "development").lower() != "production":
        Base.metadata.create_all(bind=engine)
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


def seed_database() -> None:
    """Import the immutable cleaned source into an empty DB; never retrain/change it."""
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Invoice)):
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
        for r in frame[["invoice_id", "customer_id", "invoice_amount", "invoice_currency", "invoice_date", "due_date", "payment_date", "delay_days", "is_late", "invoice_status"]].itertuples(index=False, name=None):
            invoice_id, customer_id, amount, currency, inv_date, due, paid, delay_days, late, status = r
            records.append({"invoice_id": invoice_id, "customer_id": customer_id, "invoice_amount": float(amount), "invoice_currency": str(currency), "invoice_date": inv_date, "due_date": due, "payment_date": paid, "delay_days": None if pd.isna(delay_days) else float(delay_days), "is_late": None if pd.isna(late) else bool(int(late)), "invoice_status": None if pd.isna(status) else str(status)})
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
    count = db.scalar(select(User.id).limit(1))
    bootstrap = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    role = "admin" if count is None and bootstrap and email == bootstrap else "accountant"
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
            **({"error": MODEL_STATUS[key]["error"]} if MODEL_STATUS.get(key, {}).get("error") else {}),
        }
        for key in MODEL_IDS
    ]
    status_value = "ok" if models_ready and database["status"] == "available" else "degraded"
    payload = {"status": status_value, "mode": "live", "apiVersion": "v1", "database": database, "models": models, "timestamp": datetime.now(timezone.utc).isoformat()}
    return payload if status_value == "ok" else JSONResponse(status_code=503, content=payload)


@app.get("/api/v1/dashboard/summary", dependencies=[Depends(allow_roles(*ROLES))])
def dashboard(): return load_json("dashboard")


@app.get("/api/v1/invoices", dependencies=[Depends(allow_roles(*ROLES))])
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


@app.get("/api/v1/invoices/{invoice_id}", dependencies=[Depends(allow_roles(*ROLES))])
def invoice_detail(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None: raise HTTPException(404, "Invoice not found")
    customer_db = db.get(Customer, invoice.customer_id)
    late_probability = _latest_prediction_value(Prediction.probability, "late-payment")
    late_band = _latest_prediction_value(Prediction.risk_band, "late-payment")
    predicted_delay = _latest_prediction_value(Prediction.predicted_value, "payment-delay")
    current = db.execute(select(Invoice, Customer, late_probability, late_band, predicted_delay).join(Customer).where(Invoice.invoice_id == invoice_id)).one()
    invoice_data = _invoice_record(current)
    customer = next((c for c in CUSTOMERS if c.get("id") == invoice.customer_id), None)
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
    seg = load_json("segments")
    cluster_id = customer_db.cluster_id
    cluster = next((x for x in seg.get("sizes", []) if x.get("clusterId") == cluster_id), {})
    days = (invoice.due_date - invoice.invoice_date).days if invoice.due_date and invoice.invoice_date else 0
    return {"invoice": invoice_data, "customer": customer, "clusterId": cluster_id, "cluster": cluster, "history": history, "predictionHistory": prediction_history, "context": {"previousAvgDelay": customer.get("avgPaymentDelay"), "previousLateRatio": customer.get("latePaymentRatio"), "previousInvoiceCount": customer.get("totalInvoices"), "previousMedianDelay": customer.get("medianPaymentDelay"), "hasPaymentHistory": bool(customer.get("totalInvoices")), "daysUntilDue": days}}


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


@app.get("/api/v1/customers", dependencies=[Depends(allow_roles(*ROLES))])
def list_customers(page: int = Query(1, ge=1), pageSize: int = Query(25, ge=1, le=1000), search: str | None = None, clusterId: str | None = None, sortBy: str | None = None, sortOrder: str | None = "asc", db: Session = Depends(get_db)):
    profiles = {str(c["id"]): c for c in CUSTOMERS}
    rows = [profiles.get(c.customer_id, _empty_customer(c)) for c in db.scalars(select(Customer).order_by(Customer.customer_id)).all()]
    if search: rows = [c for c in rows if search.lower() in f"{c.get('id','')} {c.get('name','')}".lower()]
    if clusterId and clusterId != "all": rows = [c for c in rows if str(c.get("clusterId")) == clusterId]
    return paginated(sort_items(rows, sortBy, sortOrder), page, pageSize)


@app.get("/api/v1/customers/segments", dependencies=[Depends(allow_roles("admin", "business_owner", "accountant"))])
def segments(): return load_json("segments")


@app.get("/api/v1/customers/{customer_id}", dependencies=[Depends(allow_roles(*ROLES))])
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
    for key, label in features:
        vals = [float(c[key]) for c in CUSTOMERS if isinstance(c.get(key), (int,float))]
        comparisons.append({"feature": key, "label": label, "customerValue": customer.get(key, 0) or 0, "clusterValue": 0, "globalMedian": float(pd.Series(vals).median()) if vals else 0})
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


@app.get("/api/v1/payment-risk/summary", dependencies=[Depends(allow_roles(*ROLES))])
def risk(): return load_json("risk")
@app.get("/api/v1/delay-predictions/summary", dependencies=[Depends(allow_roles(*ROLES))])
def delay(): return load_json("delay")
@app.get("/api/v1/models/metrics", dependencies=[Depends(allow_roles("admin", "business_owner"))])
def metrics(): return load_json("model-metrics")
@app.get("/api/v1/insights", dependencies=[Depends(allow_roles("admin", "business_owner", "accountant"))])
def insights(): return load_json("insights")
@app.get("/api/v1/datasets/quality", dependencies=[Depends(allow_roles("admin", "business_owner", "accountant"))])
def quality(): return load_json("data-quality")
@app.get("/api/v1/datasets", dependencies=[Depends(allow_roles("admin", "business_owner", "accountant"))])
def datasets(): return load_json("datasets")


@app.get("/api/v1/search", dependencies=[Depends(allow_roles(*ROLES))])
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


def risk_band(p: float) -> str: return "Low" if p < .3 else "Medium" if p < .7 else "High"


@app.post("/api/v1/invoices/predict/late-payment", dependencies=[Depends(allow_roles(*ROLES))])
def predict_late(payload: PredictionInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    state = unavailable("late-payment")
    from .ml import late_inference
    result = late_inference(state, payload.invoice, payload.customerHistory)
    raw_invoice_key = str(payload.invoice.get("id", payload.invoice.get("invoice_id", payload.invoice.get("invoiceId", ""))))
    invoice_key = raw_invoice_key if db.get(Invoice, raw_invoice_key) else _invoice_key(raw_invoice_key)
    saved_invoice = db.get(Invoice, invoice_key) if invoice_key else None
    db.add(Prediction(id=str(uuid4()), invoice_id=saved_invoice.invoice_id if saved_invoice else None, customer_id=saved_invoice.customer_id if saved_invoice else None, prediction_type="late-payment", predicted_value=result["probability"], probability=result["probability"], risk_band=result["riskBand"], model_version=result["modelVersion"], details={"threshold": result["threshold"]}))
    audit(db, user, "prediction.late-payment", "invoice", saved_invoice.invoice_id if saved_invoice else None)
    LOGGER.info("Inference completed: model=late-payment")
    db.commit()
    return result


@app.post("/api/v1/invoices/predict/payment-delay", dependencies=[Depends(allow_roles(*ROLES))])
def predict_delay(payload: PredictionInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    state = unavailable("payment-delay")
    from .ml import delay_inference
    result = delay_inference(state, payload.invoice, payload.customerHistory)
    raw_invoice_key = str(payload.invoice.get("id", payload.invoice.get("invoice_id", payload.invoice.get("invoiceId", ""))))
    invoice_key = raw_invoice_key if db.get(Invoice, raw_invoice_key) else _invoice_key(raw_invoice_key)
    saved_invoice = db.get(Invoice, invoice_key) if invoice_key else None
    db.add(Prediction(id=str(uuid4()), invoice_id=saved_invoice.invoice_id if saved_invoice else None, customer_id=saved_invoice.customer_id if saved_invoice else None, prediction_type="payment-delay", predicted_value=result["predictedDelayDays"], model_version=result["modelVersion"]))
    audit(db, user, "prediction.payment-delay", "invoice", saved_invoice.invoice_id if saved_invoice else None)
    LOGGER.info("Inference completed: model=payment-delay")
    db.commit()
    return result


@app.post("/api/v1/customers/predict/segment", dependencies=[Depends(allow_roles("admin", "business_owner", "accountant"))])
def predict_segment(payload: dict[str, Any]):
    state = unavailable("clustering")
    from .ml import cluster_inference
    features = payload.get("features", payload)
    return cluster_inference(state, features)


@app.post("/api/v1/datasets/upload", dependencies=[Depends(allow_roles("admin", "business_owner"))])
async def upload_dataset(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not file.filename or Path(file.filename).suffix.lower() != ".csv": raise HTTPException(400, "Upload must be a .csv file")
    content = await file.read()
    if len(content) > 25 * 1024 * 1024: raise HTTPException(413, "Maximum upload size is 25 MB")
    try:
        import io
        frame = pd.read_csv(io.BytesIO(content), dtype={"invoice_id": "string", "customer_id": "string"})
    except Exception as exc: raise HTTPException(422, f"Could not parse CSV: {exc}") from exc
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
    statuses = frame["invoice_status"].astype(str).str.strip().str.lower()
    names_missing = frame["name_customer"].isna() | frame["name_customer"].astype(str).str.strip().eq("")
    terms_missing = frame["cust_payment_terms"].isna() | frame["cust_payment_terms"].astype(str).str.strip().eq("")
    for mask, column, message in [(id_missing,"invoice_id","Invoice ID is required"),(customer_missing,"customer_id","Customer ID is required"),(names_missing,"name_customer","Customer name is required"),(terms_missing,"cust_payment_terms","Payment terms are required")]:
        for idx in frame.index[mask][:200]: issues.append({"row": int(idx)+2, "column": column, "message": message})
    for idx in frame.index[~curr.isin(["USD", "CAD"])][:200]: issues.append({"row": int(idx)+2, "column": "invoice_currency", "message": "Currency must be USD or CAD"})
    for idx in frame.index[~statuses.isin(["paid", "open"])][:200]: issues.append({"row": int(idx)+2, "column": "invoice_status", "message": "Status must be paid or open"})
    for idx in frame.index[amounts.isna() | (amounts <= 0)][:200]: issues.append({"row": int(idx)+2, "column": "invoice_amount", "message": "Amount must be a positive number"})
    for idx in frame.index[dupes][:200]: issues.append({"row": int(idx)+2, "column": "invoice_id", "message": "Duplicate invoice ID"})
    dates_invoice = date_values["invoice_date"]; dates_due = date_values["due_date"]
    for idx in frame.index[(dates_due < dates_invoice).fillna(False)][:200]: issues.append({"row": int(idx)+2, "column": "due_date", "message": "Due date precedes invoice date"})
    invalid_mask = id_missing | customer_missing | names_missing | terms_missing | dupes | amounts.isna() | (amounts <= 0) | dates_invoice.isna() | dates_due.isna() | (dates_due < dates_invoice).fillna(False) | ~curr.isin(["USD", "CAD"]) | ~statuses.isin(["paid", "open"])
    if "payment_date" in frame.columns:
        payment_present = frame["payment_date"].notna() & frame["payment_date"].astype(str).str.strip().ne("")
        payment_iso = frame["payment_date"].astype(str).str.fullmatch(r"\d{4}-\d{2}-\d{2}")
        dates_payment = pd.to_datetime(frame["payment_date"].where(payment_iso), format="%Y-%m-%d", errors="coerce")
        invalid_payment = payment_present & dates_payment.isna()
        before_invoice = payment_present & dates_payment.notna() & (dates_payment < dates_invoice)
        invalid_mask |= invalid_payment | before_invoice
        for idx in frame.index[invalid_payment][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Invalid payment date"})
        for idx in frame.index[before_invoice][:200]: issues.append({"row": int(idx)+2, "column": "payment_date", "message": "Payment date precedes invoice date"})
    # Reject IDs already present in the database so a repeat upload cannot silently
    # replace customer financial records or create ambiguous prediction history.
    invoice_ids = [str(value).strip() for value in frame.loc[~id_missing, "invoice_id"]]
    existing_ids = set(db.scalars(select(Invoice.invoice_id).where(Invoice.invoice_id.in_(invoice_ids))).all()) if invoice_ids else set()
    existing_mask = frame["invoice_id"].astype(str).str.strip().isin(existing_ids)
    for idx in frame.index[existing_mask][:200]: issues.append({"row": int(idx)+2, "column": "invoice_id", "message": "Invoice ID already exists"})
    invalid_mask |= existing_mask
    valid_rows = len(frame) - int(invalid_mask.sum())
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid4().hex}_{Path(file.filename).name}"
    (UPLOAD_DIR / safe_name).write_bytes(content)
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
            elif not customer.customer_name:
                customer.customer_name = str(row["name_customer"]).strip()
            customer_cache[customer_id] = customer
            invoice_day = dates_invoice.loc[idx].date()
            due_day = dates_due.loc[idx].date()
            payment_day = None
            if "payment_date" in frame.columns and pd.notna(row.get("payment_date")) and str(row.get("payment_date")).strip():
                payment_day = pd.to_datetime(row["payment_date"]).date()
            invoice = Invoice(
                invoice_id=str(row["invoice_id"]).strip(), customer_id=customer_id,
                invoice_amount=float(amounts.loc[idx]), invoice_currency=str(curr.loc[idx]),
                invoice_date=invoice_day, due_date=due_day, payment_date=payment_day,
                delay_days=(payment_day - due_day).days if payment_day else None,
                is_late=((payment_day - due_day).days > 0) if payment_day else None,
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
    return {"fileName": file.filename, "sizeKb": round(len(content)/1024, 2), "totalRows": len(frame), "validRows": valid_rows, "invalidRows": len(frame)-valid_rows, "duplicateRows": int(dupes.sum()), "missingValues": [{"column": str(c), "missing": int(n)} for c,n in frame.isna().sum().items() if n], "issues": issues, "headers": list(frame.columns), "preview": frame.head(10).fillna("").astype(str).to_dict(orient="records"), "validatedAt": datetime.now(timezone.utc).isoformat()}
