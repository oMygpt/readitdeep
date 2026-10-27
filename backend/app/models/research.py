"""Private comparison drafts and immutable, retryable publication receipts."""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ResearchComparison(Base):
    __tablename__ = "research_comparisons"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    question: Mapped[Optional[dict]] = mapped_column(JSON)
    items: Mapped[list] = mapped_column(JSON)
    notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    remote_id: Mapped[Optional[str]] = mapped_column(String(64))
    pending_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ResearchPublication(Base):
    __tablename__ = "research_publications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    comparison_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_comparisons.id", ondelete="CASCADE")
    )
    fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    parent_id: Mapped[Optional[str]] = mapped_column(String(64))
    remote_id: Mapped[Optional[str]] = mapped_column(String(64))
    attempt_id: Mapped[Optional[str]] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(20), default="prepared")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
