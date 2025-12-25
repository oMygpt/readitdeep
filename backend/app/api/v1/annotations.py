"""
Read it DEEP - Annotations API

团队标注功能：高亮、笔记、讨论
"""

from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import logging

from app.core.database import get_db
from app.models.user import User
from app.models.annotation import TeamAnnotation, AnnotationType, AnnotationVisibility
from app.models.team import TeamMember, PaperShare
from app.api.v1.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


# ================== Schemas ==================

class AnnotationCreate(BaseModel):
    """创建标注"""
    type: str = AnnotationType.HIGHLIGHT
    visibility: str = AnnotationVisibility.PRIVATE
    team_id: Optional[str] = None
    
    # 位置 (高亮)
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    line_number: Optional[int] = None
    selected_text: Optional[str] = None
    
    # 内容
    content: Optional[str] = None
    color: Optional[str] = None


class AnnotationUpdate(BaseModel):
    """更新标注"""
    content: Optional[str] = None
    color: Optional[str] = None
    visibility: Optional[str] = None


class AnnotationReply(BaseModel):
    """回复标注"""
    content: str
    visibility: str = AnnotationVisibility.TEAM


class UserInfo(BaseModel):
    """用户信息"""
    id: str
    email: Optional[str] = None
    username: Optional[str] = None


class AnnotationResponse(BaseModel):
    """标注响应"""
    id: str
    paper_id: str
    team_id: Optional[str]
    user_id: str
    user: Optional[UserInfo] = None
    type: str
    visibility: str
    start_offset: Optional[int]
    end_offset: Optional[int]
    line_number: Optional[int]
    selected_text: Optional[str]
    content: Optional[str]
    color: Optional[str]
    parent_id: Optional[str]
    replies_count: int = 0
    created_at: Optional[str]
    updated_at: Optional[str]


# ================== Helper Functions ==================

async def check_paper_access(db: AsyncSession, paper_id: str, user_id: str, team_id: Optional[str] = None) -> bool:
    """
    检查用户是否有权限访问论文的标注
    
    条件：
    1. 是论文所有者 (TODO: 需要论文表)
    2. 是论文所分享团队的成员
    """
    if team_id:
        # 检查是否是团队成员
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id
            )
        )
        if result.scalar_one_or_none():
            return True
    
    # 检查是否是论文分享团队的成员
    result = await db.execute(
        select(PaperShare)
        .join(TeamMember, PaperShare.team_id == TeamMember.team_id)
        .where(
            PaperShare.paper_id == paper_id,
            TeamMember.user_id == user_id
        )
    )
    return result.scalar_one_or_none() is not None


async def get_annotation_or_404(db: AsyncSession, annotation_id: str) -> TeamAnnotation:
    """获取标注或抛出 404"""
    result = await db.execute(
        select(TeamAnnotation).where(TeamAnnotation.id == annotation_id)
    )
    annotation = result.scalar_one_or_none()
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="标注不存在"
        )
    return annotation


# ================== API Endpoints ==================

@router.get("/papers/{paper_id}/annotations", response_model=List[AnnotationResponse])
async def list_annotations(
    paper_id: str,
    team_id: Optional[str] = Query(None, description="团队 ID (不传则获取个人标注)"),
    type: Optional[str] = Query(None, description="标注类型: highlight, note, comment"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取论文标注列表
    
    返回条件：
    - 如果指定 team_id: 返回该团队的"团队可见"标注
    - 如果不指定 team_id: 返回用户自己的个人标注
    """
    # 构建查询条件
    conditions = [TeamAnnotation.paper_id == paper_id]
    
    if team_id:
        # 团队标注：返回该团队的所有团队可见标注
        # 权限检查
        has_access = await check_paper_access(db, paper_id, user.id, team_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权访问该团队的标注"
            )
        
        conditions.append(TeamAnnotation.team_id == team_id)
        conditions.append(TeamAnnotation.visibility == AnnotationVisibility.TEAM)
    else:
        # 个人标注：返回用户自己的所有标注
        conditions.append(TeamAnnotation.user_id == user.id)
    
    # 可选：按类型筛选
    if type:
        conditions.append(TeamAnnotation.type == type)
    
    # 只返回顶层标注 (非回复)
    conditions.append(TeamAnnotation.parent_id == None)
    
    # 查询
    result = await db.execute(
        select(TeamAnnotation, User)
        .outerjoin(User, TeamAnnotation.user_id == User.id)
        .where(*conditions)
        .order_by(TeamAnnotation.created_at.desc())
    )
    rows = result.all()
    
    # 获取回复数量
    annotations = []
    for annotation, annotation_user in rows:
        # 计算回复数
        reply_result = await db.execute(
            select(TeamAnnotation)
            .where(TeamAnnotation.parent_id == annotation.id)
        )
        replies_count = len(reply_result.scalars().all())
        
        annotations.append(AnnotationResponse(
            id=annotation.id,
            paper_id=annotation.paper_id,
            team_id=annotation.team_id,
            user_id=annotation.user_id,
            user=UserInfo(
                id=annotation_user.id,
                email=annotation_user.email,
                username=annotation_user.username
            ) if annotation_user else None,
            type=annotation.type,
            visibility=annotation.visibility,
            start_offset=annotation.start_offset,
            end_offset=annotation.end_offset,
            line_number=annotation.line_number,
            selected_text=annotation.selected_text,
            content=annotation.content,
            color=annotation.color,
            parent_id=annotation.parent_id,
            replies_count=replies_count,
            created_at=annotation.created_at.isoformat() if annotation.created_at else None,
            updated_at=annotation.updated_at.isoformat() if annotation.updated_at else None,
        ))
    
    return annotations


@router.post("/papers/{paper_id}/annotations", response_model=AnnotationResponse)
async def create_annotation(
    paper_id: str,
    data: AnnotationCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建标注"""
    # 验证类型
    if data.type not in (AnnotationType.HIGHLIGHT, AnnotationType.NOTE, AnnotationType.COMMENT):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的标注类型"
        )
    
    # 验证可见性
    if data.visibility not in (AnnotationVisibility.PRIVATE, AnnotationVisibility.TEAM):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的可见性设置"
        )
    
    # 如果是团队可见，必须指定 team_id
    if data.visibility == AnnotationVisibility.TEAM and not data.team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="团队可见标注必须指定 team_id"
        )
    
    # 权限检查
    if data.team_id:
        has_access = await check_paper_access(db, paper_id, user.id, data.team_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权在该团队创建标注"
            )
    
    # 创建标注
    annotation = TeamAnnotation(
        paper_id=paper_id,
        team_id=data.team_id,
        user_id=user.id,
        type=data.type,
        visibility=data.visibility,
        start_offset=data.start_offset,
        end_offset=data.end_offset,
        line_number=data.line_number,
        selected_text=data.selected_text,
        content=data.content,
        color=data.color,
    )
    
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    
    logger.info(f"Annotation created: {annotation.id} by user {user.id}")
    
    return AnnotationResponse(
        id=annotation.id,
        paper_id=annotation.paper_id,
        team_id=annotation.team_id,
        user_id=annotation.user_id,
        user=UserInfo(id=user.id, email=user.email, username=user.username),
        type=annotation.type,
        visibility=annotation.visibility,
        start_offset=annotation.start_offset,
        end_offset=annotation.end_offset,
        line_number=annotation.line_number,
        selected_text=annotation.selected_text,
        content=annotation.content,
        color=annotation.color,
        parent_id=annotation.parent_id,
        replies_count=0,
        created_at=annotation.created_at.isoformat() if annotation.created_at else None,
        updated_at=annotation.updated_at.isoformat() if annotation.updated_at else None,
    )


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: str,
    data: AnnotationUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新标注 (仅创建者可更新)"""
    annotation = await get_annotation_or_404(db, annotation_id)
    
    # 权限检查：只有创建者可以更新
    if annotation.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有标注创建者可以更新"
        )
    
    # 更新字段
    if data.content is not None:
        annotation.content = data.content
    if data.color is not None:
        annotation.color = data.color
    if data.visibility is not None:
        if data.visibility not in (AnnotationVisibility.PRIVATE, AnnotationVisibility.TEAM):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无效的可见性设置"
            )
        annotation.visibility = data.visibility
    
    await db.commit()
    await db.refresh(annotation)
    
    return AnnotationResponse(
        id=annotation.id,
        paper_id=annotation.paper_id,
        team_id=annotation.team_id,
        user_id=annotation.user_id,
        user=UserInfo(id=user.id, email=user.email, username=user.username),
        type=annotation.type,
        visibility=annotation.visibility,
        start_offset=annotation.start_offset,
        end_offset=annotation.end_offset,
        line_number=annotation.line_number,
        selected_text=annotation.selected_text,
        content=annotation.content,
        color=annotation.color,
        parent_id=annotation.parent_id,
        replies_count=0,
        created_at=annotation.created_at.isoformat() if annotation.created_at else None,
        updated_at=annotation.updated_at.isoformat() if annotation.updated_at else None,
    )


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除标注 (创建者或团队管理员可删除)"""
    annotation = await get_annotation_or_404(db, annotation_id)
    
    # 权限检查
    can_delete = annotation.user_id == user.id
    
    if not can_delete and annotation.team_id:
        # 检查是否是团队管理员
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.team_id == annotation.team_id,
                TeamMember.user_id == user.id,
                TeamMember.role.in_(["owner", "admin"])
            )
        )
        can_delete = result.scalar_one_or_none() is not None
    
    if not can_delete:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除此标注"
        )
    
    await db.delete(annotation)
    await db.commit()
    
    logger.info(f"Annotation deleted: {annotation_id} by user {user.id}")
    
    return {"message": "标注已删除"}


@router.post("/annotations/{annotation_id}/reply", response_model=AnnotationResponse)
async def reply_to_annotation(
    annotation_id: str,
    data: AnnotationReply,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """回复标注"""
    parent = await get_annotation_or_404(db, annotation_id)
    
    # 权限检查
    if parent.team_id:
        has_access = await check_paper_access(db, parent.paper_id, user.id, parent.team_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权回复此标注"
            )
    elif parent.user_id != user.id:
        # 个人标注只能自己回复
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权回复此标注"
        )
    
    # 创建回复
    reply = TeamAnnotation(
        paper_id=parent.paper_id,
        team_id=parent.team_id,
        user_id=user.id,
        type=AnnotationType.COMMENT,
        visibility=data.visibility,
        content=data.content,
        parent_id=annotation_id,
    )
    
    db.add(reply)
    await db.commit()
    await db.refresh(reply)
    
    logger.info(f"Reply created: {reply.id} to annotation {annotation_id} by user {user.id}")
    
    return AnnotationResponse(
        id=reply.id,
        paper_id=reply.paper_id,
        team_id=reply.team_id,
        user_id=reply.user_id,
        user=UserInfo(id=user.id, email=user.email, username=user.username),
        type=reply.type,
        visibility=reply.visibility,
        start_offset=reply.start_offset,
        end_offset=reply.end_offset,
        line_number=reply.line_number,
        selected_text=reply.selected_text,
        content=reply.content,
        color=reply.color,
        parent_id=reply.parent_id,
        replies_count=0,
        created_at=reply.created_at.isoformat() if reply.created_at else None,
        updated_at=reply.updated_at.isoformat() if reply.updated_at else None,
    )


@router.get("/annotations/{annotation_id}/replies", response_model=List[AnnotationResponse])
async def get_annotation_replies(
    annotation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取标注的所有回复"""
    parent = await get_annotation_or_404(db, annotation_id)
    
    # 权限检查
    if parent.team_id:
        has_access = await check_paper_access(db, parent.paper_id, user.id, parent.team_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权查看此标注的回复"
            )
    elif parent.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看此标注的回复"
        )
    
    # 查询回复
    result = await db.execute(
        select(TeamAnnotation, User)
        .outerjoin(User, TeamAnnotation.user_id == User.id)
        .where(TeamAnnotation.parent_id == annotation_id)
        .order_by(TeamAnnotation.created_at.asc())
    )
    rows = result.all()
    
    replies = []
    for reply, reply_user in rows:
        replies.append(AnnotationResponse(
            id=reply.id,
            paper_id=reply.paper_id,
            team_id=reply.team_id,
            user_id=reply.user_id,
            user=UserInfo(
                id=reply_user.id,
                email=reply_user.email,
                username=reply_user.username
            ) if reply_user else None,
            type=reply.type,
            visibility=reply.visibility,
            start_offset=reply.start_offset,
            end_offset=reply.end_offset,
            line_number=reply.line_number,
            selected_text=reply.selected_text,
            content=reply.content,
            color=reply.color,
            parent_id=reply.parent_id,
            replies_count=0,
            created_at=reply.created_at.isoformat() if reply.created_at else None,
            updated_at=reply.updated_at.isoformat() if reply.updated_at else None,
        ))
    
    return replies
