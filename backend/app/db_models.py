from __future__ import annotations

from datetime import date, datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

def utcnow(): return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="accountant")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class Customer(Base):
    __tablename__ = "customers"
    customer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    customer_name: Mapped[str | None] = mapped_column(String(255))
    cluster_id: Mapped[int | None] = mapped_column(Integer)

class Invoice(Base):
    __tablename__ = "invoices"
    invoice_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.customer_id", ondelete="RESTRICT"), nullable=False, index=True)
    invoice_amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    invoice_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    invoice_date: Mapped[datetime | None] = mapped_column(Date)
    due_date: Mapped[datetime | None] = mapped_column(Date)
    payment_date: Mapped[datetime | None] = mapped_column(Date)
    delay_days: Mapped[float | None] = mapped_column(Numeric(12, 4))
    is_late: Mapped[bool | None] = mapped_column(Boolean)
    invoice_status: Mapped[str | None] = mapped_column(String(20))
    payment_terms: Mapped[str | None] = mapped_column(String(64))
    __table_args__ = (
        CheckConstraint("invoice_amount > 0", name="ck_invoices_positive_amount"),
        CheckConstraint("invoice_currency IN ('USD', 'CAD')", name="ck_invoices_currency"),
        CheckConstraint("invoice_status IS NULL OR invoice_status IN ('paid', 'open', 'overdue')", name="ck_invoices_status"),
        Index("ix_invoices_status_due", "invoice_status", "due_date"),
        Index("ix_invoices_currency_date", "invoice_currency", "invoice_date"),
    )

class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.invoice_id", ondelete="SET NULL"), index=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.customer_id", ondelete="SET NULL"), index=True)
    prediction_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    predicted_value: Mapped[float | None] = mapped_column(Numeric(16, 6))
    probability: Mapped[float | None] = mapped_column(Numeric(8, 7))
    risk_band: Mapped[str | None] = mapped_column(String(16))
    model_version: Mapped[str | None] = mapped_column(String(96))
    input_fingerprint: Mapped[str | None] = mapped_column(String(64))
    predicted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    details: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (
        CheckConstraint("probability IS NULL OR (probability >= 0 AND probability <= 1)", name="ck_predictions_probability_range"),
        Index("ix_predictions_invoice_type_date", "invoice_id", "prediction_type", "predicted_at"),
        UniqueConstraint("invoice_id", "prediction_type", "model_version", "input_fingerprint", name="uq_prediction_invoice_model_input"),
    )

class InvoiceScoringState(Base):
    __tablename__ = "invoice_scoring_states"
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.invoice_id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    input_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    late_model_version: Mapped[str | None] = mapped_column(String(96))
    delay_model_version: Mapped[str | None] = mapped_column(String(96))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

class ScoringJob(Base):
    __tablename__ = "scoring_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    succeeded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    results: Mapped[dict | None] = mapped_column(JSON)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

class CustomerSegment(Base):
    __tablename__ = "customer_segments"
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.customer_id", ondelete="CASCADE"), primary_key=True)
    cluster_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    model_version: Mapped[str | None] = mapped_column(String(96))
    features: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

class DatasetUpload(Base):
    __tablename__ = "dataset_uploads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

class ModelRegistry(Base):
    __tablename__ = "model_registry"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    algorithm: Mapped[str] = mapped_column(String(96), nullable=False)
    version: Mapped[str | None] = mapped_column(String(96))
    artifact_path: Mapped[str] = mapped_column(Text, nullable=False)
    preprocessing_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON)

class ModelEvaluation(Base):
    __tablename__ = "model_evaluations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("model_registry.id", ondelete="CASCADE"), index=True)
    metric_name: Mapped[str] = mapped_column(String(64), nullable=False)
    metric_value: Mapped[float] = mapped_column(Numeric(16, 8), nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

class AuditEvent(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(96), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(128))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    details: Mapped[dict | None] = mapped_column(JSON)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by: Mapped[str | None] = mapped_column(String(36))
    user: Mapped[User] = relationship(back_populates="refresh_tokens")

class CashFlowForecastRun(Base):
    """One persisted generation of an aggregate cash-flow forecast.

    Deliberately separate from ``Predictions``: that table is invoice-scoped
    (one probability/risk band per invoice) and cannot hold a date series.
    """
    __tablename__ = "cash_flow_forecast_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    as_of: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    horizon_days: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, index=True)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(96))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="generated")
    metrics_json: Mapped[dict | None] = mapped_column(JSON)
    assumptions_json: Mapped[dict | None] = mapped_column(JSON)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    points: Mapped[list["CashFlowForecastPoint"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    __table_args__ = (
        CheckConstraint("horizon_days IN (7, 30, 90)", name="ck_cash_flow_runs_horizon"),
        CheckConstraint("currency IN ('USD', 'CAD')", name="ck_cash_flow_runs_currency"),
        Index("ix_cash_flow_runs_currency_asof_horizon", "currency", "as_of", "horizon_days"),
    )

class CashFlowForecastPoint(Base):
    """A single weekly or daily point belonging to a persisted forecast run."""
    __tablename__ = "cash_flow_forecast_points"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("cash_flow_forecast_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    granularity: Mapped[str] = mapped_column(String(8), nullable=False)
    point_date: Mapped[date] = mapped_column(Date, nullable=False)
    predicted: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    lower: Mapped[float | None] = mapped_column(Numeric(16, 2))
    upper: Mapped[float | None] = mapped_column(Numeric(16, 2))
    run: Mapped[CashFlowForecastRun] = relationship(back_populates="points")
    __table_args__ = (
        CheckConstraint("granularity IN ('weekly', 'daily')", name="ck_cash_flow_points_granularity"),
        CheckConstraint("lower IS NULL OR upper IS NULL OR lower <= predicted", name="ck_cash_flow_points_lower"),
        CheckConstraint("lower IS NULL OR upper IS NULL OR predicted <= upper", name="ck_cash_flow_points_upper"),
        Index("ix_cash_flow_points_run_date", "run_id", "point_date"),
    )
