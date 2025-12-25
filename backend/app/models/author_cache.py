"""
Read it DEEP - 作者信息缓存模型

缓存 OpenAlex 获取的作者和论文信息
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column
import uuid

from app.core.database import Base


class AuthorCache(Base):
    """
    作者信息缓存表
    
    缓存从 OpenAlex 获取的作者信息，避免重复请求
    """
    __tablename__ = "author_cache"
    __table_args__ = (
        Index("idx_author_openalex", "openalex_id"),
    )
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    # OpenAlex 标识
    openalex_id: Mapped[str] = mapped_column(
        String(100), 
        unique=True,
        nullable=False,
        comment="OpenAlex 作者 ID"
    )
    
    # 基本信息
    display_name: Mapped[str] = mapped_column(
        String(200), 
        nullable=False
    )
    affiliation: Mapped[Optional[str]] = mapped_column(
        String(500), 
        nullable=True
    )
    orcid: Mapped[Optional[str]] = mapped_column(
        String(50), 
        nullable=True
    )
    
    # 统计
    works_count: Mapped[int] = mapped_column(
        Integer, 
        default=0
    )
    cited_by_count: Mapped[int] = mapped_column(
        Integer, 
        default=0
    )
    
    # 缓存的论文数据 (JSON 格式)
    top_works_json: Mapped[Optional[str]] = mapped_column(
        Text, 
        nullable=True,
        comment="作者主要论文列表 (JSON 格式)"
    )
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "openalex_id": self.openalex_id,
            "display_name": self.display_name,
            "affiliation": self.affiliation,
            "orcid": self.orcid,
            "works_count": self.works_count,
            "cited_by_count": self.cited_by_count,
            "top_works_json": self.top_works_json,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PaperAuthorCache(Base):
    """
    论文-作者关联缓存
    
    关联论文 ID 和已缓存的作者
    """
    __tablename__ = "paper_author_cache"
    __table_args__ = (
        Index("idx_paper_author_paper", "paper_id"),
        Index("idx_paper_author_author", "author_cache_id"),
    )
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    paper_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        comment="本地论文 ID"
    )
    
    author_cache_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("author_cache.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # 作者在论文中的顺序
    author_position: Mapped[int] = mapped_column(
        Integer, 
        default=0
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
