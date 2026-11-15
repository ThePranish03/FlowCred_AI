"""Add cash-flow forecast run and point tables (Model 4).

Chained after ``0005_bulk_invoice_scoring``. Written with inspector guards
because development installs may already have created these tables through
``Base.metadata.create_all`` in the application lifespan.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_cash_flow_forecasts"
down_revision = "0005_bulk_invoice_scoring"
branch_labels = None
depends_on = None

RUNS = "cash_flow_forecast_runs"
POINTS = "cash_flow_forecast_points"


def _has_table(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def _has_index(bind, table: str, name: str) -> bool:
    return name in {item.get("name") for item in sa.inspect(bind).get_indexes(table)}


def upgrade():
    bind = op.get_bind()

    if not _has_table(bind, RUNS):
        op.create_table(
            RUNS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("as_of", sa.Date(), nullable=False),
            sa.Column("horizon_days", sa.Integer(), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("model_id", sa.String(length=64), nullable=False),
            sa.Column("model_version", sa.String(length=96), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="generated"),
            sa.Column("metrics_json", sa.JSON(), nullable=True),
            sa.Column("assumptions_json", sa.JSON(), nullable=True),
            sa.Column(
                "created_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("horizon_days IN (7, 30, 90)", name="ck_cash_flow_runs_horizon"),
            sa.CheckConstraint("currency IN ('USD', 'CAD')", name="ck_cash_flow_runs_currency"),
        )
    if not _has_index(bind, RUNS, "ix_cash_flow_forecast_runs_as_of"):
        op.create_index("ix_cash_flow_forecast_runs_as_of", RUNS, ["as_of"])
    if not _has_index(bind, RUNS, "ix_cash_flow_forecast_runs_currency"):
        op.create_index("ix_cash_flow_forecast_runs_currency", RUNS, ["currency"])
    if not _has_index(bind, RUNS, "ix_cash_flow_runs_currency_asof_horizon"):
        op.create_index("ix_cash_flow_runs_currency_asof_horizon", RUNS, ["currency", "as_of", "horizon_days"])

    if not _has_table(bind, POINTS):
        op.create_table(
            POINTS,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "run_id",
                sa.String(length=36),
                sa.ForeignKey(f"{RUNS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("granularity", sa.String(length=8), nullable=False),
            sa.Column("point_date", sa.Date(), nullable=False),
            sa.Column("predicted", sa.Numeric(16, 2), nullable=False),
            sa.Column("lower", sa.Numeric(16, 2), nullable=True),
            sa.Column("upper", sa.Numeric(16, 2), nullable=True),
            sa.CheckConstraint("granularity IN ('weekly', 'daily')", name="ck_cash_flow_points_granularity"),
            sa.CheckConstraint("lower IS NULL OR upper IS NULL OR lower <= predicted", name="ck_cash_flow_points_lower"),
            sa.CheckConstraint("lower IS NULL OR upper IS NULL OR predicted <= upper", name="ck_cash_flow_points_upper"),
        )
    if not _has_index(bind, POINTS, "ix_cash_flow_forecast_points_run_id"):
        op.create_index("ix_cash_flow_forecast_points_run_id", POINTS, ["run_id"])
    if not _has_index(bind, POINTS, "ix_cash_flow_points_run_date"):
        op.create_index("ix_cash_flow_points_run_date", POINTS, ["run_id", "point_date"])


def downgrade():
    bind = op.get_bind()
    if _has_table(bind, POINTS):
        op.drop_table(POINTS)
    if _has_table(bind, RUNS):
        op.drop_table(RUNS)
