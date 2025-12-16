"""
Read it DEEP - PaperAnalysis 数据模型

存储 LangGraph 多智能体分析结果
支持 SQLite 和 PostgreSQL
"""

from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Text, DateTime, ForeignKey, func, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PaperAnalysis(Base):
    """论文分析结果模型"""
    __tablename__ = "paper_analysis"
    
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    paper_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # 分析结果
    summary: Mapped[Optional[str]] = mapped_column(Text)
    methods: Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    datasets: Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    code_refs: Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    structure: Mapped[Optional[dict]] = mapped_column(JSON)
    
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
