"""
Read it DEEP - Library API
知识库管理 (支持多用户隔离)
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.store import store
from app.services import pdf_intake
from app.core.database import get_db
from app.models.user import User
from app.models.team import PaperShare, Team
from app.api.v1.auth import get_current_user


router = APIRouter()


class SharedTeamInfo(BaseModel):
    """分享团队信息"""
    id: str
    name: str
    shared_at: Optional[datetime] = None


class PaperSummary(BaseModel):
    """论文摘要 (列表展示用)"""
    id: str
    filename: str
    title: Optional[str] = None
    category: Optional[str] = None
    status: str
    content_ready: bool = False
    created_at: datetime
    tags: Optional[List[str]] = None
    shared_teams: Optional[List[SharedTeamInfo]] = None  # 分享给哪些团队
    # 题录态（metadata）/ PDF 待处理（pdf_pending）的论文需要这些字段显示操作与原因
    error_message: Optional[str] = None
    arxiv_id: Optional[str] = None
    external_full_text_url: Optional[str] = None
    source_provider: Optional[str] = None
    # 题录态：是否有开放获取 PDF 可自动抓取；没有时给出版商数据库链接
    oa_available: bool = False
    access_links: Optional[List[dict]] = None


def _intake_hints(p: dict) -> dict:
    if p["status"] != "metadata":
        return {}
    oa = bool(pdf_intake.oa_candidates(p))
    return {"oa_available": oa, "access_links": None if oa else pdf_intake.access_links(p)}


class LibraryResponse(BaseModel):
    """知识库响应"""
    total: int
    items: List[PaperSummary]


async def get_paper_shared_teams(db, paper_id: str) -> List[SharedTeamInfo]:
    """获取论文分享的团队列表"""
    result = await db.execute(
        select(PaperShare, Team)
        .join(Team, PaperShare.team_id == Team.id)
        .where(PaperShare.paper_id == paper_id)
    )
    rows = result.all()
    
    teams = []
    for share, team in rows:
        teams.append(SharedTeamInfo(
            id=team.id,
            name=team.name,
            shared_at=share.shared_at
        ))
    return teams


@router.get("/", response_model=LibraryResponse)
async def list_papers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LibraryResponse:
    """
    获取知识库论文列表 (仅当前用户的论文)
    管理员可通过单独接口查看全部
    """
    # 按用户过滤
    papers = store.get_by_user(current_user.id)
    
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
                t = datetime.fromisoformat(t)
            except ValueError:
                t = None
        if not isinstance(t, datetime):
            return datetime.min.replace(tzinfo=timezone.utc)
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)

    try:
        papers.sort(key=get_time, reverse=True)
    except Exception:
        pass # Sort best effort
    
    total = len(papers)
    
    # 分页
    start = (page - 1) * page_size
    end = start + page_size
    paginated = papers[start:end]
    
    # 获取每篇论文的分享团队信息
    items = []
    for p in paginated:
        shared_teams = await get_paper_shared_teams(db, p["id"])
        
        # 解析 tags (可能是 JSON 字符串或 list)
        tags_raw = p.get("tags")
        if isinstance(tags_raw, str):
            try:
                import json
                tags = json.loads(tags_raw)
            except:
                tags = None
        else:
            tags = tags_raw
        
        items.append(PaperSummary(
            id=p["id"],
            filename=p["filename"],
            title=p.get("title"),
            category=p.get("category"),
            status=p["status"],
            content_ready=bool(p.get("content_ready") or p["status"] in ("completed", "analyzed", "embedding_done", "analyzing", "classifying")),
            created_at=p.get("created_at"),
            tags=tags,
            shared_teams=shared_teams if shared_teams else None,
            error_message=p.get("error_message") if p["status"] in ("pdf_pending", "failed") else None,
            arxiv_id=p.get("arxiv_id"),
            external_full_text_url=p.get("external_full_text_url"),
            source_provider=p.get("source_provider"),
            **_intake_hints(p),
        ))
    
    return LibraryResponse(
        total=total,
        items=items,
    )


@router.delete("/{paper_id}")
async def delete_paper(
    paper_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """删除论文 (仅限自己的论文或管理员)"""
    paper = store.get(paper_id)
    if not paper:
        return {"success": False, "message": "论文不存在"}
    
    # 权限检查：只能删除自己的论文，或者是管理员
    if paper.get("user_id") != current_user.id and not current_user.is_admin:
        return {"success": False, "message": "无权删除此论文"}
    
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
    
    # 删除解析出的图片
    import shutil
    from app.core.files import images_root
    shutil.rmtree(images_root() / paper_id, ignore_errors=True)

    # 删除记录（数据库是唯一来源；PostgreSQL 上分享、批注等关联行按外键级联删除）
    store.delete(paper_id)

    return {"success": True, "message": "论文已删除"}


@router.get("/categories")
async def list_categories(
    current_user: User = Depends(get_current_user),
) -> dict:
    """获取当前用户的所有论文类别"""
    categories = set()
    for paper in store.get_by_user(current_user.id):
        if paper.get("category"):
            categories.add(paper["category"])
    
    return {"categories": sorted(list(categories))}
