"""Map legacy roles to the supported business role structure.

Existing admin accounts retain their access as business_owner; collections
accounts become collection_user. No user or credential rows are deleted.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_business_roles"
down_revision = "0002_invoice_terms_checks"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "users" not in sa.inspect(bind).get_table_names():
        return
    users = sa.table("users", sa.column("role", sa.String(length=32)))
    op.execute(users.update().where(users.c.role == "admin").values(role="business_owner"))
    op.execute(users.update().where(users.c.role == "collections").values(role="collection_user"))


def downgrade():
    # Role values are intentionally not mapped back: admins now have the
    # business_owner identity and a reverse migration could lose that intent.
    pass
