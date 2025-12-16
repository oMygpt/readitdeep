"""
Read it DEEP - PaperAnalysis 数据模型

存储 LangGraph 多智能体分析结果
"""

from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PaperAnalysis(Base):
    """论文分析结果模型"""
    __tablename__ = "paper_analysis"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # 分析结果
    summary: Mapped[Optional[str]] = mapped_column(Text)
    methods: Mapped[Optional[dict]] = mapped_column(JSONB, default=list)
    datasets: Mapped[Optional[dict]] = mapped_column(JSONB, default=list)
    code_refs: Mapped[Optional[dict]] = mapped_column(JSONB, default=list)
    structure: Mapped[Optional[dict]] = mapped_column(JSONB)
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        index=True,
    )  # pending, analyzing, completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    
    # 时间戳
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    
    def __repr__(self) -> str:
        return f"<PaperAnalysis {self.id} for Paper {self.paper_id}>"
