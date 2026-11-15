"""API tests for Model 4 routes: availability gating, validation, roles, audit.

The core three-model health gate must never be affected by forecasting
readiness. These tests assert that explicitly rather than relaxing any existing
assertion in ``test_model_startup.py``.
"""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import forecasting, main
from app.database import Base
from app.db_models import AuditEvent, CashFlowForecastPoint, CashFlowForecastRun, User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        session.add(User(id=1, name="Admin", email="admin@example.com", password_hash="x", role="admin", is_active=True))
        session.add(User(id=2, name="Accountant", email="acc@example.com", password_hash="x", role="accountant", is_active=True))
        session.commit()
        yield session
    engine.dispose()


@pytest.fixture
def client(db_session):
    def _get_db():
        return db_session

    users = {
        1: db_session.get(User, 1),
        2: db_session.get(User, 2),
    }

    test_client = TestClient(main.app)
    test_client.acting_user = 1

    def _current_user(credentials=None):
        # Tests choose the acting user by setting ``client.acting_user``.
        return users[test_client.acting_user]

    main.app.dependency_overrides[main.get_db] = _get_db
    main.app.dependency_overrides[main.current_user] = _current_user
    try:
        yield test_client
    finally:
        main.app.dependency_overrides.pop(main.get_db, None)
        main.app.dependency_overrides.pop(main.current_user, None)


@pytest.fixture
def forecast_loaded(monkeypatch):
    artifact = _artifact()
    monkeypatch.setitem(forecasting._FORECAST_MODELS, "USD", artifact)
    monkeypatch.setitem(forecasting._FORECAST_MODELS, "CAD", {**artifact, "currency": "CAD"})
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "USD", {"available": True, "algorithm": artifact["algorithm"]})
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "CAD", {"available": True, "algorithm": artifact["algorithm"]})
    return artifact


def _artifact() -> dict:
    starts = [str(dt.date(2020, 2, 24) + dt.timedelta(days=7 * i)) for i in range(4)]
    return {
        "algorithm": "xgboost_daily",
        "currency": "USD",
        "version": "1.0.0",
        "trained_through": "2020-03-08",
        "frequency": "W-MON",
        "history_week_starts": starts,
        "history_values": [1000.0, 1100.0, 1200.0, 1300.0],
        "weekday_shares": {str(i): v for i, v in enumerate([0.2, 0.2, 0.2, 0.15, 0.2, 0.05, 0.0])},
        "replay": {"2020-03-08": [1300.0 + 50 * k for k in range(13)]},
        "replay_steps": 13,
        "interval_quantiles": {str(k): {"p10": -100.0, "p90": 100.0} for k in range(1, 14)},
        "selection": {"reason": "test fixture"},
    }


# ---------------------------------------------------------------------------
# Independent health gate
# ---------------------------------------------------------------------------
def test_cash_flow_health_reports_503_when_artifacts_missing(monkeypatch):
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "USD", {"available": False, "error": "missing"})
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "CAD", {"available": False, "error": "missing"})
    response = TestClient(main.app).get("/api/v1/cash-flow/health")
    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "unavailable"
    assert {model["currency"] for model in payload["models"]} == {"USD", "CAD"}


def test_cash_flow_health_reports_200_when_available(forecast_loaded):
    response = TestClient(main.app).get("/api/v1/cash-flow/health")
    assert response.status_code == 200
    assert response.json()["status"] == "available"


def test_cash_flow_health_reports_partial_when_one_currency_is_missing(monkeypatch):
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "USD", {"available": False, "error": "missing"})
    monkeypatch.setitem(
        forecasting.FORECAST_STATUS, "CAD", {"available": True, "algorithm": "arima", "version": "1.0.0"}
    )
    response = TestClient(main.app).get("/api/v1/cash-flow/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "partial"
    assert {m["currency"]: m["available"] for m in payload["models"]} == {"USD": False, "CAD": True}


def test_missing_forecast_artifact_does_not_degrade_core_health(monkeypatch):
    """The three-model gate must stay green even with no forecasting artifact."""
    monkeypatch.setattr(
        main,
        "MODEL_STATUS",
        {key: {"status": "available", "version": "verified"} for key in main.MODEL_IDS},
    )
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "USD", {"available": False, "error": "missing joblib"})
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "CAD", {"available": False, "error": "missing joblib"})

    class AvailableDatabase:
        def execute(self, _statement):
            return None

    previous = main.app.dependency_overrides.get(main.get_db)
    main.app.dependency_overrides[main.get_db] = lambda: AvailableDatabase()
    try:
        response = TestClient(main.app).get("/api/v1/health")
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_db, None)
        else:
            main.app.dependency_overrides[main.get_db] = previous

    assert response.status_code == 200
    assert set(main.MODEL_IDS) == {m["id"] for m in response.json()["models"]}
    assert "cash-flow" not in {m["id"] for m in response.json()["models"]}


# ---------------------------------------------------------------------------
# Forecast endpoint
# ---------------------------------------------------------------------------
def test_forecast_returns_series_and_metadata(client, forecast_loaded):
    response = client.get("/api/v1/cash-flow/forecast", params={"currency": "USD", "horizon": 30})
    assert response.status_code == 200
    body = response.json()
    assert body["frequency"] == "weekly"
    assert body["horizonDays"] == 30
    assert len(body["daily"]) == 30
    assert body["totals"]["lower"] <= body["totals"]["predicted"] <= body["totals"]["upper"]
    assert body["proxy"]["payment_proxy"] is True
    assert "proxy" in body["disclaimer"].lower()


def test_forecast_rejects_unknown_currency(client, forecast_loaded):
    response = client.get("/api/v1/cash-flow/forecast", params={"currency": "EUR", "horizon": 7})
    assert response.status_code == 422


def test_forecast_rejects_unsupported_horizon(client, forecast_loaded):
    response = client.get("/api/v1/cash-flow/forecast", params={"currency": "USD", "horizon": 14})
    assert response.status_code == 422


def test_forecast_returns_503_when_model_unavailable(client, monkeypatch):
    monkeypatch.setitem(forecasting.FORECAST_STATUS, "USD", {"available": False, "error": "missing"})
    monkeypatch.delitem(forecasting._FORECAST_MODELS, "USD", raising=False)
    response = client.get("/api/v1/cash-flow/forecast", params={"currency": "USD", "horizon": 7})
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"].lower()


def test_get_forecast_is_pure_and_persists_nothing(client, forecast_loaded, db_session):
    before = db_session.scalar(select(CashFlowForecastRun).limit(1))
    client.get("/api/v1/cash-flow/forecast", params={"currency": "USD", "horizon": 7})
    after = db_session.scalar(select(CashFlowForecastRun).limit(1))
    assert before is None and after is None


# ---------------------------------------------------------------------------
# Persisted runs
# ---------------------------------------------------------------------------
def test_accountant_cannot_create_run(client, forecast_loaded):
    client.acting_user = 2  # accountant
    response = client.post("/api/v1/cash-flow/runs", json={"currency": "USD", "horizon": 7})
    assert response.status_code == 403


def test_admin_can_create_run_and_audit_is_written(client, forecast_loaded, db_session):
    client.acting_user = 1  # admin
    response = client.post("/api/v1/cash-flow/runs", json={"currency": "USD", "horizon": 30})
    assert response.status_code == 200
    body = response.json()
    run_id = body["runId"]
    assert body["forecast"]["horizonDays"] == 30

    run = db_session.get(CashFlowForecastRun, run_id)
    assert run is not None
    assert run.currency == "USD"
    assert run.horizon_days == 30
    assert run.created_by == 1

    points = db_session.scalars(
        select(CashFlowForecastPoint).where(CashFlowForecastPoint.run_id == run_id)
    ).all()
    weekly = [p for p in points if p.granularity == "weekly"]
    daily = [p for p in points if p.granularity == "daily"]
    assert daily and len(daily) == 30
    assert weekly

    audit_rows = db_session.scalars(
        select(AuditEvent).where(AuditEvent.action == "prediction.cash-flow")
    ).all()
    assert len(audit_rows) == 1
    assert audit_rows[0].entity_id == run_id


def test_runs_list_reflects_persisted_run(client, forecast_loaded):
    client.acting_user = 1
    created = client.post("/api/v1/cash-flow/runs", json={"currency": "CAD", "horizon": 7})
    assert created.status_code == 200
    listing = client.get("/api/v1/cash-flow/runs", params={"currency": "CAD"})
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert any(item["runId"] == created.json()["runId"] for item in items)
    assert all(item["currency"] == "CAD" for item in items)
