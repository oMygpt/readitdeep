"""
Read it DEEP - 团队协作模型

团队、成员、邀请、论文分享
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid
import secrets

from app.core.database import Base


# ================== 角色常量 ==================

class TeamRole:
    OWNER = "owner"      # 创建者，拥有所有权限
    ADMIN = "admin"      # 管理员，可管理成员
    MEMBER = "member"    # 成员，可查看和编辑
    GUEST = "guest"      # 访客，只读


class Team(Base):
    """团队表"""
    __tablename__ = "teams"
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # 创建者
    created_by: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
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
    
    # 关系
    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
    invitations = relationship("TeamInvitation", back_populates="team", cascade="all, delete-orphan")
    paper_shares = relationship("PaperShare", back_populates="team", cascade="all, delete-orphan")
    tasks = relationship("ReadingTask", back_populates="team", cascade="all, delete-orphan")
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "avatar_url": self.avatar_url,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TeamMember(Base):
    """团队成员表"""
    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_member"),
    )
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    team_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    role: Mapped[str] = mapped_column(
        String(20), 
        default=TeamRole.MEMBER
    )
    
    # 加入时间
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    
    # 关系
    team = relationship("Team", back_populates="members")
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "team_id": self.team_id,
            "user_id": self.user_id,
            "role": self.role,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }
    
    @property
    def is_owner(self) -> bool:
        return self.role == TeamRole.OWNER
    
    @property
    def is_admin(self) -> bool:
        return self.role in (TeamRole.OWNER, TeamRole.ADMIN)
    
    @property
    def can_edit(self) -> bool:
        return self.role in (TeamRole.OWNER, TeamRole.ADMIN, TeamRole.MEMBER)


class TeamInvitation(Base):
    """团队邀请表"""
    __tablename__ = "team_invitations"
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    team_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # 邀请码
    invite_code: Mapped[str] = mapped_column(
        String(20), 
        unique=True, 
        nullable=False,
        default=lambda: secrets.token_urlsafe(12)
    )
    
    # 创建者
    created_by: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    # 使用限制
    max_uses: Mapped[int] = mapped_column(Integer, default=0)  # 0 = 无限
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # 过期时间
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), 
        nullable=True
    )
    
    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    
    # 关系
    team = relationship("Team", back_populates="invitations")
    
    @property
    def is_valid(self) -> bool:
        """检查邀请是否有效"""
        # 检查过期
        if self.expires_at and self.expires_at < datetime.utcnow():
            return False
        # 检查使用次数
        if self.max_uses > 0 and self.used_count >= self.max_uses:
            return False
        return True
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "team_id": self.team_id,
            "invite_code": self.invite_code,
            "created_by": self.created_by,
            "max_uses": self.max_uses,
            "used_count": self.used_count,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_valid": self.is_valid,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class PaperShare(Base):
    """论文分享表"""
    __tablename__ = "paper_shares"
    __table_args__ = (
        UniqueConstraint("paper_id", "team_id", name="uq_paper_team_share"),
    )
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    paper_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False
    )
    team_id: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False
    )
    shared_by: Mapped[str] = mapped_column(
        String(36), 
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )
    
    # 分享时间
    shared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    
    # 关系
    team = relationship("Team", back_populates="paper_shares")
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "paper_id": self.paper_id,
            "team_id": self.team_id,
            "shared_by": self.shared_by,
            "shared_at": self.shared_at.isoformat() if self.shared_at else None,
        }
