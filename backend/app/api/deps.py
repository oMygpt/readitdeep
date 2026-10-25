"""
Read it DEEP - 路由共用的鉴权与配额依赖

所有带 paper_id 的路由都经过这里，不在各自文件里重写一遍归属判断：
- require_paper_access: 所有者 / 管理员 / 论文被分享到的团队成员
- require_paper_owner:  所有者 / 管理员 (改元数据、删论文等)
- require_ai_quota:     触发 LLM 的路由按**调用者**计 AI 配额

没有 user_id 的历史论文只有管理员可见 (旧版本把它们当作公开)。
"""

from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import select

from app.api.v1.auth import get_current_user
from app.core.database import async_session_maker
from app.core.store import store
from app.models.user import User


def get_paper_or_404(paper_id: str) -> dict:
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "论文不存在")
    return paper


async def user_can_access_paper(paper_id: str, paper: dict, user: Optional[User]) -> bool:
    if user is None:
        return False
    if user.is_admin:
        return True
    owner = paper.get("user_id")
    if not owner:
        return False
    if owner == user.id:
        return True

    from app.models.team import PaperShare, TeamMember

    async with async_session_maker() as db:
        result = await db.execute(
            select(PaperShare.id)
            .join(TeamMember, PaperShare.team_id == TeamMember.team_id)
            .where(PaperShare.paper_id == paper_id, TeamMember.user_id == user.id)
            .limit(1)
        )
        return result.first() is not None


async def require_paper_access(
    paper_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """返回论文 dict；无权访问时 403，不存在时 404。"""
    paper = get_paper_or_404(paper_id)
    if not await user_can_access_paper(paper_id, paper, current_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权访问此论文")
    return paper


async def require_paper_owner(
    paper_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    paper = get_paper_or_404(paper_id)
    if not (current_user.is_admin or (paper.get("user_id") and paper["user_id"] == current_user.id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有论文所有者可以执行此操作")
    return paper


async def charge_ai_quota(user_id: str) -> None:
    """检查并预扣一次 AI 配额；用完时 403 quota_exceeded（与上传配额同一格式）。"""
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")
        user.reset_daily_quota_if_needed()
        if not user.can_use_ai:
            await db.commit()
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "quota_exceeded",
                    "message": "AI 配额已用完，请升级或等待配额重置",
                    "quota": user.get_quota_status(),
                },
            )
        user.increment_ai_usage()
        await db.commit()


async def require_ai_quota(current_user: User = Depends(get_current_user)) -> User:
    await charge_ai_quota(current_user.id)
    return current_user
