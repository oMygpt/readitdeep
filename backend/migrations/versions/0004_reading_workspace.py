"""Private reading workspaces, immutable revisions and evidence bookmarks."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_revisions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "paper_id",
            sa.String(36),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("representation", sa.String(20), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_reading_revisions_paper_id", "reading_revisions", ["paper_id"])
    op.create_index("ix_reading_revisions_user_id", "reading_revisions", ["user_id"])
    op.create_table(
        "reading_workspaces",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "paper_id",
            sa.String(36),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("focus", sa.Text(), nullable=False),
        sa.Column("next_action", sa.Text(), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.add_column("team_annotations", sa.Column("anchor", sa.JSON(), nullable=True))
    op.add_column(
        "team_annotations",
        sa.Column("is_evidence", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("team_annotations", sa.Column("research_question", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("team_annotations") as batch:
        batch.drop_column("research_question")
        batch.drop_column("is_evidence")
        batch.drop_column("anchor")
    op.drop_table("reading_workspaces")
    op.drop_index("ix_reading_revisions_user_id", "reading_revisions")
    op.drop_index("ix_reading_revisions_paper_id", "reading_revisions")
    op.drop_table("reading_revisions")
