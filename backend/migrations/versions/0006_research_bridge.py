"""Formal question snapshots, private comparisons and publication receipts."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reading_workspaces", sa.Column("question", sa.JSON(), nullable=True))
    op.create_table(
        "research_comparisons",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("question", sa.JSON()),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("remote_id", sa.String(64)),
        sa.Column("pending_id", sa.String(36)),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_research_comparisons_user_id", "research_comparisons", ["user_id"])
    op.create_table(
        "research_publications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "comparison_id",
            sa.String(36),
            sa.ForeignKey("research_comparisons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("parent_id", sa.String(64)),
        sa.Column("remote_id", sa.String(64)),
        sa.Column("attempt_id", sa.String(36)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_research_publications_user_id", "research_publications", ["user_id"])


def downgrade() -> None:
    op.drop_table("research_publications")
    op.drop_table("research_comparisons")
    with op.batch_alter_table("reading_workspaces") as batch:
        batch.drop_column("question")
