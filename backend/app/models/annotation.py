"""
Read it DEEP - 团队标注模型

支持高亮、笔记、讨论等协作标注功能
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid

from app.core.database import Base


# ================== 类型常量 ==================

class AnnotationType:
    """标注类型"""
    HIGHLIGHT = "highlight"   # 高亮
    NOTE = "note"             # 笔记
    COMMENT = "comment"       # 评论/讨论


class AnnotationVisibility:
    """可见性"""
    PRIVATE = "private"       # 仅自己可见
    TEAM = "team"             # 团队可见


# ================== 模型 ==================

class TeamAnnotation(Base):
    """
    团队标注表
    
    支持:
    - 高亮 (highlight): 选中文本添加颜色标记
    - 笔记 (note): 针对高亮或整体添加笔记
    - 评论 (comment): 讨论线程，支持嵌套回复
    """
    __tablename__ = "team_annotations"
    __table_args__ = (
        Index("idx_annotations_paper", "paper_id"),
        Index("idx_annotations_team", "team_id"),
        Index("idx_annotations_user", "user_id"),
        Index("idx_annotations_parent", "parent_id"),
    )
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    # ========== 关联 ==========
    paper_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False
    )
    team_id: Mapped[Optional[str]] = mapped_column(
        String(36), 
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=True  # None = 个人标注 (不属于任何团队)
    )
    user_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # ========== 类型 & 可见性 ==========
    type: Mapped[str] = mapped_column(
        String(20), 
        default=AnnotationType.HIGHLIGHT,
        nullable=False
    )
    visibility: Mapped[str] = mapped_column(
        String(20), 
        default=AnnotationVisibility.PRIVATE,
        nullable=False
    )
    
    # ========== 位置信息 (高亮) ==========
    # 用于在 Markdown 内容中定位
    start_offset: Mapped[Optional[int]] = mapped_column(
        Integer, 
        nullable=True,
        comment="起始字符偏移量"
    )
    end_offset: Mapped[Optional[int]] = mapped_column(
        Integer, 
        nullable=True,
        comment="结束字符偏移量"
    )
    line_number: Mapped[Optional[int]] = mapped_column(
        Integer, 
        nullable=True,
        comment="起始行号 (1-indexed)"
    )
    selected_text: Mapped[Optional[str]] = mapped_column(
        Text, 
        nullable=True,
        comment="选中的原文 (用于验证和显示)"
    )
    
    # ========== 内容 ==========
    content: Mapped[Optional[str]] = mapped_column(
        Text, 
        nullable=True,
        comment="笔记/评论内容 (Markdown 格式)"
    )
    
    # ========== 样式 ==========
    color: Mapped[Optional[str]] = mapped_column(
        String(20), 
        nullable=True,
        comment="高亮颜色 (如 #FFEB3B)"
    )
    
    # ========== 嵌套回复 ==========
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), 
        ForeignKey("team_annotations.id", ondelete="CASCADE"),
        nullable=True,
        comment="父标注 ID (用于嵌套回复)"
    )
    
    # ========== 时间戳 ==========
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    
    # ========== 关系 ==========
    # 子回复 - 自引用一对多关系
    # 从父节点看子节点: parent.replies -> [child1, child2]
    # foreign_keys 指定哪个字段是外键
    replies: Mapped[List["TeamAnnotation"]] = relationship(
        "TeamAnnotation",
        back_populates="parent",
        foreign_keys="TeamAnnotation.parent_id",
        cascade="all, delete",  # 删除父节点时删除子节点
        lazy="selectin"
    )
    
    # 父节点引用
    parent: Mapped[Optional["TeamAnnotation"]] = relationship(
        "TeamAnnotation",
        back_populates="replies",
        foreign_keys=[parent_id],
        remote_side="TeamAnnotation.id",
        lazy="selectin"
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "paper_id": self.paper_id,
            "team_id": self.team_id,
            "user_id": self.user_id,
            "type": self.type,
            "visibility": self.visibility,
            "start_offset": self.start_offset,
            "end_offset": self.end_offset,
            "line_number": self.line_number,
            "selected_text": self.selected_text,
            "content": self.content,
            "color": self.color,
            "parent_id": self.parent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
    
    @property
    def is_highlight(self) -> bool:
        return self.type == AnnotationType.HIGHLIGHT
    
    @property
    def is_note(self) -> bool:
        return self.type == AnnotationType.NOTE
    
    @property
    def is_comment(self) -> bool:
        return self.type == AnnotationType.COMMENT
    
    @property
    def is_private(self) -> bool:
        return self.visibility == AnnotationVisibility.PRIVATE
    
    @property
    def is_team_visible(self) -> bool:
        return self.visibility == AnnotationVisibility.TEAM
    
    @property    
    def is_reply(self) -> bool:
        return self.parent_id is not None
