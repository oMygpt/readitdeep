"""
Read it DEEP - 认证 API

用户注册、登录、JWT 认证
"""

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from app.core.database import get_db
from app.models.user import User
from app.config import get_settings

router = APIRouter()
security = HTTPBearer()
settings = get_settings()

# JWT 配置
JWT_SECRET = settings.secret_key
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24
JWT_REFRESH_DAYS = 7


# ================== Schemas ==================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    username: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


class UserResponse(BaseModel):
    id: str
    email: str
    username: Optional[str]
    role: str
    is_active: bool
    created_at: Optional[str]


# ================== JWT 工具 ==================

def create_access_token(user_id, role: str) -> str:
    """创建访问令牌"""
    payload = {
        "sub": str(user_id),  # Convert UUID to string
        "role": role,
        "type": "access",
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id) -> str:
    """创建刷新令牌"""
    payload = {
        "sub": str(user_id),  # Convert UUID to string
        "type": "refresh",
        "exp": datetime.utcnow() + timedelta(days=JWT_REFRESH_DAYS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """解码令牌"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 已过期",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Token",
        )


# ================== 依赖注入 ==================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """获取当前登录用户 (依赖注入)"""
    import logging
    logger = logging.getLogger("uvicorn")
    
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except Exception as e:
        logger.error(f"Token decode failed: {str(e)}")
        raise e

    logger.info(f"Token payload: {payload}")
    
    if payload.get("type") != "access":
        logger.warning("Invalid token type")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请使用 access token",
        )
    
    user_id = payload.get("sub")
    logger.info(f"Looking for user_id: {user_id}")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        logger.error(f"User failed to be found in DB: {user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )
    
    if not user.is_active:
        logger.warning(f"User inactive: {user.email}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已禁用",
        )
    
    return user


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    """获取当前管理员用户 (依赖注入)"""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """可选获取当前用户 (非强制认证)"""
    if not credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None


# ================== API 端点 ==================

@router.post("/register", response_model=TokenResponse)
async def register(
    data: UserRegister,
    db: AsyncSession = Depends(get_db),
):
    """
    用户注册
    
    - 第一个用户自动成为管理员
    - 返回 JWT tokens
    """
    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱已被注册",
        )
    
    # 检查是否是第一个用户
    result = await db.execute(select(User).limit(1))
    is_first_user = result.scalar_one_or_none() is None
    
    # 创建用户
    user = User(
        email=data.email,
        username=data.username,
        role="admin" if is_first_user else "user",
    )
    user.set_password(data.password)
    
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    # 生成 tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600,
        user=user.to_dict(),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    data: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """用户登录"""
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    
    if not user or not user.verify_password(data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已禁用",
        )
    
    # 更新最后登录时间
    user.last_login = datetime.utcnow()
    await db.commit()
    
    # 生成 tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600,
        user=user.to_dict(),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """刷新访问令牌"""
    payload = decode_token(credentials.credentials)
    
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请使用 refresh token",
        )
    
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已禁用",
        )
    
    access_token = create_access_token(user.id, user.role)
    new_refresh_token = create_refresh_token(user.id)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600,
        user=user.to_dict(),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    user: User = Depends(get_current_user),
):
    """获取当前用户信息"""
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


@router.post("/change-password")
async def change_password(
    old_password: str,
    new_password: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """修改密码"""
    if not user.verify_password(old_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误",
        )
    
    user.set_password(new_password)
    await db.commit()
    
    return {"message": "密码已修改"}


# ================== 用户配置 API ==================

class UserConfigResponse(BaseModel):
    """用户配置响应 - 完整细粒度配置"""
    # 系统模式 (决定用户是否可以/需要自定义)
    llm_mode: str = "shared"
    translation_mode: str = "shared"
    mineru_mode: str = "shared"
    smart_analysis_mode: str = "inherit"
    
    # 系统是否已提供共享 Key
    system_has_llm_key: bool = False
    system_has_translation_key: bool = False
    system_has_mineru_key: bool = False
    
    # 用户自定义配置 (只返回是否设置，不返回明文)
    # 主 LLM
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key_set: bool = False
    
    # 翻译 LLM
    translation_base_url: str = ""
    translation_model: str = ""
    translation_api_key_set: bool = False
    
    # MinerU
    mineru_api_url: str = ""
    mineru_api_key_set: bool = False
    
    # 智能分析 (每功能独立)
    smart_math_base_url: str = ""
    smart_math_model: str = ""
    smart_math_api_key_set: bool = False
    
    smart_feynman_base_url: str = ""
    smart_feynman_model: str = ""
    smart_feynman_api_key_set: bool = False
    
    smart_deep_base_url: str = ""
    smart_deep_model: str = ""
    smart_deep_api_key_set: bool = False
    
    smart_chat_base_url: str = ""
    smart_chat_model: str = ""
    smart_chat_api_key_set: bool = False


class UserConfigUpdate(BaseModel):
    """更新用户配置 - 完整细粒度配置"""
    # 主 LLM
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    
    # 翻译 LLM
    translation_base_url: Optional[str] = None
    translation_model: Optional[str] = None
    translation_api_key: Optional[str] = None
    
    # MinerU
    mineru_api_url: Optional[str] = None
    mineru_api_key: Optional[str] = None
    
    # 智能分析模式
    smart_analysis_mode: Optional[str] = None  # 'inherit' | 'custom'
    
    # 智能分析 - 每功能独立配置
    smart_math_base_url: Optional[str] = None
    smart_math_model: Optional[str] = None
    smart_math_api_key: Optional[str] = None
    
    smart_feynman_base_url: Optional[str] = None
    smart_feynman_model: Optional[str] = None
    smart_feynman_api_key: Optional[str] = None
    
    smart_deep_base_url: Optional[str] = None
    smart_deep_model: Optional[str] = None
    smart_deep_api_key: Optional[str] = None
    
    smart_chat_base_url: Optional[str] = None
    smart_chat_model: Optional[str] = None
    smart_chat_api_key: Optional[str] = None


class TestApiKeyRequest(BaseModel):
    """测试 API Key 请求"""
    api_type: str  # 'llm' | 'mineru' | 'translation'
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None


class TestApiKeyResponse(BaseModel):
    """测试 API Key 响应"""
    success: bool
    message: str
    details: Optional[dict] = None


@router.get("/config", response_model=UserConfigResponse)
async def get_user_config_endpoint(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取用户配置覆盖"""
    from app.core.config_manager import ConfigManager
    
    user_config = await ConfigManager.get_user_config(db, user.id)
    system_config = await ConfigManager.get_effective_config(db, None)
    
    return UserConfigResponse(
        # 系统模式
        llm_mode=system_config.get("llm_mode", "shared"),
        translation_mode=system_config.get("translation_mode", "shared"),
        mineru_mode=system_config.get("mineru_mode", "shared"),
        smart_analysis_mode=user_config.get("smart_analysis_mode") or system_config.get("smart_analysis_mode", "inherit"),
        
        # 系统共享 Key 状态
        system_has_llm_key=bool(system_config.get("llm_api_key")),
        system_has_translation_key=bool(system_config.get("translation_api_key")),
        system_has_mineru_key=bool(system_config.get("mineru_api_key")),
        
        # 主 LLM (用户配置)
        llm_base_url=user_config.get("llm_base_url", ""),
        llm_model=user_config.get("llm_model", ""),
        llm_api_key_set=bool(user_config.get("llm_api_key")),
        
        # 翻译 LLM (用户配置)
        translation_base_url=user_config.get("translation_base_url", ""),
        translation_model=user_config.get("translation_model", ""),
        translation_api_key_set=bool(user_config.get("translation_api_key")),
        
        # MinerU (用户配置)
        mineru_api_url=user_config.get("mineru_api_url", ""),
        mineru_api_key_set=bool(user_config.get("mineru_api_key")),
        
        # 智能分析 - Math
        smart_math_base_url=user_config.get("smart_math_base_url", ""),
        smart_math_model=user_config.get("smart_math_model", ""),
        smart_math_api_key_set=bool(user_config.get("smart_math_api_key")),
        
        # 智能分析 - Feynman
        smart_feynman_base_url=user_config.get("smart_feynman_base_url", ""),
        smart_feynman_model=user_config.get("smart_feynman_model", ""),
        smart_feynman_api_key_set=bool(user_config.get("smart_feynman_api_key")),
        
        # 智能分析 - Deep
        smart_deep_base_url=user_config.get("smart_deep_base_url", ""),
        smart_deep_model=user_config.get("smart_deep_model", ""),
        smart_deep_api_key_set=bool(user_config.get("smart_deep_api_key")),
        
        # 智能分析 - Chat
        smart_chat_base_url=user_config.get("smart_chat_base_url", ""),
        smart_chat_model=user_config.get("smart_chat_model", ""),
        smart_chat_api_key_set=bool(user_config.get("smart_chat_api_key")),
    )


@router.put("/config", response_model=UserConfigResponse)
async def update_user_config_endpoint(
    data: UserConfigUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新用户配置覆盖"""
    from app.core.config_manager import ConfigManager
    
    updates = data.model_dump(exclude_none=True)
    await ConfigManager.set_user_config(db, user.id, updates)
    
    # Return updated
    return await get_user_config_endpoint(user, db)


@router.post("/config/test", response_model=TestApiKeyResponse)
async def test_api_key_endpoint(
    data: TestApiKeyRequest,
    user: User = Depends(get_current_user),
):
    """
    测试用户提供的 API Key 是否可用
    
    api_type 支持: 'llm', 'mineru', 'translation'
    """
    import httpx
    
    try:
        if data.api_type == 'llm' or data.api_type == 'translation':
            # 测试 OpenAI 兼容 API
            base_url = data.base_url or settings.llm_base_url
            model = data.model or settings.llm_model
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {data.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Hello"}],
                        "max_tokens": 5,
                    },
                )
                
                if response.status_code == 200:
                    return TestApiKeyResponse(
                        success=True,
                        message="API Key 验证成功",
                        details={"model": model},
                    )
                else:
                    return TestApiKeyResponse(
                        success=False,
                        message=f"API 返回错误: {response.status_code}",
                        details={"error": response.text[:200]},
                    )
                    
        elif data.api_type == 'mineru':
            # 测试 MinerU API
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://mineru.net/api/v4/user/info",
                    headers={
                        "Authorization": f"Bearer {data.api_key}",
                    },
                )
                
                if response.status_code == 200:
                    return TestApiKeyResponse(
                        success=True,
                        message="MinerU API Key 验证成功",
                        details=response.json() if response.text else None,
                    )
                else:
                    return TestApiKeyResponse(
                        success=False,
                        message=f"MinerU API 返回错误: {response.status_code}",
                        details={"error": response.text[:200]},
                    )
        else:
            return TestApiKeyResponse(
                success=False,
                message=f"未知的 API 类型: {data.api_type}",
            )
            
    except httpx.TimeoutException:
        return TestApiKeyResponse(
            success=False,
            message="请求超时，请检查网络连接",
        )
    except Exception as e:
        return TestApiKeyResponse(
            success=False,
            message=f"测试失败: {str(e)}",
        )

