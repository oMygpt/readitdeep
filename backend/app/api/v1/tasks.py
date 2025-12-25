"""
阅读任务 API (Reading Tasks API)

团队阅读任务管理：
- 任务 CRUD
- 任务分配
- 总结提交
"""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, and_

from app.core.database import get_db
from app.api.v1.auth import get_optional_user, get_current_user
from app.models import (
    User, Team, TeamMember, Paper, TeamRole,
    ReadingTask, TaskAssignee, TaskStatus, AssigneeStatus, TaskPriority
)


router = APIRouter(prefix="/tasks", tags=["tasks"])


# ================== Pydantic Models ==================

class CreateTaskRequest(BaseModel):
    """创建任务请求"""
    paper_id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    priority: Optional[TaskPriority] = TaskPriority.MEDIUM
    due_date: Optional[datetime] = None
    assignee_ids: Optional[List[str]] = None  # 初始分配的用户 ID


class UpdateTaskRequest(BaseModel):
    """更新任务请求"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    due_date: Optional[datetime] = None


class AssignTaskRequest(BaseModel):
    """分配任务请求"""
    user_ids: List[str] = Field(..., min_items=1)


class SubmitSummaryRequest(BaseModel):
    """提交总结请求"""
    summary: str = Field(..., min_length=1)
    summary_structure: Optional[dict] = None  # 结构化总结 (贡献/方法/局限性)


class TaskResponse(BaseModel):
    """任务响应"""
    id: str
    team_id: str
    paper_id: Optional[str]
    created_by: str
    title: str
    description: Optional[str]
    status: str
    priority: str
    due_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]
    assignees: List[dict]
    assignee_count: int
    
    class Config:
        from_attributes = True


# ================== Helper Functions ==================

async def check_team_membership(db: AsyncSession, team_id: str, user_id: str) -> TeamMember:
    """检查用户是否是团队成员"""
    result = await db.execute(
        select(TeamMember).where(
            and_(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        )
    )
    member = result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(status_code=403, detail="Not a team member")
    return member


async def check_team_admin(db: AsyncSession, team_id: str, user_id: str) -> TeamMember:
    """检查用户是否是团队管理员"""
    member = await check_team_membership(db, team_id, user_id)
    if member.role not in (TeamRole.OWNER, TeamRole.ADMIN):
        raise HTTPException(status_code=403, detail="Admin permission required")
    return member


# ================== Team Tasks Endpoints ==================

@router.get("/teams/{team_id}/tasks", response_model=List[TaskResponse])
async def list_team_tasks(
    team_id: str,
    status: Optional[TaskStatus] = None,
    priority: Optional[TaskPriority] = None,
    assignee_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取团队任务列表"""
    # 检查权限
    await check_team_membership(db, team_id, str(current_user.id))
    
    # 构建查询
    query = select(ReadingTask).where(ReadingTask.team_id == team_id)
    
    if status:
        query = query.where(ReadingTask.status == status)
    if priority:
        query = query.where(ReadingTask.priority == priority)
    if assignee_id:
        query = query.join(TaskAssignee).where(TaskAssignee.user_id == assignee_id)
    
    query = query.options(selectinload(ReadingTask.assignees))
    query = query.order_by(ReadingTask.created_at.desc())
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    return [task.to_dict() for task in tasks]


@router.post("/teams/{team_id}/tasks", response_model=TaskResponse)
async def create_task(
    team_id: str,
    request: CreateTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """创建阅读任务"""
    # 检查权限 (只有管理员可以创建任务)
    await check_team_admin(db, team_id, str(current_user.id))
    
    # 验证论文 (如果有)
    if request.paper_id:
        result = await db.execute(select(Paper).where(Paper.id == request.paper_id))
        paper = result.scalar_one_or_none()
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
    
    # 创建任务
    task = ReadingTask(
        team_id=team_id,
        paper_id=request.paper_id,
        created_by=current_user.id,
        title=request.title,
        description=request.description,
        priority=request.priority or TaskPriority.MEDIUM,
        due_date=request.due_date,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    await db.flush()  # 获取 task.id
    
    # 初始分配
    if request.assignee_ids:
        for user_id in request.assignee_ids:
            # 验证用户是团队成员
            result = await db.execute(
                select(TeamMember).where(
                    and_(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
                )
            )
            member = result.scalar_one_or_none()
            
            if member:
                assignee = TaskAssignee(
                    task_id=task.id,
                    user_id=user_id,
                    assigned_by=current_user.id,
                    status=AssigneeStatus.ASSIGNED,
                )
                db.add(assignee)
    
    await db.commit()
    await db.refresh(task)
    
    return task.to_dict()


# ================== Single Task Endpoints ==================

@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取任务详情"""
    result = await db.execute(
        select(ReadingTask)
        .where(ReadingTask.id == task_id)
        .options(selectinload(ReadingTask.assignees))
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限
    await check_team_membership(db, task.team_id, str(current_user.id))
    
    return task.to_dict()


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    request: UpdateTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新任务"""
    result = await db.execute(select(ReadingTask).where(ReadingTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限 (只有管理员或创建者可以更新)
    member = await check_team_membership(db, task.team_id, str(current_user.id))
    if not (member.is_admin or str(task.created_by) == str(current_user.id)):
        raise HTTPException(status_code=403, detail="Permission denied")
    
    # 更新字段
    if request.title is not None:
        task.title = request.title
    if request.description is not None:
        task.description = request.description
    if request.priority is not None:
        task.priority = request.priority
    if request.due_date is not None:
        task.due_date = request.due_date
    if request.status is not None:
        task.status = request.status
        if request.status == TaskStatus.COMPLETED:
            task.completed_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(task)
    
    return task.to_dict()


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除任务"""
    result = await db.execute(select(ReadingTask).where(ReadingTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限 (只有管理员或创建者可以删除)
    member = await check_team_membership(db, task.team_id, str(current_user.id))
    if not (member.is_admin or str(task.created_by) == str(current_user.id)):
        raise HTTPException(status_code=403, detail="Permission denied")
    
    await db.delete(task)
    await db.commit()
    
    return {"message": "Task deleted"}


# ================== Assignment Endpoints ==================

@router.post("/{task_id}/assign")
async def assign_task(
    task_id: str,
    request: AssignTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """分配任务给用户"""
    result = await db.execute(select(ReadingTask).where(ReadingTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限
    await check_team_admin(db, task.team_id, str(current_user.id))
    
    assigned = []
    for uid in request.user_ids:
        # 检查是否已分配
        existing_result = await db.execute(
            select(TaskAssignee).where(
                and_(TaskAssignee.task_id == task_id, TaskAssignee.user_id == uid)
            )
        )
        existing = existing_result.scalar_one_or_none()
        
        if existing:
            continue
        
        # 验证用户是团队成员
        member_result = await db.execute(
            select(TeamMember).where(
                and_(TeamMember.team_id == task.team_id, TeamMember.user_id == uid)
            )
        )
        member = member_result.scalar_one_or_none()
        
        if not member:
            continue
        
        assignee = TaskAssignee(
            task_id=task_id,
            user_id=uid,
            assigned_by=current_user.id,
            status=AssigneeStatus.ASSIGNED,
        )
        db.add(assignee)
        assigned.append(uid)
    
    # 更新任务状态
    if task.status == TaskStatus.PENDING and assigned:
        task.status = TaskStatus.IN_PROGRESS
    
    await db.commit()
    
    return {"message": f"Assigned to {len(assigned)} users", "assigned": assigned}


@router.delete("/{task_id}/assignees/{user_id}")
async def unassign_task(
    task_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """取消分配"""
    result = await db.execute(select(ReadingTask).where(ReadingTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限 (管理员或本人可以取消分配)
    member = await check_team_membership(db, task.team_id, str(current_user.id))
    if not (member.is_admin or user_id == str(current_user.id)):
        raise HTTPException(status_code=403, detail="Permission denied")
    
    assignee_result = await db.execute(
        select(TaskAssignee).where(
            and_(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
        )
    )
    assignee = assignee_result.scalar_one_or_none()
    
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    await db.delete(assignee)
    await db.commit()
    
    return {"message": "Assignment removed"}


# ================== Summary Endpoints ==================

@router.put("/{task_id}/assignees/{user_id}/start")
async def start_reading(
    task_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """开始阅读"""
    # 只能操作自己的分配
    if user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="Can only start your own assignment")
    
    result = await db.execute(
        select(TaskAssignee).where(
            and_(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
        )
    )
    assignee = result.scalar_one_or_none()
    
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    assignee.status = AssigneeStatus.READING
    assignee.started_at = datetime.utcnow()
    await db.commit()
    
    return {"message": "Reading started"}


@router.put("/{task_id}/assignees/{user_id}/submit")
async def submit_summary(
    task_id: str,
    user_id: str,
    request: SubmitSummaryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """提交阅读总结"""
    # 只能操作自己的分配
    if user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="Can only submit your own summary")
    
    result = await db.execute(
        select(TaskAssignee).where(
            and_(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
        )
    )
    assignee = result.scalar_one_or_none()
    
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    import json
    assignee.summary = request.summary
    if request.summary_structure:
        assignee.summary_structure = json.dumps(request.summary_structure)
    assignee.status = AssigneeStatus.SUBMITTED
    assignee.submitted_at = datetime.utcnow()
    await db.commit()
    
    return {"message": "Summary submitted"}


@router.put("/{task_id}/assignees/{user_id}/approve")
async def approve_summary(
    task_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批准总结"""
    result = await db.execute(select(ReadingTask).where(ReadingTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 检查权限
    await check_team_admin(db, task.team_id, str(current_user.id))
    
    assignee_result = await db.execute(
        select(TaskAssignee).where(
            and_(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
        )
    )
    assignee = assignee_result.scalar_one_or_none()
    
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    if assignee.status != AssigneeStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="Summary not submitted yet")
    
    assignee.status = AssigneeStatus.APPROVED
    assignee.approved_at = datetime.utcnow()
    
    # 检查是否所有分配都完成
    all_result = await db.execute(
        select(TaskAssignee).where(TaskAssignee.task_id == task_id)
    )
    all_assignees = all_result.scalars().all()
    
    if all(a.status == AssigneeStatus.APPROVED for a in all_assignees):
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.utcnow()
    
    await db.commit()
    
    return {"message": "Summary approved"}
