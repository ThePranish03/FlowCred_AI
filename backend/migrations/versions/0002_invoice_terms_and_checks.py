"""Add invoice payment terms and integrity checks for older schema installs."""
from alembic import op
import sqlalchemy as sa

revision = "0002_invoice_terms_checks"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def _has_check(bind, table: str, name: str) -> bool:
    return name in {item.get("name") for item in sa.inspect(bind).get_check_constraints(table)}


def _has_index(bind, table: str, name: str) -> bool:
    return name in {item.get("name") for item in sa.inspect(bind).get_indexes(table)}


def upgrade():
    bind = op.get_bind()
    if not _has_column(bind, "invoices", "payment_terms"):
        op.add_column("invoices", sa.Column("payment_terms", sa.String(length=64), nullable=True))
    checks = [
        ("invoices", "ck_invoices_positive_amount", "invoice_amount > 0"),
        ("invoices", "ck_invoices_currency", "invoice_currency IN ('USD', 'CAD')"),
        ("invoices", "ck_invoices_status", "invoice_status IS NULL OR invoice_status IN ('paid', 'open')"),
        ("predictions", "ck_predictions_probability_range", "probability IS NULL OR (probability >= 0 AND probability <= 1)"),
    ]
    for table, name, condition in checks:
        if not _has_check(bind, table, name):
            with op.batch_alter_table(table) as batch:
                batch.create_check_constraint(name, condition)
    indexes = [
        ("invoices", "ix_invoices_status_due", ["invoice_status", "due_date"]),
        ("invoices", "ix_invoices_currency_date", ["invoice_currency", "invoice_date"]),
        ("predictions", "ix_predictions_invoice_type_date", ["invoice_id", "prediction_type", "predicted_at"]),
    ]
    for table, name, columns in indexes:
        if not _has_index(bind, table, name):
            op.create_index(name, table, columns)


def downgrade():
    bind = op.get_bind()
    indexes = [
        ("predictions", "ix_predictions_invoice_type_date"),
        ("invoices", "ix_invoices_currency_date"),
        ("invoices", "ix_invoices_status_due"),
    ]
    for table, name in indexes:
        if _has_index(bind, table, name):
            op.drop_index(name, table_name=table)
    checks = [
        ("predictions", "ck_predictions_probability_range"),
        ("invoices", "ck_invoices_status"),
        ("invoices", "ck_invoices_currency"),
        ("invoices", "ck_invoices_positive_amount"),
    ]
    for table, name in checks:
        if _has_check(bind, table, name):
            with op.batch_alter_table(table) as batch:
                batch.drop_constraint(name, type_="check")
    if _has_column(bind, "invoices", "payment_terms"):
        op.drop_column("invoices", "payment_terms")
