"""
Read it DEEP - 工作台条目与数据迁移记录
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WorkbenchItem(Base):
    """工作台条目（方法 / 数据集 / 代码 / 笔记），按用户归属"""

    __tablename__ = "workbench_items"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    # 无法确定归属的历史条目为空，只有管理员可见
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    paper_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    type: Mapped[str] = mapped_column(String(20))
    zone: Mapped[str] = mapped_column(String(20), default="notes")
    title: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[Optional[dict]] = mapped_column(JSON)
    # ISO 字符串，沿用旧 JSON 存储的格式（接口直接返回）
    created_at: Mapped[str] = mapped_column(String(40))


class DataMigration(Base):
    """一次性数据迁移的执行记录（如 JSON → DB 导入）"""

    __tablename__ = "data_migrations"

    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    report: Mapped[Optional[dict]] = mapped_column(JSON)
