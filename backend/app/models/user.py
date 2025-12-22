"""
Read it DEEP - 用户模型

用户认证、角色管理和会员配额
"""

from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column
import bcrypt
import uuid

from app.core.database import Base


# ================== 配额常量 ==================

PLAN_LIMITS = {
    "free": {
        "papers_daily": 3,      # 每日论文上限
        "papers_monthly": 10,   # 每月论文上限
        "ai_daily": 10,         # 每日 AI 调用上限
        "price": 0,
    },
    "pro": {
        "papers_daily": 10,     # 每日论文上限
        "papers_monthly": -1,   # 无限
        "ai_daily": 100,        # 每日 AI 调用上限
        "price": 10,            # ¥10/月
    },
    "ultra": {
        "papers_daily": -1,     # 无限
        "papers_monthly": -1,   # 无限
        "ai_daily": -1,         # 无限
        "price": 60,            # ¥60/月
    },
}


class User(Base):
    """用户表"""
    __tablename__ = "users"
    
    id: Mapped[str] = mapped_column(
        String(36), 
        primary_key=True, 
        default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="user")  # 'admin' | 'user'
    is_active: Mapped[bool] = mapped_column(default=True)
    
    # ================== 会员计划 ==================
    plan: Mapped[str] = mapped_column(String(20), default="free")  # 'free' | 'pro' | 'ultra'
    plan_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # ================== 配额追踪 ==================
    # 每日配额
    daily_papers_used: Mapped[int] = mapped_column(Integer, default=0)
    daily_ai_used: Mapped[int] = mapped_column(Integer, default=0)
    last_daily_reset: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # 每月配额 (Free 用户)
    monthly_papers_used: Mapped[int] = mapped_column(Integer, default=0)
    last_monthly_reset: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # ================== 邀请相关 ==================
    invited_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    invitation_count: Mapped[int] = mapped_column(Integer, default=0)  # 成功邀请人数
    
    # ================== 时间戳 ==================
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # ================== 密码方法 ==================
    
    def set_password(self, password: str) -> None:
        """设置密码 (bcrypt 哈希)"""
        salt = bcrypt.gensalt()
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
    
    def verify_password(self, password: str) -> bool:
        """验证密码"""
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))
    
    @property
    def is_admin(self) -> bool:
        """是否管理员"""
        return self.role == "admin"
    
    # ================== 会员计划方法 ==================
    
    def get_effective_plan(self) -> str:
        """获取有效计划 (检查过期)"""
        if self.plan in ("pro", "ultra"):
            if self.plan_expires_at and self.plan_expires_at < datetime.utcnow():
                return "free"  # 已过期降级为免费
        return self.plan
    
    def reset_daily_quota_if_needed(self) -> bool:
        """检查并重置每日配额，返回是否重置"""
        now = datetime.utcnow()
        today = now.date()
        
        needs_reset = False
        if self.last_daily_reset is None or self.last_daily_reset.date() < today:
            self.daily_papers_used = 0
            self.daily_ai_used = 0
            self.last_daily_reset = now
            needs_reset = True
        
        return needs_reset
    
    def reset_monthly_quota_if_needed(self) -> bool:
        """检查并重置每月配额 (Free 用户)，返回是否重置"""
        now = datetime.utcnow()
        current_month = (now.year, now.month)
        
        needs_reset = False
        if self.last_monthly_reset is None:
            self.monthly_papers_used = 0
            self.last_monthly_reset = now
            needs_reset = True
        else:
            last_month = (self.last_monthly_reset.year, self.last_monthly_reset.month)
            if last_month < current_month:
                self.monthly_papers_used = 0
                self.last_monthly_reset = now
                needs_reset = True
        
        return needs_reset
    
    @property
    def can_parse_paper(self) -> bool:
        """是否可以解析新论文"""
        if self.is_admin:
            return True
        
        plan = self.get_effective_plan()
        limits = PLAN_LIMITS[plan]
        
        if plan == "ultra":
            return True
        
        # 检查每日配额
        if limits["papers_daily"] != -1 and self.daily_papers_used >= limits["papers_daily"]:
            return False
        
        # Free 用户检查每月配额
        if plan == "free" and limits["papers_monthly"] != -1:
            if self.monthly_papers_used >= limits["papers_monthly"]:
                return False
        
        return True
    
    @property
    def can_use_ai(self) -> bool:
        """是否可以使用 AI 功能"""
        if self.is_admin:
            return True
        
        plan = self.get_effective_plan()
        limits = PLAN_LIMITS[plan]
        
        if limits["ai_daily"] == -1:
            return True
        
        return self.daily_ai_used < limits["ai_daily"]
    
    def get_quota_status(self) -> dict:
        """获取完整配额状态"""
        plan = self.get_effective_plan()
        limits = PLAN_LIMITS[plan]
        
        result = {
            "plan": plan,
            "plan_display": {"free": "免费版", "pro": "Pro", "ultra": "Ultra"}[plan],
            "expires_at": self.plan_expires_at.isoformat() if self.plan_expires_at else None,
        }
        
        if plan == "ultra":
            result["papers"] = {"daily_used": 0, "daily_limit": -1, "monthly_used": 0, "monthly_limit": -1}
            result["ai"] = {"daily_used": 0, "daily_limit": -1}
        elif plan == "pro":
            result["papers"] = {
                "daily_used": self.daily_papers_used,
                "daily_limit": limits["papers_daily"],
                "monthly_used": 0,
                "monthly_limit": -1,
            }
            result["ai"] = {"daily_used": self.daily_ai_used, "daily_limit": limits["ai_daily"]}
        else:  # free
            result["papers"] = {
                "daily_used": self.daily_papers_used,
                "daily_limit": limits["papers_daily"],
                "monthly_used": self.monthly_papers_used,
                "monthly_limit": limits["papers_monthly"],
            }
            result["ai"] = {"daily_used": self.daily_ai_used, "daily_limit": limits["ai_daily"]}
        
        result["can_parse"] = self.can_parse_paper
        result["can_use_ai"] = self.can_use_ai
        
        return result
    
    def increment_paper_usage(self) -> None:
        """增加论文使用计数"""
        plan = self.get_effective_plan()
        if plan == "ultra" or self.is_admin:
            return
        
        self.daily_papers_used += 1
        
        if plan == "free":
            self.monthly_papers_used += 1
    
    def increment_ai_usage(self) -> None:
        """增加 AI 使用计数"""
        plan = self.get_effective_plan()
        if plan == "ultra" or self.is_admin:
            return
        
        self.daily_ai_used += 1
    
    # ================== 序列化 ==================
    
    def to_dict(self) -> dict:
        """转换为字典 (不含敏感信息)"""
        return {
            "id": str(self.id),
            "email": self.email,
            "username": self.username,
            "role": self.role,
            "is_active": self.is_active,
            "plan": self.get_effective_plan(),
            "plan_expires_at": self.plan_expires_at.isoformat() if self.plan_expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }
