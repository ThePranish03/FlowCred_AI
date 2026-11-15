"""Allow explicit overdue invoice status without rewriting existing rows."""
from alembic import op
import sqlalchemy as sa

revision = "0004_invoice_overdue_status"
down_revision = "0003_business_roles"
branch_labels = None
depends_on = None


def _status_check(bind):
    return next(
        (item for item in sa.inspect(bind).get_check_constraints("invoices") if item.get("name") == "ck_invoices_status"),
        None,
    )


def upgrade():
    bind = op.get_bind()
    check = _status_check(bind)
    if check and "'overdue'" not in (check.get("sqltext") or ""):
        with op.batch_alter_table("invoices") as batch:
            batch.drop_constraint("ck_invoices_status", type_="check")
            batch.create_check_constraint(
                "ck_invoices_status",
                "invoice_status IS NULL OR invoice_status IN ('paid', 'open', 'overdue')",
            )
    elif not check:
        with op.batch_alter_table("invoices") as batch:
            batch.create_check_constraint(
                "ck_invoices_status",
                "invoice_status IS NULL OR invoice_status IN ('paid', 'open', 'overdue')",
            )


def downgrade():
    bind = op.get_bind()
    overdue_count = bind.scalar(sa.text("SELECT count(*) FROM invoices WHERE invoice_status = 'overdue'"))
    if overdue_count:
        raise RuntimeError("Cannot remove overdue status while overdue invoice records exist")
    check = _status_check(bind)
    if check:
        with op.batch_alter_table("invoices") as batch:
            batch.drop_constraint("ck_invoices_status", type_="check")
            batch.create_check_constraint(
                "ck_invoices_status",
                "invoice_status IS NULL OR invoice_status IN ('paid', 'open')",
            )
