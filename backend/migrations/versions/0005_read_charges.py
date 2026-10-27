"""Per-PDF read charges and delegated key id (series-site design 2026-10-27 v0.2)."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "read_charges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("paper_id", sa.String(36), nullable=True),
        sa.Column("period_key", sa.String(10), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("funding", sa.String(20), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("price_version", sa.String(100), nullable=True),
        sa.Column("pages", sa.Integer(), nullable=False),
        sa.Column("pd_job_id", sa.String(64), nullable=True),
        sa.Column("pd_fence", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("completion", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "content_sha256", name="uq_read_charges_user_content"),
    )
    op.create_index("ix_read_charges_user_id", "read_charges", ["user_id"])
    op.create_index("ix_read_charges_period_key", "read_charges", ["period_key"])
    op.create_index("ix_read_charges_status", "read_charges", ["status"])
    op.create_index("ix_read_charges_pd_job_id", "read_charges", ["pd_job_id"])
    op.add_column("provider_sessions", sa.Column("key_id", sa.String(100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("provider_sessions") as batch:
        batch.drop_column("key_id")
    for name in ("pd_job_id", "status", "period_key", "user_id"):
        op.drop_index(f"ix_read_charges_{name}", "read_charges")
    op.drop_table("read_charges")
