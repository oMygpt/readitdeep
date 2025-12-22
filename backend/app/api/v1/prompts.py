"""
Read it DEEP - 提示词管理 API

管理员专用的提示词版本管理、编辑历史和实时预览
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.database import get_db
from app.models.user import User
from app.models.prompt import PromptVersion, PromptActiveVersion, PromptHistory
from app.models.paper import Paper
from app.api.v1.auth import get_current_admin
from app.agents.prompt_loader import get_prompt_loader, PromptLoader, PROMPTS_DIR

router = APIRouter()


# ================== Schemas ==================

class PromptTypeItem(BaseModel):
    """提示词类型项"""
    name: str
    version_count: int
    active_version: Optional[str] = None


class PromptTypesResponse(BaseModel):
    """提示词类型列表响应"""
    types: List[PromptTypeItem]


class PromptVersionItem(BaseModel):
    """提示词版本项"""
    version: str
    description: Optional[str] = None
    is_active: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PromptVersionsResponse(BaseModel):
    """版本列表响应"""
    prompt_type: str
    versions: List[PromptVersionItem]
    active_version: Optional[str] = None


class PromptDetailResponse(BaseModel):
    """版本详情响应"""
    id: str
    prompt_type: str
    version: str
    description: Optional[str] = None
    system_prompt: str
    user_prompt_template: str
    file_path: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    is_active: bool = False


class PromptUpdateRequest(BaseModel):
    """更新提示词请求"""
    description: Optional[str] = None
    system_prompt: str
    user_prompt_template: str
    change_note: Optional[str] = None


class PromptCreateRequest(BaseModel):
    """创建新版本请求"""
    version: str
    description: Optional[str] = None
    system_prompt: str
    user_prompt_template: str
    base_version: Optional[str] = None  # 基于哪个版本创建


class SetActiveVersionRequest(BaseModel):
    """设置活跃版本请求"""
    version: str


class PromptHistoryItem(BaseModel):
    """编辑历史项"""
    id: str
    changed_at: Optional[str] = None
    changed_by: Optional[str] = None
    change_note: Optional[str] = None
    description: Optional[str] = None


class PromptHistoryResponse(BaseModel):
    """编辑历史响应"""
    prompt_type: str
    version: str
    history: List[PromptHistoryItem]


class PromptHistoryDetailResponse(BaseModel):
    """历史详情响应 (用于回滚预览)"""
    id: str
    prompt_type: str
    version: str
    description: Optional[str] = None
    system_prompt: str
    user_prompt_template: str
    changed_at: Optional[str] = None
    change_note: Optional[str] = None


class PreviewPaperItem(BaseModel):
    """可预览的论文项"""
    id: str
    title: Optional[str] = None
    filename: str


class PreviewPapersResponse(BaseModel):
    """可预览论文列表"""
    papers: List[PreviewPaperItem]


class PreviewRequest(BaseModel):
    """预览请求"""
    prompt_type: str
    system_prompt: str
    user_prompt_template: str
    paper_id: str


class PreviewResponse(BaseModel):
    """预览响应"""
    result: str
    tokens_used: Optional[int] = None


# ================== API Endpoints ==================
# 注意: 静态路由必须放在动态路由之前，否则会被错误匹配

# ---------- 静态路由 (必须放在最前面) ----------

@router.get("/types", response_model=PromptTypesResponse)
async def get_prompt_types(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取所有提示词类型"""
    # 从数据库获取统计
    result = await db.execute(
        select(
            PromptVersion.prompt_type,
            func.count(PromptVersion.id).label("version_count")
        ).group_by(PromptVersion.prompt_type)
    )
    type_counts = {row[0]: row[1] for row in result.fetchall()}
    
    # 获取活跃版本
    result = await db.execute(select(PromptActiveVersion))
    active_versions = {row.prompt_type: row.version for row in result.scalars().all()}
    
    # 如果数据库为空，从文件系统获取
    if not type_counts:
        loader = get_prompt_loader()
        for prompt_type in loader.get_all_types():
            versions = loader.list_versions(prompt_type)
            type_counts[prompt_type] = len(versions)
            # 获取活跃版本
            for v in versions:
                if v.get("is_active"):
                    active_versions[prompt_type] = v["version"]
                    break
    
    types = [
        PromptTypeItem(
            name=name,
            version_count=count,
            active_version=active_versions.get(name)
        )
        for name, count in sorted(type_counts.items())
    ]
    
    return PromptTypesResponse(types=types)


@router.post("/reload", response_model=dict)
async def reload_prompts(
    admin: User = Depends(get_current_admin),
):
    """热重载所有提示词"""
    loader = get_prompt_loader()
    loader.reload()
    return {"success": True, "message": "Prompts reloaded"}


@router.get("/preview/papers", response_model=PreviewPapersResponse)
async def get_preview_papers(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取可用于预览的论文列表"""
    result = await db.execute(
        select(Paper)
        .where(Paper.status == "completed")
        .order_by(Paper.created_at.desc())
        .limit(20)
    )
    papers = result.scalars().all()
    
    return PreviewPapersResponse(
        papers=[
            PreviewPaperItem(
                id=p.id,
                title=p.title,
                filename=p.filename
            )
            for p in papers
        ]
    )


@router.post("/preview", response_model=PreviewResponse)
async def preview_prompt(
    data: PreviewRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """使用指定提示词预览分析结果"""
    from app.core.store import store
    from app.services.llm import get_llm_service
    
    # 获取论文内容
    result = await db.execute(
        select(Paper).where(Paper.id == data.paper_id)
    )
    paper = result.scalar_one_or_none()
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    # 获取论文的 markdown 内容
    paper_data = store.get(data.paper_id)
    if not paper_data or not paper_data.get("markdown_content"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Paper content not available"
        )
    
    content = paper_data["markdown_content"]
    
    # 截取前面部分用于预览 (避免 token 过多)
    max_chars = 8000
    if len(content) > max_chars:
        content = content[:max_chars] + "\n\n... [内容已截断用于预览]"
    
    # 构建用户提示词
    user_prompt = data.user_prompt_template.replace("{content}", content)
    
    # 调用 LLM
    llm_service = get_llm_service()
    
    try:
        response = await llm_service.chat_completion(
            messages=[
                {"role": "system", "content": data.system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=2000,
        )
        
        result_text = response.choices[0].message.content
        tokens_used = response.usage.total_tokens if response.usage else None
        
        return PreviewResponse(
            result=result_text,
            tokens_used=tokens_used
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Preview failed: {str(e)}"
        )


# ---------- 动态路由 (带路径参数，放在静态路由后面) ----------

@router.get("/{prompt_type}/versions", response_model=PromptVersionsResponse)
async def get_prompt_versions(
    prompt_type: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取指定类型的所有版本"""
    # 获取活跃版本
    result = await db.execute(
        select(PromptActiveVersion).where(PromptActiveVersion.prompt_type == prompt_type)
    )
    active_record = result.scalar_one_or_none()
    active_version = active_record.version if active_record else None
    
    # 获取所有版本
    result = await db.execute(
        select(PromptVersion)
        .where(PromptVersion.prompt_type == prompt_type)
        .order_by(PromptVersion.version)
    )
    versions = result.scalars().all()
    
    # 如果数据库为空，从 PromptLoader 获取
    if not versions:
        loader = get_prompt_loader()
        loader_versions = loader.list_versions(prompt_type)
        return PromptVersionsResponse(
            prompt_type=prompt_type,
            versions=[
                PromptVersionItem(
                    version=v["version"],
                    description=v.get("description"),
                    is_active=v.get("is_active", False),
                )
                for v in loader_versions
            ],
            active_version=active_version
        )
    
    return PromptVersionsResponse(
        prompt_type=prompt_type,
        versions=[
            PromptVersionItem(
                version=v.version,
                description=v.description,
                is_active=(v.version == active_version),
                created_at=v.created_at.isoformat() if v.created_at else None,
                updated_at=v.updated_at.isoformat() if v.updated_at else None,
            )
            for v in versions
        ],
        active_version=active_version
    )


@router.post("/{prompt_type}", response_model=PromptDetailResponse)
async def create_prompt_version(
    prompt_type: str,
    data: PromptCreateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建新版本"""
    # 检查版本是否已存在
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_type == prompt_type,
            PromptVersion.version == data.version
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Version {data.version} already exists for {prompt_type}"
        )
    
    # 生成文件路径
    from pathlib import Path
    file_path = str(PROMPTS_DIR / prompt_type / f"{data.version}.md")
    
    # 创建记录
    prompt = PromptVersion(
        id=str(uuid.uuid4()),
        prompt_type=prompt_type,
        version=data.version,
        description=data.description,
        system_prompt=data.system_prompt,
        user_prompt_template=data.user_prompt_template,
        file_path=file_path,
        created_by=admin.id,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    
    # 写入文件
    await sync_prompt_to_file(prompt)
    
    # 重新加载
    loader = get_prompt_loader()
    loader.reload()
    
    return PromptDetailResponse(
        id=prompt.id,
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        file_path=prompt.file_path,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
        is_active=False
    )


@router.put("/{prompt_type}/active", response_model=dict)
async def set_active_version(
    prompt_type: str,
    data: SetActiveVersionRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """设置活跃版本"""
    # 验证版本存在
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_type == prompt_type,
            PromptVersion.version == data.version
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version} not found for {prompt_type}"
        )
    
    # 更新或插入活跃版本记录
    result = await db.execute(
        select(PromptActiveVersion).where(PromptActiveVersion.prompt_type == prompt_type)
    )
    active_record = result.scalar_one_or_none()
    
    if active_record:
        active_record.version = data.version
        active_record.updated_by = admin.id
    else:
        active_record = PromptActiveVersion(
            prompt_type=prompt_type,
            version=data.version,
            updated_by=admin.id
        )
        db.add(active_record)
    
    await db.commit()
    
    # 更新 PromptLoader
    loader = get_prompt_loader()
    loader.set_active_version(prompt_type, data.version)
    
    return {"success": True, "prompt_type": prompt_type, "active_version": data.version}


@router.get("/{prompt_type}/{version}", response_model=PromptDetailResponse)
async def get_prompt_detail(
    prompt_type: str,
    version: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取指定版本的完整内容"""
    # 从数据库获取
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_type == prompt_type,
            PromptVersion.version == version
        )
    )
    prompt = result.scalar_one_or_none()
    
    # 获取活跃版本
    result = await db.execute(
        select(PromptActiveVersion).where(PromptActiveVersion.prompt_type == prompt_type)
    )
    active_record = result.scalar_one_or_none()
    active_version = active_record.version if active_record else None
    
    if not prompt:
        # 尝试从 PromptLoader 获取
        loader = get_prompt_loader()
        prompt_file = loader.get_prompt(prompt_type, version)
        if not prompt_file:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Prompt {prompt_type}/{version} not found"
            )
        return PromptDetailResponse(
            id="",
            prompt_type=prompt_file.type,
            version=prompt_file.version,
            description=prompt_file.description,
            system_prompt=prompt_file.system_prompt,
            user_prompt_template=prompt_file.user_prompt_template,
            file_path=prompt_file.file_path,
            is_active=(version == active_version)
        )
    
    return PromptDetailResponse(
        id=prompt.id,
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        file_path=prompt.file_path,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
        is_active=(prompt.version == active_version)
    )


@router.put("/{prompt_type}/{version}", response_model=PromptDetailResponse)
async def update_prompt(
    prompt_type: str,
    version: str,
    data: PromptUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新提示词内容 (自动记录历史)"""
    # 获取现有记录
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_type == prompt_type,
            PromptVersion.version == version
        )
    )
    prompt = result.scalar_one_or_none()
    
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_type}/{version} not found"
        )
    
    # 保存历史记录
    history = PromptHistory(
        id=str(uuid.uuid4()),
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        changed_by=admin.id,
        change_note=data.change_note or "Update prompt content"
    )
    db.add(history)
    
    # 更新记录
    if data.description is not None:
        prompt.description = data.description
    prompt.system_prompt = data.system_prompt
    prompt.user_prompt_template = data.user_prompt_template
    
    await db.commit()
    await db.refresh(prompt)
    
    # 同步到文件
    await sync_prompt_to_file(prompt)
    
    # 重新加载 PromptLoader
    loader = get_prompt_loader()
    loader.reload()
    
    # 获取活跃版本
    result = await db.execute(
        select(PromptActiveVersion).where(PromptActiveVersion.prompt_type == prompt_type)
    )
    active_record = result.scalar_one_or_none()
    
    return PromptDetailResponse(
        id=prompt.id,
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        file_path=prompt.file_path,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
        is_active=(active_record and prompt.version == active_record.version)
    )


@router.get("/{prompt_type}/{version}/history", response_model=PromptHistoryResponse)
async def get_prompt_history(
    prompt_type: str,
    version: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取版本的编辑历史"""
    result = await db.execute(
        select(PromptHistory)
        .where(
            PromptHistory.prompt_type == prompt_type,
            PromptHistory.version == version
        )
        .order_by(PromptHistory.changed_at.desc())
    )
    history = result.scalars().all()
    
    return PromptHistoryResponse(
        prompt_type=prompt_type,
        version=version,
        history=[
            PromptHistoryItem(
                id=h.id,
                changed_at=h.changed_at.isoformat() if h.changed_at else None,
                changed_by=h.changed_by,
                change_note=h.change_note,
                description=h.description,
            )
            for h in history
        ]
    )


@router.get("/{prompt_type}/{version}/history/{history_id}", response_model=PromptHistoryDetailResponse)
async def get_history_detail(
    prompt_type: str,
    version: str,
    history_id: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取历史记录详情"""
    result = await db.execute(
        select(PromptHistory).where(PromptHistory.id == history_id)
    )
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History record not found"
        )
    
    return PromptHistoryDetailResponse(
        id=history.id,
        prompt_type=history.prompt_type,
        version=history.version,
        description=history.description,
        system_prompt=history.system_prompt,
        user_prompt_template=history.user_prompt_template,
        changed_at=history.changed_at.isoformat() if history.changed_at else None,
        change_note=history.change_note,
    )


@router.post("/{prompt_type}/{version}/rollback/{history_id}", response_model=PromptDetailResponse)
async def rollback_to_history(
    prompt_type: str,
    version: str,
    history_id: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """回滚到指定历史版本"""
    # 获取历史记录
    result = await db.execute(
        select(PromptHistory).where(PromptHistory.id == history_id)
    )
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History record not found"
        )
    
    # 获取当前版本
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_type == prompt_type,
            PromptVersion.version == version
        )
    )
    prompt = result.scalar_one_or_none()
    
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_type}/{version} not found"
        )
    
    # 保存当前状态到历史
    current_history = PromptHistory(
        id=str(uuid.uuid4()),
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        changed_by=admin.id,
        change_note=f"Before rollback to {history_id[:8]}..."
    )
    db.add(current_history)
    
    # 执行回滚
    prompt.description = history.description
    prompt.system_prompt = history.system_prompt
    prompt.user_prompt_template = history.user_prompt_template
    
    await db.commit()
    await db.refresh(prompt)
    
    # 同步到文件
    await sync_prompt_to_file(prompt)
    
    # 重新加载
    loader = get_prompt_loader()
    loader.reload()
    
    # 获取活跃版本状态
    result = await db.execute(
        select(PromptActiveVersion).where(PromptActiveVersion.prompt_type == prompt_type)
    )
    active_record = result.scalar_one_or_none()
    
    return PromptDetailResponse(
        id=prompt.id,
        prompt_type=prompt.prompt_type,
        version=prompt.version,
        description=prompt.description,
        system_prompt=prompt.system_prompt,
        user_prompt_template=prompt.user_prompt_template,
        file_path=prompt.file_path,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
        is_active=(active_record and prompt.version == active_record.version)
    )


# ================== Helper Functions ==================

async def sync_prompt_to_file(prompt: PromptVersion):
    """将提示词同步到 md 文件"""
    from pathlib import Path
    from datetime import datetime
    
    if not prompt.file_path:
        # 生成文件路径
        prompt.file_path = str(PROMPTS_DIR / prompt.prompt_type / f"{prompt.version}.md")
    
    file_path = Path(prompt.file_path)
    
    # 确保目录存在
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # 生成 md 内容
    content = f"""---
type: {prompt.prompt_type}
version: {prompt.version}
description: {prompt.description or ''}
created_at: {prompt.created_at.strftime('%Y-%m-%d') if prompt.created_at else datetime.now().strftime('%Y-%m-%d')}
---

# System Prompt
{prompt.system_prompt}

# User Prompt
{prompt.user_prompt_template}
"""
    
    file_path.write_text(content, encoding="utf-8")
