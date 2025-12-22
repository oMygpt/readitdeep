"""
Read it DEEP - 邀请码模型

邀请码生成和使用追踪
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
import uuid

from app.core.database import Base


class InvitationCode(Base):
    """邀请码表"""
    __tablename__ = "invitation_codes"
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    # 邀请码 (格式: READIT-XXXXXXXX)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    
    # 创建者
    created_by: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    creator_plan: Mapped[str] = mapped_column(String(20), nullable=False)  # 创建时的计划 (admin/pro/ultra)
    
    # 授予的计划
    grant_plan: Mapped[str] = mapped_column(String(20), default="pro")  # 'pro' | 'ultra'
    grant_days: Mapped[int] = mapped_column(Integer, default=30)  # 授予天数
    
    # 使用信息
    used_by: Mapped[Optional[str]] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="SET NULL"), 
        nullable=True
    )
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # 有效期
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # 状态
    is_active: Mapped[bool] = mapped_column(default=True)
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    
    @property
    def is_used(self) -> bool:
        """是否已被使用"""
        return self.used_by is not None
    
    @property
    def is_expired(self) -> bool:
        """是否已过期"""
        if not self.expires_at:
            return False
        return self.expires_at < datetime.utcnow()
    
    @property
    def is_valid(self) -> bool:
        """是否有效 (未使用且未过期)"""
        return self.is_active and not self.is_used and not self.is_expired
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "code": self.code,
            "created_by": self.created_by,
            "creator_plan": self.creator_plan,
            "grant_plan": self.grant_plan,
            "grant_days": self.grant_days,
            "used_by": self.used_by,
            "used_at": self.used_at.isoformat() if self.used_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_active": self.is_active,
            "is_used": self.is_used,
            "is_expired": self.is_expired,
            "is_valid": self.is_valid,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
