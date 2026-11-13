from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.db_models import Customer, Invoice, Prediction, User

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
