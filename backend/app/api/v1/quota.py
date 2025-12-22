"""
Read it DEEP - 配额与邀请码 API

用户配额状态、邀请码生成和兑换
"""

from datetime import datetime, timedelta
from typing import Optional, List
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, PLAN_LIMITS
from app.models.invitation_code import InvitationCode
from app.models.system_config import SystemConfig
from app.api.v1.auth import get_current_user

router = APIRouter()


# ================== Schemas ==================

class QuotaStatusResponse(BaseModel):
    """配额状态响应"""
    plan: str
    plan_display: str
    expires_at: Optional[str] = None
    papers: dict
    ai: dict
    can_parse: bool
    can_use_ai: bool
    subscription_enabled: bool = True  # 订阅功能是否启用


class RedeemRequest(BaseModel):
    """兑换邀请码请求"""
    code: str


class RedeemResponse(BaseModel):
    """兑换邀请码响应"""
    success: bool
    message: str
    new_plan: str
    expires_at: Optional[str] = None


class InvitationCodeCreate(BaseModel):
    """创建邀请码请求"""
    grant_plan: str = "pro"  # 'pro' | 'ultra' (普通用户只能生成 pro)
    grant_days: int = 30     # 授予天数
    expires_days: int = 30   # 邀请码有效期 (天)


class InvitationCodeResponse(BaseModel):
    """邀请码响应"""
    code: str
    grant_plan: str
    grant_days: int
    expires_at: Optional[str] = None
    created_at: str


class InvitationCodeListItem(BaseModel):
    """邀请码列表项"""
    code: str
    grant_plan: str
    grant_days: int
    is_used: bool
    used_at: Optional[str] = None
    is_expired: bool
    expires_at: Optional[str] = None
    created_at: str


class PlanInfo(BaseModel):
    """计划信息"""
    name: str
    display: str
    price: int
    papers_daily: int
    papers_monthly: int
    ai_daily: int


# ================== 配额端点 ==================

@router.get("/status", response_model=QuotaStatusResponse)
async def get_quota_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取当前用户配额状态
    
    返回用户的会员计划和剩余配额信息
    """
    # 重置配额（如果需要）
    daily_reset = current_user.reset_daily_quota_if_needed()
    monthly_reset = current_user.reset_monthly_quota_if_needed()
    
    if daily_reset or monthly_reset:
        await db.commit()
    
    status = current_user.get_quota_status()
    
    # 获取订阅功能开关状态
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.key == "subscription_enabled")
    )
    config = result.scalar_one_or_none()
    subscription_enabled = config.value if config and config.value is not None else True
    
    return QuotaStatusResponse(
        **status,
        subscription_enabled=subscription_enabled
    )


@router.get("/plans", response_model=List[PlanInfo])
async def get_available_plans():
    """
    获取所有可用计划信息
    
    用于前端展示升级选项
    """
    plans = []
    for name, limits in PLAN_LIMITS.items():
        plans.append(PlanInfo(
            name=name,
            display={"free": "免费版", "pro": "Pro", "ultra": "Ultra"}[name],
            price=limits["price"],
            papers_daily=limits["papers_daily"],
            papers_monthly=limits["papers_monthly"],
            ai_daily=limits["ai_daily"],
        ))
    return plans


# ================== 邀请码兑换 ==================

@router.post("/redeem", response_model=RedeemResponse)
async def redeem_invitation_code(
    data: RedeemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    兑换邀请码
    
    - 有效邀请码可升级用户计划
    - 邀请人获得 3 天延期奖励
    """
    code = data.code.strip().upper()
    
    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="请输入邀请码"
        )
    
    # 查找有效邀请码
    result = await db.execute(
        select(InvitationCode).where(
            InvitationCode.code == code,
            InvitationCode.is_active == True,
            InvitationCode.used_by == None,
        )
    )
    invitation = result.scalar_one_or_none()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="邀请码无效或已被使用"
        )
    
    if invitation.is_expired:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="邀请码已过期"
        )
    
    # 不能使用自己生成的邀请码
    if invitation.created_by == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="不能使用自己生成的邀请码"
        )
    
    # 标记邀请码已使用
    invitation.used_by = current_user.id
    invitation.used_at = datetime.utcnow()
    
    # 计算新的过期时间 (限制最大天数防止溢出)
    now = datetime.utcnow()
    grant_days = min(invitation.grant_days or 30, 3650)  # 最多 10 年
    
    if current_user.plan_expires_at and current_user.plan_expires_at > now:
        # 已有订阅，延长时间
        new_expires = current_user.plan_expires_at + timedelta(days=grant_days)
    else:
        # 新订阅
        new_expires = now + timedelta(days=grant_days)
    
    # 升级用户计划
    old_plan = current_user.plan
    current_user.plan = invitation.grant_plan
    current_user.plan_expires_at = new_expires
    current_user.invited_by = invitation.created_by
    
    # 给邀请人奖励 (延长 3 天)
    inviter_result = await db.execute(
        select(User).where(User.id == invitation.created_by)
    )
    inviter = inviter_result.scalar_one_or_none()
    if inviter and inviter.plan in ("pro", "ultra"):
        if inviter.plan_expires_at and inviter.plan_expires_at > now:
            inviter.plan_expires_at += timedelta(days=3)
        inviter.invitation_count += 1
    
    await db.commit()
    
    plan_display = {"free": "免费版", "pro": "Pro", "ultra": "Ultra"}[invitation.grant_plan]
    
    return RedeemResponse(
        success=True,
        message=f"恭喜！已升级为 {plan_display} 会员，有效期 {invitation.grant_days} 天",
        new_plan=invitation.grant_plan,
        expires_at=new_expires.isoformat(),
    )


# ================== 邀请码生成 ==================

@router.post("/invitation-codes", response_model=InvitationCodeResponse)
async def create_invitation_code(
    data: InvitationCodeCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    生成邀请码
    
    - Pro/Ultra 用户可生成邀请码
    - 普通用户只能生成 Pro 体验码 (3天)
    - 管理员可生成任意计划的邀请码
    """
    plan = current_user.get_effective_plan()
    
    # 权限检查
    if not current_user.is_admin and plan == "free":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="免费用户无法生成邀请码，请先升级"
        )
    
    # 非管理员只能生成 pro 体验码
    if current_user.is_admin:
        grant_plan = data.grant_plan
        grant_days = data.grant_days
        creator_plan = "admin"
    else:
        grant_plan = "pro"
        grant_days = 3  # 固定 3 天体验
        creator_plan = plan
    
    # 生成唯一邀请码
    code = f"READIT-{secrets.token_hex(4).upper()}"
    
    # 确保邀请码唯一
    while True:
        result = await db.execute(
            select(InvitationCode).where(InvitationCode.code == code)
        )
        if not result.scalar_one_or_none():
            break
        code = f"READIT-{secrets.token_hex(4).upper()}"
    
    invitation = InvitationCode(
        id=str(uuid.uuid4()),
        code=code,
        created_by=current_user.id,
        creator_plan=creator_plan,
        grant_plan=grant_plan,
        grant_days=grant_days,
        expires_at=datetime.utcnow() + timedelta(days=data.expires_days) if data.expires_days > 0 else None,
    )
    
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    
    return InvitationCodeResponse(
        code=code,
        grant_plan=grant_plan,
        grant_days=grant_days,
        expires_at=invitation.expires_at.isoformat() if invitation.expires_at else None,
        created_at=invitation.created_at.isoformat(),
    )


@router.get("/invitation-codes", response_model=List[InvitationCodeListItem])
async def list_my_invitation_codes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取我生成的邀请码列表
    """
    result = await db.execute(
        select(InvitationCode)
        .where(InvitationCode.created_by == current_user.id)
        .order_by(InvitationCode.created_at.desc())
        .limit(50)
    )
    codes = result.scalars().all()
    
    return [
        InvitationCodeListItem(
            code=c.code,
            grant_plan=c.grant_plan,
            grant_days=c.grant_days,
            is_used=c.is_used,
            used_at=c.used_at.isoformat() if c.used_at else None,
            is_expired=c.is_expired,
            expires_at=c.expires_at.isoformat() if c.expires_at else None,
            created_at=c.created_at.isoformat(),
        )
        for c in codes
    ]


@router.delete("/invitation-codes/{code}")
async def delete_invitation_code(
    code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    删除（禁用）邀请码
    
    只能删除自己创建的未使用邀请码
    """
    result = await db.execute(
        select(InvitationCode).where(
            InvitationCode.code == code.upper(),
            InvitationCode.created_by == current_user.id,
        )
    )
    invitation = result.scalar_one_or_none()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="邀请码不存在"
        )
    
    if invitation.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="已使用的邀请码无法删除"
        )
    
    invitation.is_active = False
    await db.commit()
    
    return {"success": True, "message": "邀请码已删除"}
