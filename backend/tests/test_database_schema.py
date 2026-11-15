from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.db_models import (
    CashFlowForecastPoint,
    CashFlowForecastRun,
    Customer,
    Invoice,
    Prediction,
    User,
)

def test_schema_creates_persistence_tables_and_constraints():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    assert {"users", "customers", "invoices", "predictions", "customer_segments", "dataset_uploads", "model_registry", "model_evaluations", "audit_logs", "refresh_tokens"}.issubset(Base.metadata.tables)
    with Session(engine) as session:
        customer = Customer(customer_id="C1", customer_name="Example")
        session.add(customer)
        session.flush()
        session.add(Invoice(invoice_id="I1", customer_id="C1", invoice_amount=12.5, invoice_currency="CAD", invoice_status="open"))
        session.commit()
        assert session.get(Invoice, "I1").invoice_currency == "CAD"
    engine.dispose()


def test_cash_flow_forecast_tables_are_independent_of_invoice_predictions():
    """Model 4 persists its own run/point series; it must not reuse predictions."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    assert {
        "cash_flow_forecast_runs",
        "cash_flow_forecast_points",
    }.issubset(Base.metadata.tables)

    with Session(engine) as session:
        run = CashFlowForecastRun(
            id="run-1",
            as_of=__import__("datetime").date(2020, 3, 8),
            horizon_days=7,
            currency="USD",
            model_id="cash-flow-usd",
            model_version="1.0.0",
            status="generated",
            metrics_json={"predicted": 1.0},
        )
        session.add(run)
        session.flush()
        session.add(
            CashFlowForecastPoint(
                run_id="run-1",
                granularity="weekly",
                point_date=__import__("datetime").date(2020, 3, 9),
                predicted=1.0,
                lower=0.5,
                upper=1.5,
            )
        )
        session.commit()
        stored = session.get(CashFlowForecastRun, "run-1")
        assert stored.currency == "USD"
        assert len(stored.points) == 1
        # Invoice-scoped predictions stay untouched and separate.
        assert session.query(Prediction).count() == 0
    engine.dispose()
