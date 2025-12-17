"""
Read it DEEP - 分类 API

端点:
- POST /papers/{id}/classify - 触发 LLM 分类
- GET /papers/{id}/tags - 获取论文标签
- PUT /papers/{id}/tags - 确认/更新标签
- POST /papers/{id}/tags - 添加标签
- DELETE /papers/{id}/tags/{tag} - 删除标签
- GET /library/tags - 获取所有标签统计
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import logging

from app.core.store import store
from app.models.user import User
from app.api.v1.auth import get_current_user
from app.services.classification import (
    suggest_tags,
    confirm_tags,
    add_tag,
    remove_tag,
    get_all_tags,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class TagSuggestionResponse(BaseModel):
    name: str
    confidence: float
    reason: str


class ClassifyResponse(BaseModel):
    paper_id: str
    suggested_tags: List[TagSuggestionResponse]


class TagsResponse(BaseModel):
    paper_id: str
    tags: List[str]
    suggested_tags: Optional[List[str]] = None
    tags_confirmed: bool = False


class ConfirmTagsRequest(BaseModel):
    tags: List[str]


class AddTagRequest(BaseModel):
    tag: str


class TagStatsResponse(BaseModel):
    name: str
    count: int


@router.post("/{paper_id}/classify", response_model=ClassifyResponse)
async def classify_paper(paper_id: str):
    """
    触发论文智能分类
    
    使用 LLM 分析论文内容，生成标签建议
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if paper.get("status") != "completed":
        raise HTTPException(status_code=400, detail="论文尚未解析完成")
    
    suggestions = await suggest_tags(paper_id)
    
    return ClassifyResponse(
        paper_id=paper_id,
        suggested_tags=[
            TagSuggestionResponse(
                name=s.name,
                confidence=s.confidence,
                reason=s.reason,
            )
            for s in suggestions
        ]
    )


@router.get("/{paper_id}/tags", response_model=TagsResponse)
async def get_paper_tags(paper_id: str):
    """
    获取论文标签
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    return TagsResponse(
        paper_id=paper_id,
        tags=paper.get("tags", []),
        suggested_tags=paper.get("suggested_tags"),
        tags_confirmed=paper.get("tags_confirmed", False),
    )


@router.put("/{paper_id}/tags", response_model=TagsResponse)
async def update_paper_tags(paper_id: str, request: ConfirmTagsRequest):
    """
    确认/更新论文标签
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    success = confirm_tags(paper_id, request.tags)
    if not success:
        raise HTTPException(status_code=500, detail="更新失败")
    
    paper = store.get(paper_id)
    return TagsResponse(
        paper_id=paper_id,
        tags=paper.get("tags", []),
        suggested_tags=paper.get("suggested_tags"),
        tags_confirmed=paper.get("tags_confirmed", False),
    )


@router.post("/{paper_id}/tags", response_model=TagsResponse)
async def add_paper_tag(paper_id: str, request: AddTagRequest):
    """
    添加论文标签
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    success = add_tag(paper_id, request.tag)
    if not success:
        raise HTTPException(status_code=500, detail="添加失败")
    
    paper = store.get(paper_id)
    return TagsResponse(
        paper_id=paper_id,
        tags=paper.get("tags", []),
        suggested_tags=paper.get("suggested_tags"),
        tags_confirmed=paper.get("tags_confirmed", False),
    )


@router.delete("/{paper_id}/tags/{tag}")
async def delete_paper_tag(paper_id: str, tag: str):
    """
    删除论文标签
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    success = remove_tag(paper_id, tag)
    if not success:
        raise HTTPException(status_code=500, detail="删除失败")
    
    return {"success": True, "message": f"标签 '{tag}' 已删除"}


# Library 级别的标签统计
tags_router = APIRouter()


class UpdateCategoryRequest(BaseModel):
    category: str


class CategoryStatsResponse(BaseModel):
    name: str
    count: int


@router.put("/{paper_id}/category")
async def update_paper_category(paper_id: str, request: UpdateCategoryRequest):
    """
    更新论文分类
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    paper["category"] = request.category
    store.set(paper_id, paper)
    
    return {"success": True, "category": request.category}


@tags_router.get("/tags", response_model=List[TagStatsResponse])
async def get_library_tags():
    """
    获取所有标签及其使用统计
    """
    tags = get_all_tags()
    return [TagStatsResponse(**t) for t in tags]


@tags_router.get("/categories", response_model=List[CategoryStatsResponse])
async def get_library_categories():
    """
    获取所有分类及其使用统计
    """
    all_papers = store.get_all()
    category_counts = {}
    
    for paper in all_papers:
        cat = paper.get("category") or "Uncategorized"
        category_counts[cat] = category_counts.get(cat, 0) + 1
    
    return [
        CategoryStatsResponse(name=name, count=count)
        for name, count in sorted(category_counts.items(), key=lambda x: -x[1])
    ]


class RenameCategoryRequest(BaseModel):
    old_name: str
    new_name: str


class RenameCategoryResponse(BaseModel):
    success: bool
    old_name: str
    new_name: str
    papers_updated: int


@tags_router.put("/categories/rename", response_model=RenameCategoryResponse)
async def rename_category(
    request: RenameCategoryRequest,
    current_user: User = Depends(get_current_user),
):
    """
    重命名分类 (仅当前用户的论文)
    
    将当前用户所有使用 old_name 分类的论文改为 new_name
    """
    if not request.new_name.strip():
        raise HTTPException(status_code=400, detail="新分类名称不能为空")
    
    papers_updated = 0
    # 只获取当前用户的论文
    user_papers = store.get_by_user(current_user.id)
    
    for paper in user_papers:
        if paper.get("category") == request.old_name:
            paper["category"] = request.new_name.strip()
            store.set(paper["id"], paper)
            papers_updated += 1
    
    logger.info(f"Category renamed for user {current_user.id}: '{request.old_name}' -> '{request.new_name}' ({papers_updated} papers)")
    
    return RenameCategoryResponse(
        success=True,
        old_name=request.old_name,
        new_name=request.new_name.strip(),
        papers_updated=papers_updated,
    )


class DeleteCategoryResponse(BaseModel):
    success: bool
    category: str
    papers_updated: int


@tags_router.delete("/categories/{category_name}", response_model=DeleteCategoryResponse)
async def delete_category(
    category_name: str,
    current_user: User = Depends(get_current_user),
):
    """
    删除分类 (将该分类下的论文设为 Uncategorized) - 仅当前用户的论文
    """
    import urllib.parse
    decoded_name = urllib.parse.unquote(category_name)
    
    papers_updated = 0
    user_papers = store.get_by_user(current_user.id)
    
    for paper in user_papers:
        if paper.get("category") == decoded_name:
            paper["category"] = None
            store.set(paper["id"], paper)
            papers_updated += 1
    
    logger.info(f"Category deleted for user {current_user.id}: '{decoded_name}' ({papers_updated} papers moved to Uncategorized)")
    
    return DeleteCategoryResponse(
        success=True,
        category=decoded_name,
        papers_updated=papers_updated,
    )
