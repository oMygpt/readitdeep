"""
Read it DEEP - Library API
知识库管理
"""

from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.store import store

# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy import select, func, or_
# from fastapi import Depends
# from app.core.database import get_db
# from app.models.paper import Paper

# from app.api.v1.papers import _papers_store


router = APIRouter()


class PaperSummary(BaseModel):
    """论文摘要 (列表展示用)"""
    id: str
    filename: str
    title: Optional[str] = None
    category: Optional[str] = None
    status: str
    created_at: datetime


class LibraryResponse(BaseModel):
    """知识库响应"""
    total: int
    items: List[PaperSummary]


@router.get("/", response_model=LibraryResponse)
async def list_papers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
) -> LibraryResponse:
    """
    获取知识库论文列表 (基于本地 JSON 存储)
    """
    papers = store.get_all()
    
    # 手动筛选
    if search:
        search_lower = search.lower()
        papers = [
            p for p in papers 
            if search_lower in (p.get("filename") or "").lower()
            or search_lower in (p.get("title") or "").lower()
        ]
    
    if category:
        papers = [p for p in papers if p.get("category") == category]
    
    if status:
        papers = [p for p in papers if p.get("status") == status]
    
    # 字符串转 datetime 用于排序
    def get_time(p):
        t = p.get("created_at")
        if isinstance(t, str):
            try:
                return datetime.fromisoformat(t)
            except:
                pass
        return t or datetime.min

    try:
        papers.sort(key=get_time, reverse=True)
    except Exception:
        pass # Sort best effort
    
    total = len(papers)
    
    # 分页
    start = (page - 1) * page_size
    end = start + page_size
    paginated = papers[start:end]
    
    return LibraryResponse(
        total=total,
        items=[
            PaperSummary(
                id=p["id"],
                filename=p["filename"],
                title=p.get("title"),
                category=p.get("category"),
                status=p["status"],
                created_at=p.get("created_at"),
            )
            for p in paginated
        ],
    )


@router.delete("/{paper_id}")
async def delete_paper(paper_id: str) -> dict:
    """删除论文"""
    paper = store.get(paper_id)
    if not paper:
        return {"success": False, "message": "论文不存在"}
    
    # 检查状态
    if paper.get("status") in ["uploading", "parsing", "indexing"]:
        return {"success": False, "message": f"论文正在{paper.get('status')}中，无法删除"}
    
    # 删除文件
    import os
    file_path = paper.get("file_path")
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except:
            pass
    
    # 删除记录
    store.delete(paper_id)
    
    return {"success": True, "message": "论文已删除"}


@router.get("/categories")
async def list_categories() -> dict:
    """获取所有论文类别"""
    categories = set()
    for paper in store.get_all():
        if paper.get("category"):
            categories.add(paper["category"])
    
    return {"categories": sorted(list(categories))}
