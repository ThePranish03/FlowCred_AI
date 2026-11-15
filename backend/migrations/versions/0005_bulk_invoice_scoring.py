"""Persist bulk scoring jobs, eligibility state and prediction fingerprints."""
from alembic import op
import sqlalchemy as sa

revision = "0005_bulk_invoice_scoring"
down_revision = "0004_invoice_overdue_status"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    prediction_columns = {column["name"] for column in inspector.get_columns("predictions")}
    if "input_fingerprint" not in prediction_columns:
        op.add_column("predictions", sa.Column("input_fingerprint", sa.String(length=64), nullable=True))
    inspector = sa.inspect(bind)
    unique_names = {item.get("name") for item in inspector.get_unique_constraints("predictions")}
    index_names = {item.get("name") for item in inspector.get_indexes("predictions")}
    if "uq_prediction_invoice_model_input" not in unique_names | index_names:
        op.create_index(
            "uq_prediction_invoice_model_input",
            "predictions",
            ["invoice_id", "prediction_type", "model_version", "input_fingerprint"],
            unique=True,
        )
    if "invoice_scoring_states" not in inspector.get_table_names():
        op.create_table(
            "invoice_scoring_states",
            sa.Column("invoice_id", sa.String(length=96), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
            sa.Column("late_model_version", sa.String(length=96), nullable=True),
            sa.Column("delay_model_version", sa.String(length=96), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.invoice_id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("invoice_id"),
        )
    if "scoring_jobs" not in inspector.get_table_names():
        op.create_table(
            "scoring_jobs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("total", sa.Integer(), nullable=False),
            sa.Column("processed", sa.Integer(), nullable=False),
            sa.Column("succeeded", sa.Integer(), nullable=False),
            sa.Column("skipped", sa.Integer(), nullable=False),
            sa.Column("failed", sa.Integer(), nullable=False),
            sa.Column("results", sa.JSON(), nullable=True),
            sa.Column("requested_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade():
    op.drop_table("scoring_jobs")
    op.drop_table("invoice_scoring_states")
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "uq_prediction_invoice_model_input" in {item.get("name") for item in inspector.get_indexes("predictions")}:
        op.drop_index("uq_prediction_invoice_model_input", table_name="predictions")
    elif "uq_prediction_invoice_model_input" in {item.get("name") for item in inspector.get_unique_constraints("predictions")}:
        with op.batch_alter_table("predictions") as batch:
            batch.drop_constraint("uq_prediction_invoice_model_input", type_="unique")
    if "input_fingerprint" in {column["name"] for column in sa.inspect(bind).get_columns("predictions")}:
        op.drop_column("predictions", "input_fingerprint")
