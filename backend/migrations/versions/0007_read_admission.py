"""Persist exact trusted admission requests before contacting PaperDaily."""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("read_charges", sa.Column("admission", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("read_charges", "admission")
