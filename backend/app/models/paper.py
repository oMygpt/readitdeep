"""
Read it DEEP - Paper 数据模型
"""

from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Paper(Base):
    """论文模型"""
    __tablename__ = "papers"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(1000))
    
    # 元数据 (LLM 提取)
    title: Mapped[Optional[str]] = mapped_column(String(1000))
    category: Mapped[Optional[str]] = mapped_column(String(200))
    authors: Mapped[Optional[str]] = mapped_column(Text)  # JSON 字符串
    abstract: Mapped[Optional[str]] = mapped_column(Text)
    doi: Mapped[Optional[str]] = mapped_column(String(200))
    arxiv_id: Mapped[Optional[str]] = mapped_column(String(50))
    
    # 内容
    markdown_content: Mapped[Optional[str]] = mapped_column(Text)
    translated_content: Mapped[Optional[str]] = mapped_column(Text)
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(50),
        default="uploading",
        index=True,
    )  # uploading, parsing, indexing, completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    
    # 时间戳
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
        return f"<Paper {self.id}: {self.title or self.filename}>"
