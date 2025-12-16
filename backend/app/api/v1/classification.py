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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

from app.core.store import store
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


@tags_router.get("/tags", response_model=List[TagStatsResponse])
async def get_library_tags():
    """
    获取所有标签及其使用统计
    """
    tags = get_all_tags()
    return [TagStatsResponse(**t) for t in tags]
