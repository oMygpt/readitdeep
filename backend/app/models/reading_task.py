"""
阅读任务模型 (Reading Task Models)

用于团队阅读任务管理：
- ReadingTask: 阅读任务
- TaskAssignee: 任务分配记录
"""

from datetime import datetime
from typing import List, Optional
import uuid
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship, Mapped
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class TaskStatus(str, enum.Enum):
    """任务状态"""
    PENDING = "pending"      # 待开始
    IN_PROGRESS = "in_progress"  # 进行中
    COMPLETED = "completed"  # 已完成
    CANCELLED = "cancelled"  # 已取消


class AssigneeStatus(str, enum.Enum):
    """分配者状态"""
    ASSIGNED = "assigned"    # 已分配，未开始
    READING = "reading"      # 阅读中
    SUBMITTED = "submitted"  # 已提交总结
    APPROVED = "approved"    # 总结已通过


class TaskPriority(str, enum.Enum):
    """任务优先级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class ReadingTask(Base):
    """阅读任务模型"""
    __tablename__ = "reading_tasks"

    id: Mapped[str] = Column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    # 关联
    team_id: Mapped[str] = Column(
        String(36), 
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    paper_id: Mapped[Optional[str]] = Column(
        String(36),
        ForeignKey("papers.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    created_by: Mapped[str] = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # 任务信息
    title: Mapped[str] = Column(String(255), nullable=False)
    description: Mapped[Optional[str]] = Column(Text, nullable=True)
    
    # 状态
    status: Mapped[TaskStatus] = Column(
        SQLEnum(TaskStatus),
        default=TaskStatus.PENDING,
        nullable=False,
        index=True
    )
    priority: Mapped[TaskPriority] = Column(
        SQLEnum(TaskPriority),
        default=TaskPriority.MEDIUM,
        nullable=False
    )
    
    # 时间
    due_date: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    
    # 关系
    team = relationship("Team", back_populates="tasks")
    paper = relationship("Paper", back_populates="tasks")
    creator = relationship("User", foreign_keys=[created_by])
    assignees: Mapped[List["TaskAssignee"]] = relationship(
        "TaskAssignee",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "team_id": self.team_id,
            "paper_id": self.paper_id,
            "created_by": self.created_by,
            "title": self.title,
            "description": self.description,
            "status": self.status.value if self.status else None,
            "priority": self.priority.value if self.priority else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "assignees": [a.to_dict() for a in self.assignees] if self.assignees else [],
            "assignee_count": len(self.assignees) if self.assignees else 0,
        }


class TaskAssignee(Base):
    """任务分配记录模型"""
    __tablename__ = "task_assignees"

    id: Mapped[str] = Column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    
    # 关联
    task_id: Mapped[str] = Column(
        String(36),
        ForeignKey("reading_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[str] = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    assigned_by: Mapped[str] = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # 状态
    status: Mapped[AssigneeStatus] = Column(
        SQLEnum(AssigneeStatus),
        default=AssigneeStatus.ASSIGNED,
        nullable=False
    )
    
    # 阅读总结
    summary: Mapped[Optional[str]] = Column(Text, nullable=True)
    summary_structure: Mapped[Optional[str]] = Column(Text, nullable=True)  # JSON 结构化总结
    
    # 时间
    assigned_at: Mapped[datetime] = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    started_at: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    
    # 关系
    task: Mapped["ReadingTask"] = relationship("ReadingTask", back_populates="assignees")
    user = relationship("User", foreign_keys=[user_id])
    assigner = relationship("User", foreign_keys=[assigned_by])
    
    def to_dict(self):
        """转换为字典"""
        user = self.user
        return {
            "id": self.id,
            "task_id": self.task_id,
            "user_id": self.user_id,
            "assigned_by": self.assigned_by,
            "status": self.status.value if self.status else None,
            "summary": self.summary,
            "assigned_at": self.assigned_at.isoformat() if self.assigned_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
            } if user else None,
        }
