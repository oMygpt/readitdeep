"""
Read it DEEP - 用户偏好（设计 2026-10-27 v0.2 §5 用户层）

GET/PUT /api/v1/preferences：翻译目标语言、译文风格、术语表、解析质量、自动翻译。
两种部署模式都可用；linked 模式下这是用户唯一能改的处理配置。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.config_manager import ConfigManager
from app.core.config_policy import TARGET_LANGS, clean_preferences, is_linked, preferences_of
from app.core.database import get_db
from app.models.user import User

router = APIRouter()


async def _response(db: AsyncSession, user: User) -> dict:
    stored = await ConfigManager.get_user_config(db, user.id)
    return {
        "preferences": preferences_of(stored),
        "languages": TARGET_LANGS,
        "managed_by_site": is_linked(),  # 前端据此隐藏 Key / 地址设置
    }


@router.get("/preferences")
async def get_preferences(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _response(db, user)


@router.put("/preferences")
async def update_preferences(updates: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        cleaned = clean_preferences(updates)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await ConfigManager.set_user_config(db, user.id, cleaned)
    return await _response(db, user)
