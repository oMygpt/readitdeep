"""
Read it DEEP - Teams API

团队管理、成员管理、论文分享
"""

from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import logging

from app.core.database import get_db
from app.models.user import User
from app.models.team import Team, TeamMember, TeamInvitation, PaperShare, TeamRole
from app.api.v1.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


# ================== Schemas ==================

class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None


class TeamResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    avatar_url: Optional[str]
    created_by: Optional[str]
    created_at: Optional[str]
    member_count: int = 0
    my_role: Optional[str] = None


class TeamMemberResponse(BaseModel):
    id: str
    user_id: str
    email: str
    username: Optional[str]
    role: str
    joined_at: Optional[str]


class InvitationCreate(BaseModel):
    max_uses: int = 0  # 0 = 无限
    expires_days: int = 7


class InvitationResponse(BaseModel):
    id: str
    invite_code: str
    max_uses: int
    used_count: int
    expires_at: Optional[str]
    is_valid: bool
    created_at: Optional[str]


class PaperShareCreate(BaseModel):
    team_id: str


class PaperShareResponse(BaseModel):
    id: str
    paper_id: str
    team_id: str
    team_name: str
    shared_by: Optional[str]
    shared_at: Optional[str]


# ================== Helper Functions ==================

async def get_team_or_404(db: AsyncSession, team_id: str) -> Team:
    """获取团队或抛出 404"""
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="团队不存在"
        )
    return team


async def get_member_or_403(db: AsyncSession, team_id: str, user_id: str) -> TeamMember:
    """获取成员或抛出 403 (不是团队成员)"""
    result = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您不是该团队成员"
        )
    return member


async def require_team_admin(db: AsyncSession, team_id: str, user_id: str) -> TeamMember:
    """要求是团队管理员"""
    member = await get_member_or_403(db, team_id, user_id)
    if not member.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要团队管理员权限"
        )
    return member


async def require_team_owner(db: AsyncSession, team_id: str, user_id: str) -> TeamMember:
    """要求是团队创建者"""
    member = await get_member_or_403(db, team_id, user_id)
    if not member.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要团队创建者权限"
        )
    return member


# ================== Team CRUD ==================

@router.post("", response_model=TeamResponse)
async def create_team(
    data: TeamCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建团队"""
    # 创建团队
    team = Team(
        name=data.name,
        description=data.description,
        created_by=user.id,
    )
    db.add(team)
    await db.flush()
    
    # 添加创建者为 Owner
    member = TeamMember(
        team_id=team.id,
        user_id=user.id,
        role=TeamRole.OWNER,
    )
    db.add(member)
    await db.commit()
    
    logger.info(f"Team created: {team.id} by user {user.id}")
    
    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        avatar_url=team.avatar_url,
        created_by=team.created_by,
        created_at=team.created_at.isoformat() if team.created_at else None,
        member_count=1,
        my_role=TeamRole.OWNER,
    )


@router.get("", response_model=List[TeamResponse])
async def list_my_teams(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我加入的所有团队"""
    # 查询用户的所有团队成员关系
    result = await db.execute(
        select(TeamMember)
        .options(selectinload(TeamMember.team))
        .where(TeamMember.user_id == user.id)
    )
    memberships = result.scalars().all()
    
    teams = []
    for membership in memberships:
        team = membership.team
        # 获取成员数量
        count_result = await db.execute(
            select(func.count(TeamMember.id)).where(TeamMember.team_id == team.id)
        )
        member_count = count_result.scalar() or 0
        
        teams.append(TeamResponse(
            id=team.id,
            name=team.name,
            description=team.description,
            avatar_url=team.avatar_url,
            created_by=team.created_by,
            created_at=team.created_at.isoformat() if team.created_at else None,
            member_count=member_count,
            my_role=membership.role,
        ))
    
    return teams


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取团队详情"""
    team = await get_team_or_404(db, team_id)
    membership = await get_member_or_403(db, team_id, user.id)
    
    # 获取成员数量
    count_result = await db.execute(
        select(func.count(TeamMember.id)).where(TeamMember.team_id == team_id)
    )
    member_count = count_result.scalar() or 0
    
    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        avatar_url=team.avatar_url,
        created_by=team.created_by,
        created_at=team.created_at.isoformat() if team.created_at else None,
        member_count=member_count,
        my_role=membership.role,
    )


@router.put("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: str,
    data: TeamUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新团队信息 (需要管理员权限)"""
    team = await get_team_or_404(db, team_id)
    await require_team_admin(db, team_id, user.id)
    
    if data.name is not None:
        team.name = data.name
    if data.description is not None:
        team.description = data.description
    if data.avatar_url is not None:
        team.avatar_url = data.avatar_url
    
    await db.commit()
    
    return await get_team(team_id, user, db)


@router.delete("/{team_id}")
async def delete_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除团队 (仅创建者可操作)"""
    team = await get_team_or_404(db, team_id)
    await require_team_owner(db, team_id, user.id)
    
    await db.delete(team)
    await db.commit()
    
    logger.info(f"Team deleted: {team_id} by user {user.id}")
    
    return {"message": "团队已删除"}


# ================== Member Management ==================

@router.get("/{team_id}/members", response_model=List[TeamMemberResponse])
async def list_team_members(
    team_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取团队成员列表"""
    await get_team_or_404(db, team_id)
    await get_member_or_403(db, team_id, user.id)
    
    # 联表查询成员和用户信息
    result = await db.execute(
        select(TeamMember, User)
        .join(User, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team_id)
        .order_by(TeamMember.joined_at)
    )
    rows = result.all()
    
    return [
        TeamMemberResponse(
            id=member.id,
            user_id=member.user_id,
            email=member_user.email,
            username=member_user.username,
            role=member.role,
            joined_at=member.joined_at.isoformat() if member.joined_at else None,
        )
        for member, member_user in rows
    ]


@router.put("/{team_id}/members/{user_id}")
async def update_member_role(
    team_id: str,
    user_id: str,
    role: str = Query(..., description="新角色: admin, member, guest"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新成员角色 (需要管理员权限)"""
    await get_team_or_404(db, team_id)
    await require_team_admin(db, team_id, user.id)
    
    # 不能修改 Owner 的角色
    result = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id
        )
    )
    target_member = result.scalar_one_or_none()
    
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="成员不存在"
        )
    
    if target_member.is_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法修改创建者的角色"
        )
    
    if role not in (TeamRole.ADMIN, TeamRole.MEMBER, TeamRole.GUEST):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的角色"
        )
    
    target_member.role = role
    await db.commit()
    
    return {"message": f"已将成员角色更新为 {role}"}


@router.delete("/{team_id}/members/{user_id}")
async def remove_member(
    team_id: str,
    user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """移除成员 (管理员可移除其他人，任何人可退出)"""
    await get_team_or_404(db, team_id)
    my_membership = await get_member_or_403(db, team_id, user.id)
    
    # 查找目标成员
    result = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id
        )
    )
    target_member = result.scalar_one_or_none()
    
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="成员不存在"
        )
    
    # Owner 不能被移除
    if target_member.is_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法移除团队创建者"
        )
    
    # 检查权限：管理员可以移除其他人，或者自己退出
    if user_id != user.id and not my_membership.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能移除其他成员"
        )
    
    await db.delete(target_member)
    await db.commit()
    
    action = "已退出团队" if user_id == user.id else "已移除成员"
    return {"message": action}


# ================== Invitation ==================

@router.post("/{team_id}/invite", response_model=InvitationResponse)
async def create_invitation(
    team_id: str,
    data: InvitationCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """生成邀请链接 (需要管理员权限)"""
    await get_team_or_404(db, team_id)
    await require_team_admin(db, team_id, user.id)
    
    expires_at = None
    if data.expires_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)
    
    invitation = TeamInvitation(
        team_id=team_id,
        created_by=user.id,
        max_uses=data.max_uses,
        expires_at=expires_at,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    
    return InvitationResponse(
        id=invitation.id,
        invite_code=invitation.invite_code,
        max_uses=invitation.max_uses,
        used_count=invitation.used_count,
        expires_at=invitation.expires_at.isoformat() if invitation.expires_at else None,
        is_valid=invitation.is_valid,
        created_at=invitation.created_at.isoformat() if invitation.created_at else None,
    )


@router.post("/join/{invite_code}")
async def join_team_by_code(
    invite_code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """通过邀请码加入团队"""
    # 查找邀请
    result = await db.execute(
        select(TeamInvitation)
        .options(selectinload(TeamInvitation.team))
        .where(TeamInvitation.invite_code == invite_code)
    )
    invitation = result.scalar_one_or_none()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="无效的邀请码"
        )
    
    if not invitation.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码已过期或已达使用上限"
        )
    
    # 检查是否已是成员
    result = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == invitation.team_id,
            TeamMember.user_id == user.id
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="您已是该团队成员"
        )
    
    # 添加成员
    member = TeamMember(
        team_id=invitation.team_id,
        user_id=user.id,
        role=TeamRole.MEMBER,
    )
    db.add(member)
    
    # 更新邀请使用次数
    invitation.used_count += 1
    
    await db.commit()
    
    logger.info(f"User {user.id} joined team {invitation.team_id} via invitation")
    
    return {
        "message": f"成功加入团队 {invitation.team.name}",
        "team_id": invitation.team_id,
        "team_name": invitation.team.name,
    }


# ================== Paper Sharing ==================

@router.post("/papers/{paper_id}/share", response_model=PaperShareResponse)
async def share_paper_to_team(
    paper_id: str,
    data: PaperShareCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """分享论文到团队"""
    from app.core.store import store
    
    # 从内存 store 验证论文存在且属于用户
    paper = store.get(paper_id)
    
    logger.info(f"Share paper attempt: paper_id={paper_id}, user_id={user.id}")
    
    if not paper:
        logger.warning(f"Paper not found in store: {paper_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"论文不存在 (ID: {paper_id})"
        )
    
    paper_user_id = paper.get("user_id")
    logger.info(f"Paper found: id={paper_id}, owner={paper_user_id}, current_user={user.id}")
    
    if paper_user_id != user.id:
        logger.warning(f"Paper ownership mismatch: paper.user_id={paper_user_id}, current_user={user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"只能分享自己的论文"
        )
    
    # 验证团队存在且用户是成员
    team = await get_team_or_404(db, data.team_id)
    await get_member_or_403(db, data.team_id, user.id)
    
    # 检查是否已分享
    result = await db.execute(
        select(PaperShare).where(
            PaperShare.paper_id == paper_id,
            PaperShare.team_id == data.team_id
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该论文已分享到此团队"
        )
    
    # 创建分享
    share = PaperShare(
        paper_id=paper_id,
        team_id=data.team_id,
        shared_by=user.id,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    
    logger.info(f"Paper {paper_id} shared to team {data.team_id} by user {user.id}")
    
    return PaperShareResponse(
        id=share.id,
        paper_id=share.paper_id,
        team_id=share.team_id,
        team_name=team.name,
        shared_by=share.shared_by,
        shared_at=share.shared_at.isoformat() if share.shared_at else None,
    )


@router.get("/{team_id}/papers")
async def list_team_papers(
    team_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取团队论文列表"""
    from app.models.paper import Paper
    from app.core.store import store
    
    await get_team_or_404(db, team_id)
    await get_member_or_403(db, team_id, user.id)
    
    # 使用 LEFT JOIN，允许 Paper 表记录不存在的情况
    result = await db.execute(
        select(PaperShare, Paper, User)
        .outerjoin(Paper, PaperShare.paper_id == Paper.id)
        .outerjoin(User, PaperShare.shared_by == User.id)
        .where(PaperShare.team_id == team_id)
        .order_by(PaperShare.shared_at.desc())
    )
    rows = result.all()
    
    papers = []
    for share, paper, sharer in rows:
        # 优先使用数据库记录，不存在则 fallback 到 store
        if paper:
            paper_data = {
                "id": paper.id,
                "title": paper.title,
                "filename": paper.filename,
                "status": paper.status,
                "category": paper.category,
                "created_at": paper.created_at.isoformat() if paper.created_at else None,
            }
        else:
            # Fallback: 从内存 store 获取
            store_paper = store.get(share.paper_id)
            if store_paper:
                created_at = store_paper.get("created_at")
                if created_at and hasattr(created_at, 'isoformat'):
                    created_at = created_at.isoformat()
                paper_data = {
                    "id": store_paper["id"],
                    "title": store_paper.get("title"),
                    "filename": store_paper.get("filename", "Unknown"),
                    "status": store_paper.get("status", "unknown"),
                    "category": store_paper.get("category"),
                    "created_at": created_at,
                }
            else:
                # 论文既不在数据库也不在 store，跳过
                logger.warning(f"Paper {share.paper_id} not found in DB or store")
                continue
        
        paper_data["shared_by"] = {
            "id": sharer.id if sharer else None,
            "email": sharer.email if sharer else None,
            "username": sharer.username if sharer else None,
        } if sharer else None
        paper_data["shared_at"] = share.shared_at.isoformat() if share.shared_at else None
        
        papers.append(paper_data)
    
    return {"papers": papers, "total": len(papers)}


@router.delete("/papers/{paper_id}/share/{team_id}")
async def unshare_paper(
    paper_id: str,
    team_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消论文分享"""
    # 查找分享记录
    result = await db.execute(
        select(PaperShare).where(
            PaperShare.paper_id == paper_id,
            PaperShare.team_id == team_id
        )
    )
    share = result.scalar_one_or_none()
    
    if not share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="分享记录不存在"
        )
    
    # 检查权限：分享者本人或团队管理员
    if share.shared_by != user.id:
        await require_team_admin(db, team_id, user.id)
    
    await db.delete(share)
    await db.commit()
    
    return {"message": "已取消分享"}
