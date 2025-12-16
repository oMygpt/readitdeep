"""
Read it DEEP - 用户个性化配置模型
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, DateTime, func, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserConfig(Base):
    """
    用户配置表
    key: 配置项键名 (如 llm_api_key, mineru_api_key)
    value: 配置项值 (JSON存储)
    """
    __tablename__ = "user_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True
    )
    key: Mapped[str] = mapped_column(String(100), index=True)
    value: Mapped[dict] = mapped_column(JSON)
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now(), 
        onupdate=func.now()
    )

    __table_args__ = (
        # 联合唯一索引: 每个用户每个key只能有一条配置
        {"sqlite_autoincrement": True},
    )
