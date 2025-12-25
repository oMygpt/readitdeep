"""
Read it DEEP - ShareLink 数据模型

用于访客分享功能，存储分享链接信息
"""

from datetime import datetime, timedelta
from typing import Optional
import uuid
import secrets

from sqlalchemy import String, Text, DateTime, Integer, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# 默认有效期 14 天
DEFAULT_EXPIRY_DAYS = 14


class ShareLink(Base):
    """分享链接模型"""
    __tablename__ = "share_links"
    
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    
    # 论文 ID (来自 store)
    paper_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    
    # 创建者用户 ID
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # 分享 token (URL 安全)
    share_token: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        index=True,
        default=lambda: secrets.token_urlsafe(32),
    )
    
    # 过期时间 (None = 永不过期)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=lambda: datetime.utcnow() + timedelta(days=DEFAULT_EXPIRY_DAYS),
    )
    
    # 访问统计
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    
    # 关系
    user = relationship("User", backref="share_links")
    
    @property
    def is_expired(self) -> bool:
        """检查链接是否已过期"""
        if self.expires_at is None:
            return False
        return datetime.utcnow() > self.expires_at.replace(tzinfo=None)
    
    def record_access(self) -> None:
        """记录访问"""
        self.access_count += 1
        self.last_accessed_at = datetime.utcnow()
    
    def __repr__(self) -> str:
        return f"<ShareLink {self.share_token[:8]}... for paper {self.paper_id}>"
