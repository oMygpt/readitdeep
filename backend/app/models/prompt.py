"""
Read it DEEP - 提示词版本管理模型

支持提示词的版本控制、活跃版本持久化和编辑历史记录
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PromptVersion(Base):
    """提示词版本表 - 存储所有版本的提示词内容"""
    __tablename__ = "prompt_versions"
    
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    
    # 类型和版本 (联合唯一)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    
    # 内容
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    user_prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    
    # 文件路径 (对应的 md 文件)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    __table_args__ = (
        # 确保每个类型的版本号唯一
        {"sqlite_autoincrement": True},
    )
    
    def __repr__(self) -> str:
        return f"<PromptVersion {self.prompt_type}/{self.version}>"
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "prompt_type": self.prompt_type,
            "version": self.version,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "user_prompt_template": self.user_prompt_template,
            "file_path": self.file_path,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
        }


class PromptActiveVersion(Base):
    """活跃版本表 - 存储每个类型当前使用的版本"""
    __tablename__ = "prompt_active_versions"
    
    # prompt_type 是主键
    prompt_type: Mapped[str] = mapped_column(String(50), primary_key=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    def __repr__(self) -> str:
        return f"<PromptActiveVersion {self.prompt_type}={self.version}>"


class PromptHistory(Base):
    """编辑历史表 - 存储每次编辑的快照用于回滚"""
    __tablename__ = "prompt_history"
    
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    
    # 关联的类型和版本
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    
    # 快照内容
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    user_prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    
    # 变更元数据
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    changed_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    change_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    def __repr__(self) -> str:
        return f"<PromptHistory {self.prompt_type}/{self.version} at {self.changed_at}>"
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "prompt_type": self.prompt_type,
            "version": self.version,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "user_prompt_template": self.user_prompt_template,
            "changed_at": self.changed_at.isoformat() if self.changed_at else None,
            "changed_by": self.changed_by,
            "change_note": self.change_note,
        }
