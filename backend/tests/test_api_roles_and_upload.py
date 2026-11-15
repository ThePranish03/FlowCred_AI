from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.auth import hash_password, issue_pair
from app.database import Base, get_db
from app.db_models import Invoice, User, Customer, Prediction, InvoiceScoringState, DatasetUpload


def _client_and_tokens(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)

    def override_db() -> Iterator[Session]:
        with sessions() as session:
            yield session

    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setitem(main.app.dependency_overrides, get_db, override_db)
    tokens: dict[str, str] = {}
    with sessions() as session:
        for role in ("business_owner", "accountant", "collection_user"):
            user = User(name=role, email=f"{role}@example.test", password_hash=hash_password("Test-password-123"), role=role)
            session.add(user)
            session.flush()
            tokens[role] = issue_pair(user, session)["accessToken"]
        session.commit()
    return TestClient(main.app), sessions, engine, tokens


def test_jwt_role_permissions_and_upload_validation(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    try:
        repository_root = Path(__file__).resolve().parents[2]
        monkeypatch.setattr(main, "MODEL_DIR", repository_root / "models")
        monkeypatch.setattr(main, "DATA_DIR", repository_root / "data")
        monkeypatch.setattr(main, "MODEL_STATUS", {})
        main.load_models()
        assert all(main.MODEL_STATUS[key]["status"] == "available" for key in main.MODEL_IDS)

        assert client.get("/api/v1/invoices").status_code == 401
        assert client.get("/api/v1/invoices", headers={"Authorization": f"Bearer {tokens['business_owner']}"}).status_code == 200
        assert client.get("/api/v1/invoices", headers={"Authorization": f"Bearer {tokens['accountant']}"}).status_code == 200
        assert client.get("/api/v1/invoices", headers={"Authorization": f"Bearer {tokens['collection_user']}"}).status_code == 403
        assert client.post("/api/v1/datasets/upload", files={"file": ("unauth.csv", b"", "text/csv")}).status_code == 401
        assert client.post(
            "/api/v1/datasets/upload",
            headers={"Authorization": f"Bearer {tokens['accountant']}"},
            files={"file": ("denied.csv", b"", "text/csv")},
        ).status_code == 403

        valid_csv = (
            "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status\n"
            "UPLOAD-TEST-1,CUSTOMER-TEST,Test Customer,125.50,2026-01-01,2026-01-31,USD,N30,open\n"
        )
        uploaded = client.post(
            "/api/v1/datasets/upload",
            headers={"Authorization": f"Bearer {tokens['business_owner']}"},
            files={"file": ("valid.csv", valid_csv.encode(), "text/csv")},
        )
        assert uploaded.status_code == 200, uploaded.text
        assert uploaded.json()["validRows"] == 1
        assert uploaded.json()["uploadStatus"] == "imported"
        assert uploaded.json()["importedInvoices"] == 1
        assert uploaded.json()["importedCustomers"] == 1
        assert uploaded.json()["scoringStatus"] == "queued"
        with sessions() as session:
            assert session.get(Invoice, "UPLOAD-TEST-1") is not None
            assert session.get(Customer, "CUSTOMER-TEST") is not None

        repeated = client.post(
            "/api/v1/datasets/upload",
            headers={"Authorization": f"Bearer {tokens['business_owner']}"},
            files={"file": ("valid-again.csv", valid_csv.encode(), "text/csv")},
        )
        assert repeated.status_code == 422
        duplicate_detail = repeated.json()["detail"]
        assert duplicate_detail["existingInvoiceRows"] == 1
        assert "already exist" in duplicate_detail["message"]
        with sessions() as session:
            assert session.query(Invoice).filter(Invoice.invoice_id == "UPLOAD-TEST-1").count() == 1

        invalid_csv = valid_csv.replace("UPLOAD-TEST-1", "UPLOAD-TEST-2").replace("125.50", "not-a-number")
        invalid = client.post(
            "/api/v1/datasets/upload",
            headers={"Authorization": f"Bearer {tokens['business_owner']}"},
            files={"file": ("invalid.csv", invalid_csv.encode(), "text/csv")},
        )
        assert invalid.status_code == 422
        assert "no rows were imported" in invalid.text
        with sessions() as session:
            assert session.get(Invoice, "UPLOAD-TEST-2") is None

        public_signup = client.post(
            "/api/v1/auth/register",
            json={"name": "Public User", "email": "public@example.test", "password": "Test-password-123", "role": "business_owner"},
        )
        assert public_signup.status_code == 201
        assert public_signup.json()["user"]["role"] == "accountant"

        prediction_input = {
            "invoice": {"amount": 1200.5, "currency": "USD", "invoiceDate": "2020-01-10", "dueDate": "2020-02-09", "paymentTerms": "NAA8"},
            "customerHistory": {"previousInvoiceCount": 8, "previousLateCount": 3, "previousLateRatio": 0.375, "previousAvgDelay": 4.5, "previousMedianDelay": 2, "previousAvgInvoiceAmount": 900, "previousTotalInvoiceAmount": 7200, "daysSinceLastInvoice": 18},
        }
        prediction_headers = {"Authorization": f"Bearer {tokens['accountant']}"}
        late = client.post("/api/v1/invoices/predict/late-payment", headers=prediction_headers, json=prediction_input)
        delay = client.post("/api/v1/invoices/predict/payment-delay", headers=prediction_headers, json=prediction_input)
        assert late.status_code == 200, late.text
        assert 0 <= late.json()["probability"] <= 1 and late.json()["threshold"] == 0.45
        assert late.json()["riskBand"] in {"Low", "Medium", "High"} and late.json()["modelVersion"]
        assert delay.status_code == 200, delay.text
        assert isinstance(delay.json()["predictedDelayDays"], float)
        assert delay.json()["interpretation"] in {"early", "on_time", "late"}
    finally:
        client.close()
        main.app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_supplied_500_row_upload_preserves_paid_open_and_overdue_statuses(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    try:
        repository_root = Path(__file__).resolve().parents[2]
        csv_path = repository_root / "data" / "uploads" / "flowcred_upload_demo_500.csv"
        with csv_path.open("rb") as csv_file:
            response = client.post(
                "/api/v1/datasets/upload",
                headers={"Authorization": f"Bearer {tokens['business_owner']}"},
                files={"file": (csv_path.name, csv_file, "text/csv")},
            )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["totalRows"] == result["validRows"] == 500
        assert result["invalidRows"] == result["duplicateRows"] == 0
        assert result["uploadStatus"] == "imported" and result["importedInvoices"] == 500
        assert result["importedCustomers"] == result["customersCreated"] + result["customersReused"]

        with sessions() as session:
            invoices = session.scalars(select(Invoice)).all()
            assert len(invoices) == 500
            assert session.query(Customer).count() == result["importedCustomers"]
            counts = {status: sum(invoice.invoice_status == status for invoice in invoices) for status in ("paid", "open", "overdue")}
            assert counts == {"paid": 331, "open": 82, "overdue": 87}
            paid = next(invoice for invoice in invoices if invoice.invoice_status == "paid")
            assert paid.payment_date is not None
            assert paid.delay_days == (paid.payment_date - paid.due_date).days
            assert paid.is_late is (paid.delay_days > 0)
            assert all(invoice.payment_date is None and invoice.delay_days is None and invoice.is_late is None for invoice in invoices if invoice.invoice_status in {"open", "overdue"})
            overdue = [invoice for invoice in invoices if invoice.invoice_status == "overdue"]
            assert all(invoice.due_date.isoformat() < result["validationDate"] for invoice in overdue)

        repeated = client.post(
            "/api/v1/datasets/upload",
            headers={"Authorization": f"Bearer {tokens['business_owner']}"},
            files={"file": (csv_path.name, csv_path.read_bytes(), "text/csv")},
        )
        assert repeated.status_code == 422
        assert repeated.json()["detail"]["existingInvoiceRows"] == 500
        assert "repeated invoice IDs are not overwritten" in repeated.json()["detail"]["message"]
        with sessions() as session:
            assert session.query(Invoice).count() == 500
            assert session.query(DatasetUpload).count() == 1
    finally:
        client.close()
        main.app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_status_specific_upload_rules_and_normalization(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    headers = {"Authorization": f"Bearer {tokens['business_owner']}"}
    validation_date = main.business_today()
    invoice_date = (validation_date - timedelta(days=30)).isoformat()
    past_due_date = (validation_date - timedelta(days=2)).isoformat()
    paid_date = (validation_date - timedelta(days=1)).isoformat()
    csv_header = "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status,payment_date,delay_days,is_late\n"

    def row(invoice_id, status, due_date=past_due_date, payment_date="", invoice_day=invoice_date):
        return f"{invoice_id},CUSTOMER-{invoice_id},Status Test,100.00,{invoice_day},{due_date},USD,N30,{status},{payment_date},,\n"

    def upload(name, rows):
        return client.post(
            "/api/v1/datasets/upload",
            headers=headers,
            files={"file": (f"{name}.csv", (csv_header + "".join(rows)).encode(), "text/csv")},
        )

    try:
        accepted = upload("statuses", [
            row("STATUS-PAID", "  PAID  ", payment_date=paid_date),
            row("STATUS-OPEN", " open "),
            row("STATUS-OVERDUE", " Overdue "),
        ])
        assert accepted.status_code == 200, accepted.text
        with sessions() as session:
            paid = session.get(Invoice, "STATUS-PAID")
            opened = session.get(Invoice, "STATUS-OPEN")
            overdue = session.get(Invoice, "STATUS-OVERDUE")
            assert (paid.invoice_status, opened.invoice_status, overdue.invoice_status) == ("paid", "open", "overdue")
            assert paid.delay_days == (paid.payment_date - paid.due_date).days == 1 and paid.is_late is True
            # A past due date alone does not rewrite an explicitly open invoice.
            assert opened.due_date < validation_date and opened.payment_date is None and opened.delay_days is None and opened.is_late is None
            assert overdue.due_date < validation_date and overdue.payment_date is None and overdue.delay_days is None and overdue.is_late is None

        invalid_cases = [
            ("bad-status", [row("BAD-STATUS", "settled", payment_date=paid_date)], "invoice_status"),
            ("bad-date", [row("BAD-DATE", "paid", payment_date="not-a-date")], "payment_date"),
            ("paid-without-date", [row("PAID-NO-DATE", "paid")], "payment_date"),
            ("open-with-payment", [row("OPEN-PAID", "open", payment_date=paid_date)], "payment_date"),
            ("overdue-with-payment", [row("OVERDUE-PAID", "overdue", payment_date=paid_date)], "payment_date"),
            ("not-yet-overdue", [row("DUE-TODAY", "overdue", due_date=validation_date.isoformat())], "due_date"),
            ("bad-currency", [row("BAD-CURRENCY", "open").replace(",USD,", ",EUR,")], "invoice_currency"),
            ("bad-invoice-date", [row("BAD-INVOICE-DATE", "open", invoice_day="2026-02-30")], "invoice_date"),
        ]
        for name, rows, expected_column in invalid_cases:
            rejected = upload(name, rows)
            assert rejected.status_code == 422, f"{name}: {rejected.text}"
            issue_columns = {issue["column"] for issue in rejected.json()["detail"]["issues"]}
            assert expected_column in issue_columns
        with sessions() as session:
            assert all(session.get(Invoice, invoice_id) is None for invoice_id in ("BAD-STATUS", "BAD-DATE", "PAID-NO-DATE", "OPEN-PAID", "OVERDUE-PAID", "DUE-TODAY", "BAD-CURRENCY", "BAD-INVOICE-DATE"))
    finally:
        client.close()
        main.app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_missing_columns_and_duplicate_ids_are_reported_without_partial_import(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    headers = {"Authorization": f"Bearer {tokens['business_owner']}"}
    minimal = "invoice_id,customer_id\nA,B\n"
    missing = client.post("/api/v1/datasets/upload", headers=headers, files={"file": ("missing.csv", minimal.encode(), "text/csv")})
    assert missing.status_code == 422
    assert set(missing.json()["detail"]["missing"]) >= {"name_customer", "invoice_status", "invoice_amount"}

    today = main.business_today()
    header = "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status\n"
    row = f"DUPLICATE-IN-FILE,C,D,100,{(today-timedelta(days=30)).isoformat()},{today.isoformat()},USD,N30,open\n"
    duplicated = client.post("/api/v1/datasets/upload", headers=headers, files={"file": ("duplicates.csv", (header + row + row).encode(), "text/csv")})
    assert duplicated.status_code == 422
    detail = duplicated.json()["detail"]
    assert detail["duplicateRows"] == 2
    assert detail["rejectedRows"] == 2
    with sessions() as session:
        assert session.get(Invoice, "DUPLICATE-IN-FILE") is None
        assert session.query(DatasetUpload).count() == 0
    client.close()
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def test_persistence_commit_survives_scoring_queue_failure(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    monkeypatch.setattr(main, "_start_scoring_job", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("queue unavailable")))
    today = main.business_today()
    csv_text = (
        "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status\n"
        f"QUEUE-FAILURE,CUSTOMER-QUEUE,Queue Test,100,{(today-timedelta(days=30)).isoformat()},{today.isoformat()},USD,N30,open\n"
    )
    response = client.post("/api/v1/datasets/upload", headers={"Authorization": f"Bearer {tokens['business_owner']}"}, files={"file": ("queue-failure.csv", csv_text.encode(), "text/csv")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["uploadStatus"] == "imported"
    assert result["importedInvoices"] == result["importedCustomers"] == 1
    assert result["scoringStatus"] == "queue_failed"
    assert result["scoringJob"] is None and "could not be queued" in result["scoringError"]
    with sessions() as session:
        assert session.get(Invoice, "QUEUE-FAILURE") is not None
        assert session.get(Customer, "CUSTOMER-QUEUE") is not None
        assert session.query(DatasetUpload).count() == 1
    client.close()
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def test_scoring_execution_failure_does_not_fail_committed_upload(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    monkeypatch.setattr(main, "MODEL_STATUS", {
        "late-payment": {"status": "unavailable", "version": None},
        "payment-delay": {"status": "unavailable", "version": None},
    })
    today = main.business_today()
    csv_text = (
        "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status\n"
        f"MODEL-UNAVAILABLE,CUSTOMER-MODEL,Model Test,100,{(today-timedelta(days=30)).isoformat()},{today.isoformat()},USD,N30,open\n"
    )
    headers = {"Authorization": f"Bearer {tokens['business_owner']}"}
    response = client.post("/api/v1/datasets/upload", headers=headers, files={"file": ("model-unavailable.csv", csv_text.encode(), "text/csv")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["uploadStatus"] == "imported" and result["importedInvoices"] == 1
    assert result["scoringStatus"] == "queued" and result["scoringJob"] is not None
    job = client.get(f"/api/v1/datasets/scoring-jobs/{result['scoringJob']['id']}", headers=headers)
    assert job.status_code == 200
    assert job.json()["status"] == "failed"
    assert job.json()["failed"] == 1 and "model is unavailable" in job.json()["results"]["failures"][0]["reason"]
    with sessions() as session:
        assert session.get(Invoice, "MODEL-UNAVAILABLE") is not None
        assert session.query(DatasetUpload).count() == 1
    client.close()
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def test_database_persistence_failure_rolls_back_invoice_customer_and_upload(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    client.close()
    client = TestClient(main.app, raise_server_exceptions=False)
    today = main.business_today()
    csv_text = (
        "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status\n"
        f"DB-ROLLBACK,CUSTOMER-ROLLBACK,Rollback Test,100,{(today-timedelta(days=30)).isoformat()},{today.isoformat()},USD,N30,open\n"
    )

    def fail_invoice_flush(session, _flush_context, _instances):
        if any(isinstance(obj, Invoice) for obj in session.new):
            raise RuntimeError("forced database persistence failure")

    event.listen(Session, "before_flush", fail_invoice_flush)
    try:
        response = client.post("/api/v1/datasets/upload", headers={"Authorization": f"Bearer {tokens['business_owner']}"}, files={"file": ("rollback.csv", csv_text.encode(), "text/csv")})
    finally:
        event.remove(Session, "before_flush", fail_invoice_flush)
    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    with sessions() as session:
        assert session.get(Invoice, "DB-ROLLBACK") is None
        assert session.get(Customer, "CUSTOMER-ROLLBACK") is None
        assert session.query(DatasetUpload).count() == 0
    assert not list((tmp_path / "uploads").glob("*.csv"))
    client.close()
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def test_bulk_scoring_actual_models_skips_paid_ineligible_and_duplicate_rows(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    repository_root = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(main, "MODEL_DIR", repository_root / "models")
    monkeypatch.setattr(main, "DATA_DIR", repository_root / "data")
    main.load_models()
    assert main.MODEL_STATUS["late-payment"]["status"] == "available"
    assert main.MODEL_STATUS["payment-delay"]["status"] == "available"
    today = main.business_today()
    with sessions() as session:
        customer = Customer(customer_id="BULK-CUSTOMER", customer_name="Bulk Test")
        session.add(customer)
        session.flush()
        for invoice_id, status, due, terms in [
            ("BULK-OPEN", "open", today, "NAA8"),
            ("BULK-OVERDUE", "overdue", today - timedelta(days=1), "NAA8"),
            ("BULK-PAID", "paid", today - timedelta(days=1), "NAA8"),
            ("BULK-MISSING", "open", today, None),
        ]:
            session.add(Invoice(
                invoice_id=invoice_id, customer_id="BULK-CUSTOMER", invoice_amount=1450,
                invoice_currency="USD", invoice_date=today - timedelta(days=30), due_date=due,
                payment_date=(today if status == "paid" else None), delay_days=(1 if status == "paid" else None),
                is_late=(True if status == "paid" else None), invoice_status=status, payment_terms=terms,
            ))
        session.commit()

    headers = {"Authorization": f"Bearer {tokens['accountant']}"}
    assert client.post("/api/v1/datasets/scoring-jobs", json={"rescore": False}).status_code == 401
    assert client.post("/api/v1/datasets/scoring-jobs", headers={"Authorization": f"Bearer {tokens['collection_user']}"}, json={"rescore": False}).status_code == 403
    started = client.post("/api/v1/datasets/scoring-jobs", headers=headers, json={"rescore": False})
    assert started.status_code == 202, started.text
    job_response = client.get(f"/api/v1/datasets/scoring-jobs/{started.json()['id']}", headers=headers)
    assert job_response.status_code == 200, job_response.text
    job = job_response.json()
    assert job["status"] in {"completed", "completed_with_errors"}
    assert job["total"] == 3
    assert job["succeeded"] == 2
    assert job["skipped"] == 1
    assert job["failed"] == 0
    assert any(item["invoiceId"] == "BULK-MISSING" and "payment_terms" in item["reason"] for item in job["results"]["skippedInvoices"])

    with sessions() as session:
        records = session.scalars(select(Prediction).where(Prediction.invoice_id.like("BULK-%"))).all()
        assert len(records) == 4
        assert all(row.input_fingerprint for row in records)
        assert not any(row.invoice_id == "BULK-PAID" for row in records)
        for invoice_id in ("BULK-OPEN", "BULK-OVERDUE"):
            late = next(row for row in records if row.invoice_id == invoice_id and row.prediction_type == "late-payment")
            delay = next(row for row in records if row.invoice_id == invoice_id and row.prediction_type == "payment-delay")
            assert 0 <= float(late.probability) <= 1
            assert late.risk_band in {"Low", "Medium", "High"}
            assert late.details["threshold"] == 0.45
            assert isinstance(late.details["predictedLate"], bool)
            assert delay.predicted_value is not None
        ineligible = session.get(InvoiceScoringState, "BULK-MISSING")
        assert ineligible.status == "ineligible" and "payment_terms" in ineligible.reason

    risk_summary = client.get("/api/v1/payment-risk/summary", headers=headers)
    delay_summary = client.get("/api/v1/delay-predictions/summary", headers=headers)
    assert risk_summary.status_code == delay_summary.status_code == 200
    assert risk_summary.json()["counts"]["totalOpenScored"] == 2
    assert {row["id"] for row in risk_summary.json()["queue"] if row["id"].startswith("BULK-")} == {"BULK-OPEN", "BULK-OVERDUE"}
    assert delay_summary.json()["counts"]["scored"] == 2

    repeat = client.post("/api/v1/datasets/scoring-jobs", headers=headers, json={"rescore": False})
    assert repeat.status_code == 202, repeat.text
    repeat_job = client.get(f"/api/v1/datasets/scoring-jobs/{repeat.json()['id']}", headers=headers).json()
    assert repeat_job["succeeded"] == 0
    assert repeat_job["skipped"] == 3
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Prediction).where(Prediction.invoice_id.like("BULK-%"))) == 4

    # Changing a model input invalidates the existing fingerprint and triggers a fresh saved score.
    with sessions() as session:
        invoice = session.get(Invoice, "BULK-OPEN")
        invoice.invoice_amount = 1550
        session.commit()
    changed = client.post("/api/v1/datasets/scoring-jobs", headers=headers, json={"rescore": False})
    assert changed.status_code == 202, changed.text
    changed_job = client.get(f"/api/v1/datasets/scoring-jobs/{changed.json()['id']}", headers=headers).json()
    assert changed_job["succeeded"] == 1
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Prediction).where(Prediction.invoice_id == "BULK-OPEN", Prediction.prediction_type == "late-payment")) == 2
    engine.dispose()


def test_upload_automatically_starts_bulk_scoring_job(tmp_path, monkeypatch):
    client, sessions, engine, tokens = _client_and_tokens(tmp_path, monkeypatch)
    repository_root = Path(__file__).resolve().parents[2]
    monkeypatch.setattr(main, "MODEL_DIR", repository_root / "models")
    monkeypatch.setattr(main, "DATA_DIR", repository_root / "data")
    main.load_models()
    due = main.business_today().isoformat()
    csv_text = (
        "invoice_id,customer_id,name_customer,invoice_amount,invoice_date,due_date,invoice_currency,cust_payment_terms,invoice_status,payment_date\n"
        f"UPLOAD-OPEN,UPLOAD-CUSTOMER,Upload Test,1500,{(main.business_today()-timedelta(days=30)).isoformat()},{due},USD,NAA8,open,\n"
    )
    response = client.post(
        "/api/v1/datasets/upload", headers={"Authorization": f"Bearer {tokens['business_owner']}"},
        files={"file": ("auto.csv", csv_text.encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["scoringJob"]["total"] == 1
    assert payload["scoringJob"]["status"] in {"queued", "running", "completed", "completed_with_errors"}
    status = client.get(f"/api/v1/datasets/scoring-jobs/{payload['scoringJob']['id']}", headers={"Authorization": f"Bearer {tokens['accountant']}"})
    assert status.status_code == 200, status.text
    assert status.json()["succeeded"] == 1
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Prediction).where(Prediction.invoice_id == "UPLOAD-OPEN")) == 2
    engine.dispose()
