"""
Read it DEEP - 管理员设置 API

系统配置管理和用户管理 CRUD
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.system_config import SystemConfig, DEFAULT_SYSTEM_CONFIG
from app.api.v1.auth import get_current_admin

router = APIRouter()


# ================== Schemas ==================

class SystemConfigUpdate(BaseModel):
    """更新系统配置"""
    # 主 LLM
    llm_mode: Optional[str] = None  # 'shared' | 'user_defined'
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    
    # 翻译 LLM
    translation_mode: Optional[str] = None  # 'shared' | 'user_defined' | 'disabled'
    translation_base_url: Optional[str] = None
    translation_model: Optional[str] = None
    translation_api_key: Optional[str] = None
    
    # MinerU
    mineru_mode: Optional[str] = None  # 'shared' | 'user_defined' | 'self_hosted'
    mineru_api_url: Optional[str] = None
    mineru_api_key: Optional[str] = None
    mineru_self_hosted_url: Optional[str] = None
    
    # Embedding (全局)
    embedding_base_url: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_api_key: Optional[str] = None
    
    # 智能分析
    smart_analysis_mode: Optional[str] = None  # 'inherit' | 'custom'
    
    # Math 解析
    smart_math_base_url: Optional[str] = None
    smart_math_model: Optional[str] = None
    smart_math_api_key: Optional[str] = None
    
    # 费曼教学
    smart_feynman_base_url: Optional[str] = None
    smart_feynman_model: Optional[str] = None
    smart_feynman_api_key: Optional[str] = None
    
    # 深度研究
    smart_deep_base_url: Optional[str] = None
    smart_deep_model: Optional[str] = None
    smart_deep_api_key: Optional[str] = None
    
    # Chat with PDF
    smart_chat_base_url: Optional[str] = None
    smart_chat_model: Optional[str] = None
    smart_chat_api_key: Optional[str] = None


class SystemConfigResponse(BaseModel):
    """系统配置响应 (隐藏敏感信息)"""
    # 主 LLM
    llm_mode: str = "shared"
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key_set: bool = False
    
    # 翻译 LLM
    translation_mode: str = "shared"
    translation_base_url: str = ""
    translation_model: str = ""
    translation_api_key_set: bool = False
    translation_enabled: bool = True
    
    # MinerU
    mineru_mode: str = "shared"
    mineru_api_url: str = ""
    mineru_api_key_set: bool = False
    mineru_self_hosted_url: Optional[str] = None
    
    # Embedding (全局只读)
    embedding_base_url: str = ""
    embedding_model: str = ""
    embedding_api_key_set: bool = False
    
    # 智能分析
    smart_analysis_mode: str = "inherit"
    
    # Math 解析
    smart_math_base_url: str = ""
    smart_math_model: str = ""
    smart_math_api_key_set: bool = False
    
    # 费曼教学
    smart_feynman_base_url: str = ""
    smart_feynman_model: str = ""
    smart_feynman_api_key_set: bool = False
    
    # 深度研究  
    smart_deep_base_url: str = ""
    smart_deep_model: str = ""
    smart_deep_api_key_set: bool = False
    
    # Chat with PDF
    smart_chat_base_url: str = ""
    smart_chat_model: str = ""
    smart_chat_api_key_set: bool = False


class UserCreate(BaseModel):
    """创建用户"""
    email: EmailStr
    password: str
    username: Optional[str] = None
    role: str = "user"  # 'admin' | 'user'


class UserUpdate(BaseModel):
    """更新用户"""
    username: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    """用户响应"""
    id: str
    email: str
    username: Optional[str]
    role: str
    is_active: bool
    created_at: Optional[str]
    last_login: Optional[str]


class UserListResponse(BaseModel):
    """用户列表响应"""
    items: List[UserResponse]
    total: int


# ================== 系统配置 API ==================

async def get_config_value(db: AsyncSession, key: str) -> Optional[dict]:
    """获取配置值"""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    config = result.scalar_one_or_none()
    if config:
        return config.value
    # 返回默认值
    default = DEFAULT_SYSTEM_CONFIG.get(key)
    return default.get("value") if default else None


async def set_config_value(db: AsyncSession, key: str, value: dict, admin_id: str):
    """设置配置值"""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    config = result.scalar_one_or_none()
    
    if config:
        config.value = value
        config.updated_by = admin_id
    else:
        description = DEFAULT_SYSTEM_CONFIG.get(key, {}).get("description", "")
        config = SystemConfig(key=key, value=value, description=description, updated_by=admin_id)
        db.add(config)
    
    await db.commit()


@router.get("/config", response_model=SystemConfigResponse)
async def get_system_config(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取系统配置 (仅管理员)"""
    config = SystemConfigResponse()
    
    # LLM 配置
    config.llm_mode = await get_config_value(db, "llm_mode") or "shared"
    config.llm_api_key_set = bool(await get_config_value(db, "llm_api_key"))
    config.llm_base_url = await get_config_value(db, "llm_base_url") or ""
    config.llm_model = await get_config_value(db, "llm_model") or ""
    
    # MinerU 配置
    config.mineru_mode = await get_config_value(db, "mineru_mode") or "shared"
    config.mineru_api_key_set = bool(await get_config_value(db, "mineru_api_key"))
    config.mineru_api_url = await get_config_value(db, "mineru_api_url") or ""
    config.mineru_self_hosted_url = await get_config_value(db, "mineru_self_hosted_url")
    
    # 翻译配置
    translation_enabled = await get_config_value(db, "translation_enabled")
    config.translation_enabled = bool(translation_enabled) if translation_enabled is not None else True
    config.translation_mode = await get_config_value(db, "translation_mode") or "shared"
    config.translation_base_url = await get_config_value(db, "translation_base_url") or ""
    config.translation_api_key_set = bool(await get_config_value(db, "translation_api_key"))
    config.translation_model = await get_config_value(db, "translation_model") or ""
    
    # Embedding 配置
    config.embedding_base_url = await get_config_value(db, "embedding_base_url") or ""
    config.embedding_model = await get_config_value(db, "embedding_model") or ""
    
    return config


@router.put("/config")
async def update_system_config(
    data: SystemConfigUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新系统配置 (仅管理员)"""
    updates = data.model_dump(exclude_none=True)
    
    for key, value in updates.items():
        await set_config_value(db, key, value, admin.id)
    
    return {"message": "配置已更新", "updated": list(updates.keys())}


# ================== 用户管理 API ==================

@router.get("/users", response_model=UserListResponse)
async def list_users(
    skip: int = 0,
    limit: int = 50,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取用户列表 (仅管理员)"""
    # 总数
    count_result = await db.execute(select(func.count(User.id)))
    total = count_result.scalar()
    
    # 用户列表
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)
    )
    users = result.scalars().all()
    
    return UserListResponse(
        items=[
            UserResponse(
                id=u.id,
                email=u.email,
                username=u.username,
                role=u.role,
                is_active=u.is_active,
                created_at=u.created_at.isoformat() if u.created_at else None,
                last_login=u.last_login.isoformat() if u.last_login else None,
            )
            for u in users
        ],
        total=total,
    )


@router.post("/users", response_model=UserResponse)
async def create_user(
    data: UserCreate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建用户 (仅管理员)"""
    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱已被注册",
        )
    
    # 创建用户
    user = User(
        email=data.email,
        username=data.username,
        role=data.role,
    )
    user.set_password(data.password)
    
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取单个用户 (仅管理员)"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    data: UserUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新用户 (仅管理员)"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 不能禁用自己
    if data.is_active is False and user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能禁用自己的账户",
        )
    
    # 不能降级自己
    if data.role and data.role != "admin" and user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能降级自己的权限",
        )
    
    # 更新字段
    if data.username is not None:
        user.username = data.username
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    
    await db.commit()
    await db.refresh(user)
    
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除用户 (仅管理员)"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 不能删除自己
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除自己的账户",
        )
    
    await db.delete(user)
    await db.commit()
    
    return {"message": "用户已删除"}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    new_password: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """重置用户密码 (仅管理员)"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    user.set_password(new_password)
    await db.commit()
    
    return {"message": "密码已重置"}


# ================== 论文管理 API ==================

from app.core.store import store


class AdminPaperItem(BaseModel):
    """管理员论文项"""
    id: str
    filename: str
    title: Optional[str] = None
    status: str  # uploading, parsing, indexing, completed, failed
    error_message: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminPaperListResponse(BaseModel):
    """管理员论文列表响应"""
    items: List[AdminPaperItem]
    total: int
    page: int
    page_size: int


@router.get("/papers", response_model=AdminPaperListResponse)
async def list_all_papers(
    page: int = 1,
    page_size: int = 50,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员查看所有论文
    
    支持按状态和用户筛选
    """
    # 获取所有论文
    all_papers = store.get_all()
    
    # 筛选
    if status:
        all_papers = [p for p in all_papers if p.get("status") == status]
    if user_id:
        all_papers = [p for p in all_papers if p.get("user_id") == user_id]
    
    # 按创建时间排序 (最新在前)
    try:
        all_papers.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    except Exception:
        pass
    
    total = len(all_papers)
    
    # 分页
    start = (page - 1) * page_size
    end = start + page_size
    paginated = all_papers[start:end]
    
    # 获取用户邮箱映射
    user_ids = set(p.get("user_id") for p in paginated if p.get("user_id"))
    user_email_map = {}
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = result.scalars().all()
        user_email_map = {u.id: u.email for u in users}
    
    items = []
    for p in paginated:
        items.append(AdminPaperItem(
            id=p.get("id", ""),
            filename=p.get("filename", ""),
            title=p.get("title"),
            status=p.get("status", "unknown"),
            error_message=p.get("error_message"),
            user_id=p.get("user_id"),
            user_email=user_email_map.get(p.get("user_id")),
            created_at=str(p.get("created_at")) if p.get("created_at") else None,
            updated_at=str(p.get("updated_at")) if p.get("updated_at") else None,
        ))
    
    return AdminPaperListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )

@router.get("/papers/stats")
async def get_paper_stats(
    admin: User = Depends(get_current_admin),
):
    """获取论文统计信息"""
    all_papers = store.get_all()
    
    stats = {
        "total": len(all_papers),
        "by_status": {},
        "by_user": {},
    }
    
    for p in all_papers:
        status = p.get("status", "unknown")
        stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
        
        uid = p.get("user_id", "unassigned")
        stats["by_user"][uid] = stats["by_user"].get(uid, 0) + 1
    
    return stats


# ================== Token 用量统计 API ==================

from app.core.token_tracker import token_tracker


class TokenStatsResponse(BaseModel):
    """Token 用量统计响应"""
    total_tokens: int = 0
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    calls_count: int = 0
    by_function: dict = {}
    by_date: dict = {}


@router.get("/token-stats", response_model=TokenStatsResponse)
async def get_token_stats(
    admin: User = Depends(get_current_admin),
):
    """
    获取 LLM Token 用量统计 (仅管理员)
    
    返回:
    - total_tokens: 总 token 用量
    - total_prompt_tokens: 输入 token 总量
    - total_completion_tokens: 输出 token 总量
    - calls_count: 总调用次数
    - by_function: 按功能分类统计
    - by_date: 按日期分类统计
    """
    stats = token_tracker.get_stats()
    return TokenStatsResponse(**stats)


@router.post("/token-stats/reset")
async def reset_token_stats(
    admin: User = Depends(get_current_admin),
):
    """重置 Token 用量统计 (仅管理员)"""
    token_tracker.reset()
    return {"message": "Token 统计已重置"}


# ================== 邀请码管理 API ==================

from datetime import datetime, timedelta
from app.models.invitation_code import InvitationCode
import secrets
import uuid


class AdminInvitationCodeItem(BaseModel):
    """管理员邀请码项"""
    id: str
    code: str
    created_by: str
    creator_email: Optional[str] = None
    creator_plan: str
    grant_plan: str
    grant_days: int
    is_used: bool
    used_by: Optional[str] = None
    used_by_email: Optional[str] = None
    used_at: Optional[str] = None
    is_expired: bool
    expires_at: Optional[str] = None
    is_active: bool
    created_at: str


class AdminInvitationCodeListResponse(BaseModel):
    """管理员邀请码列表响应"""
    items: List[AdminInvitationCodeItem]
    total: int
    stats: dict


class BatchInvitationCodeCreate(BaseModel):
    """批量创建邀请码"""
    count: int = 10
    grant_plan: str = "pro"
    grant_days: int = 30
    expires_days: int = 30


@router.get("/invitation-codes", response_model=AdminInvitationCodeListResponse)
async def list_all_invitation_codes(
    skip: int = 0,
    limit: int = 100,
    grant_plan: Optional[str] = None,
    is_used: Optional[bool] = None,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员获取所有邀请码列表
    
    支持按计划和使用状态筛选
    """
    query = select(InvitationCode).order_by(InvitationCode.created_at.desc())
    
    if grant_plan:
        query = query.where(InvitationCode.grant_plan == grant_plan)
    if is_used is not None:
        if is_used:
            query = query.where(InvitationCode.used_by != None)
        else:
            query = query.where(InvitationCode.used_by == None)
    
    # 总数
    count_query = select(func.count(InvitationCode.id))
    if grant_plan:
        count_query = count_query.where(InvitationCode.grant_plan == grant_plan)
    if is_used is not None:
        if is_used:
            count_query = count_query.where(InvitationCode.used_by != None)
        else:
            count_query = count_query.where(InvitationCode.used_by == None)
    
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    
    # 分页
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    codes = result.scalars().all()
    
    # 获取用户邮箱映射
    user_ids = set()
    for c in codes:
        if c.created_by:
            user_ids.add(c.created_by)
        if c.used_by:
            user_ids.add(c.used_by)
    
    user_email_map = {}
    if user_ids:
        user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = user_result.scalars().all()
        user_email_map = {u.id: u.email for u in users}
    
    # 统计
    all_codes_result = await db.execute(select(InvitationCode))
    all_codes = all_codes_result.scalars().all()
    
    stats = {
        "total": len(all_codes),
        "used": sum(1 for c in all_codes if c.is_used),
        "active": sum(1 for c in all_codes if c.is_valid),
        "expired": sum(1 for c in all_codes if c.is_expired and not c.is_used),
        "by_plan": {},
    }
    for c in all_codes:
        plan = c.grant_plan
        if plan not in stats["by_plan"]:
            stats["by_plan"][plan] = {"total": 0, "used": 0}
        stats["by_plan"][plan]["total"] += 1
        if c.is_used:
            stats["by_plan"][plan]["used"] += 1
    
    items = [
        AdminInvitationCodeItem(
            id=c.id,
            code=c.code,
            created_by=c.created_by,
            creator_email=user_email_map.get(c.created_by),
            creator_plan=c.creator_plan,
            grant_plan=c.grant_plan,
            grant_days=c.grant_days,
            is_used=c.is_used,
            used_by=c.used_by,
            used_by_email=user_email_map.get(c.used_by) if c.used_by else None,
            used_at=c.used_at.isoformat() if c.used_at else None,
            is_expired=c.is_expired,
            expires_at=c.expires_at.isoformat() if c.expires_at else None,
            is_active=c.is_active,
            created_at=c.created_at.isoformat(),
        )
        for c in codes
    ]
    
    return AdminInvitationCodeListResponse(
        items=items,
        total=total,
        stats=stats,
    )


@router.post("/invitation-codes/batch")
async def batch_create_invitation_codes(
    data: BatchInvitationCodeCreate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员批量生成邀请码
    """
    if data.count < 1 or data.count > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="生成数量必须在 1-100 之间"
        )
    
    if data.grant_plan not in ("pro", "ultra"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="grant_plan 必须是 'pro' 或 'ultra'"
        )
    
    created_codes = []
    expires_at = datetime.utcnow() + timedelta(days=data.expires_days) if data.expires_days > 0 else None
    
    for _ in range(data.count):
        code = f"READIT-{secrets.token_hex(4).upper()}"
        
        # 确保唯一
        while True:
            check = await db.execute(
                select(InvitationCode).where(InvitationCode.code == code)
            )
            if not check.scalar_one_or_none():
                break
            code = f"READIT-{secrets.token_hex(4).upper()}"
        
        invitation = InvitationCode(
            id=str(uuid.uuid4()),
            code=code,
            created_by=admin.id,
            creator_plan="admin",
            grant_plan=data.grant_plan,
            grant_days=data.grant_days,
            expires_at=expires_at,
        )
        db.add(invitation)
        created_codes.append(code)
    
    await db.commit()
    
    return {
        "success": True,
        "count": len(created_codes),
        "codes": created_codes,
        "grant_plan": data.grant_plan,
        "grant_days": data.grant_days,
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


@router.delete("/invitation-codes/{code}")
async def admin_delete_invitation_code(
    code: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员删除（禁用）邀请码
    """
    result = await db.execute(
        select(InvitationCode).where(InvitationCode.code == code.upper())
    )
    invitation = result.scalar_one_or_none()
    
    if not invitation:
        raise HTTPException(status_code=404, detail="邀请码不存在")
    
    if invitation.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="已使用的邀请码无法删除"
        )
    
    invitation.is_active = False
    await db.commit()
    
    return {"success": True, "message": "邀请码已删除"}

