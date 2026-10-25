"""
Read it DEEP - 后台任务与模型用量
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, Date, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Job(Base):
    """持久化后台任务：上传解析、重新分析、翻译。由 app/core/jobs.py 的 worker 认领执行。"""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # parse | analyze | translate
    paper_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[Optional[dict]] = mapped_column(JSON)
    error: Mapped[Optional[str]] = mapped_column(Text)
    worker: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_jobs_status_kind", "status", "kind"),)


class TokenUsage(Base):
    """模型用量，按（日期、任务、模型）累加。取代 data/token_stats.json。"""

    __tablename__ = "token_usage"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    task: Mapped[str] = mapped_column(String(50), primary_key=True)
    model: Mapped[str] = mapped_column(String(200), primary_key=True, default="")
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    calls: Mapped[int] = mapped_column(BigInteger, default=0)
