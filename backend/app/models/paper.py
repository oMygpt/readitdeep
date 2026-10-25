"""
Read it DEEP - Paper 数据模型

支持 SQLite 和 PostgreSQL
"""

from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import JSON, Index, String, Text, DateTime, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Paper(Base):
    """论文模型"""
    __tablename__ = "papers"
    
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    
    # 用户关联 (多用户隔离)
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,  # 暂时可空，兼容现有数据
        index=True,
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
    
    # 用户标签 (JSON 字符串数组)
    tags: Mapped[Optional[str]] = mapped_column(Text)

    # 来源（R4 PaperDaily 导入用；上传的论文为空）。同一用户同一来源同一 ID 只导入一次
    source_provider: Mapped[Optional[str]] = mapped_column(String(50))
    source_id: Mapped[Optional[str]] = mapped_column(String(200))

    # 其余字段（分析结果、翻译进度、标签建议等）。见 app/core/store.py
    extra: Mapped[Optional[dict]] = mapped_column(JSON)
    # 体积大、列表页用不到的字段（embedding、结构、引用图谱等），列表查询不加载
    extra_large: Mapped[Optional[dict]] = mapped_column(JSON)
    
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
    
    __table_args__ = (
        Index("uq_papers_user_source", "user_id", "source_provider", "source_id", unique=True),
    )

    # 关系
    tasks = relationship("ReadingTask", back_populates="paper")
    
    def __repr__(self) -> str:
        return f"<Paper {self.id}: {self.title or self.filename}>"

