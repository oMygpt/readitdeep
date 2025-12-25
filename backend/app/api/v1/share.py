"""
Read it DEEP - Share API
分享链接功能 - 允许用户生成论文分享链接给访客
"""

from datetime import datetime, timedelta
from typing import Optional, List
import logging

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from sqlalchemy import select, delete

from app.core.database import async_session_maker
from app.core.store import store
from app.models.user import User
from app.models.share_link import ShareLink, DEFAULT_EXPIRY_DAYS
from app.api.v1.auth import get_current_user


router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== Request/Response Models ====================

class CreateShareLinkRequest(BaseModel):
    expires_in_days: Optional[int] = DEFAULT_EXPIRY_DAYS  # 默认 14 天, None = 永不过期


class ShareLinkResponse(BaseModel):
    id: str
    paper_id: str
    share_token: str
    share_url: str
    expires_at: Optional[datetime]
    access_count: int
    created_at: datetime


class ShareLinkListResponse(BaseModel):
    links: List[ShareLinkResponse]


class GuestPaperResponse(BaseModel):
    """访客可见的论文信息"""
    paper_id: str
    title: Optional[str]
    filename: str
    status: str
    owner_name: Optional[str] = None  # 分享者名称 (脱敏)


class GuestPaperContentResponse(BaseModel):
    """访客可见的论文内容"""
    markdown: str
    # 不包含 translated 内容，访客无法使用翻译功能


class GuestAnalysisResponse(BaseModel):
    """访客可见的分析结果 - 只包含自动分析，不包含用户笔记"""
    paper_id: str
    status: str
    summary: Optional[str]
    methods: List[dict]
    datasets: List[dict]
    code_refs: List[dict]
    structure: Optional[dict]


# ==================== Helper Functions ====================

async def get_share_link_by_token(share_token: str) -> Optional[ShareLink]:
    """根据 token 获取分享链接"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(ShareLink).where(ShareLink.share_token == share_token)
        )
        return result.scalar_one_or_none()


async def validate_share_link(share_token: str) -> tuple[ShareLink, dict]:
    """
    验证分享链接有效性
    返回 (ShareLink, paper_dict) 或抛出 HTTPException
    """
    share_link = await get_share_link_by_token(share_token)
    
    if not share_link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="分享链接不存在或已失效"
        )
    
    if share_link.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="分享链接已过期"
        )
    
    # 获取论文
    paper = store.get(share_link.paper_id)
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="论文不存在"
        )
    
    return share_link, paper


async def record_access(share_link: ShareLink) -> None:
    """记录访问（异步更新数据库）"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(ShareLink).where(ShareLink.id == share_link.id)
        )
        db_link = result.scalar_one_or_none()
        if db_link:
            db_link.access_count += 1
            db_link.last_accessed_at = datetime.utcnow()
            await db.commit()


# ==================== Authenticated Endpoints ====================

@router.post("/papers/{paper_id}/link", response_model=ShareLinkResponse)
async def create_share_link(
    paper_id: str,
    request: CreateShareLinkRequest = CreateShareLinkRequest(),
    current_user: User = Depends(get_current_user),
):
    """
    为论文生成分享链接
    
    - 只有论文所有者可以生成分享链接
    - 默认有效期 14 天
    - expires_in_days = None 表示永不过期
    """
    # 检查论文是否存在
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 检查权限：只有所有者可以生成分享链接
    if paper.get("user_id") != current_user.id:
        raise HTTPException(403, "只有论文所有者可以生成分享链接")
    
    # 计算过期时间
    expires_at = None
    if request.expires_in_days is not None and request.expires_in_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=request.expires_in_days)
    
    # 创建分享链接
    async with async_session_maker() as db:
        share_link = ShareLink(
            paper_id=paper_id,
            user_id=current_user.id,
            expires_at=expires_at,
        )
        db.add(share_link)
        await db.commit()
        await db.refresh(share_link)
        
        # 构建分享 URL (前端路由)
        share_url = f"/share/{share_link.share_token}"
        
        logger.info(f"User {current_user.id} created share link for paper {paper_id}")
        
        return ShareLinkResponse(
            id=share_link.id,
            paper_id=share_link.paper_id,
            share_token=share_link.share_token,
            share_url=share_url,
            expires_at=share_link.expires_at,
            access_count=share_link.access_count,
            created_at=share_link.created_at,
        )


@router.get("/links", response_model=ShareLinkListResponse)
async def get_my_share_links(
    current_user: User = Depends(get_current_user),
):
    """获取当前用户的所有分享链接"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(ShareLink)
            .where(ShareLink.user_id == current_user.id)
            .order_by(ShareLink.created_at.desc())
        )
        links = result.scalars().all()
        
        return ShareLinkListResponse(
            links=[
                ShareLinkResponse(
                    id=link.id,
                    paper_id=link.paper_id,
                    share_token=link.share_token,
                    share_url=f"/share/{link.share_token}",
                    expires_at=link.expires_at,
                    access_count=link.access_count,
                    created_at=link.created_at,
                )
                for link in links
            ]
        )


@router.get("/papers/{paper_id}/links", response_model=ShareLinkListResponse)
async def get_paper_share_links(
    paper_id: str,
    current_user: User = Depends(get_current_user),
):
    """获取指定论文的所有分享链接"""
    # 检查论文是否存在
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 检查权限
    if paper.get("user_id") != current_user.id:
        raise HTTPException(403, "无权访问")
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(ShareLink)
            .where(
                ShareLink.paper_id == paper_id,
                ShareLink.user_id == current_user.id
            )
            .order_by(ShareLink.created_at.desc())
        )
        links = result.scalars().all()
        
        return ShareLinkListResponse(
            links=[
                ShareLinkResponse(
                    id=link.id,
                    paper_id=link.paper_id,
                    share_token=link.share_token,
                    share_url=f"/share/{link.share_token}",
                    expires_at=link.expires_at,
                    access_count=link.access_count,
                    created_at=link.created_at,
                )
                for link in links
            ]
        )


@router.delete("/link/{share_token}")
async def revoke_share_link(
    share_token: str,
    current_user: User = Depends(get_current_user),
):
    """撤销分享链接"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(ShareLink).where(ShareLink.share_token == share_token)
        )
        share_link = result.scalar_one_or_none()
        
        if not share_link:
            raise HTTPException(404, "分享链接不存在")
        
        # 检查权限
        if share_link.user_id != current_user.id:
            raise HTTPException(403, "无权撤销此链接")
        
        await db.execute(
            delete(ShareLink).where(ShareLink.id == share_link.id)
        )
        await db.commit()
        
        logger.info(f"User {current_user.id} revoked share link {share_token}")
        
        return {"success": True, "message": "分享链接已撤销"}


# ==================== Guest Endpoints (No Auth Required) ====================

@router.get("/paper/{share_token}", response_model=GuestPaperResponse)
async def get_shared_paper(share_token: str):
    """
    访客获取论文基本信息
    
    无需登录，通过分享 token 访问
    """
    share_link, paper = await validate_share_link(share_token)
    
    # 记录访问
    await record_access(share_link)
    
    # 获取分享者名称 (脱敏)
    owner_name = None
    async with async_session_maker() as db:
        result = await db.execute(
            select(User).where(User.id == share_link.user_id)
        )
        owner = result.scalar_one_or_none()
        if owner:
            # 脱敏处理：只显示部分用户名
            if owner.username:
                owner_name = owner.username[:2] + "***"
            elif owner.email:
                owner_name = owner.email.split("@")[0][:2] + "***"
    
    return GuestPaperResponse(
        paper_id=paper["id"],
        title=paper.get("title"),
        filename=paper["filename"],
        status=paper.get("status", "unknown"),
        owner_name=owner_name,
    )


@router.get("/paper/{share_token}/content", response_model=GuestPaperContentResponse)
async def get_shared_paper_content(share_token: str):
    """
    访客获取论文内容 (Markdown)
    
    无需登录，通过分享 token 访问
    不包含翻译内容
    """
    share_link, paper = await validate_share_link(share_token)
    
    # 记录访问
    await record_access(share_link)
    
    return GuestPaperContentResponse(
        markdown=paper.get("markdown_content", ""),
    )


@router.get("/paper/{share_token}/analysis", response_model=GuestAnalysisResponse)
async def get_shared_paper_analysis(share_token: str):
    """
    访客获取论文分析结果
    
    无需登录，通过分享 token 访问
    
    包含：
    - summary: 论文概要
    - methods: 研究方法
    - datasets: 数据集
    - code_refs: 代码引用
    - structure: 文档结构
    
    不包含：
    - 用户创建的 workbench items (笔记/反思)
    - 高亮标注
    - 团队协作内容
    """
    share_link, paper = await validate_share_link(share_token)
    
    # 记录访问
    await record_access(share_link)
    
    # 获取自动分析数据 (只获取 auto-generated items)
    from app.core.workbench_store import workbench_store
    items = workbench_store.get_items_by_paper(share_link.paper_id)
    
    methods = []
    datasets = []
    code_refs = []
    
    # 获取论文内容用于定位
    markdown_content = paper.get("markdown_content", "")
    content_lines = markdown_content.split('\n') if markdown_content else []
    
    def find_text_location(text_snippet: str, prefer_url: str = None) -> dict:
        """在论文内容中查找文本片段的位置"""
        if not text_snippet or not content_lines:
            return {"start_line": 0, "end_line": 0, "text_snippet": text_snippet or ""}
        
        snippet_clean = text_snippet.strip()[:100]
        
        # 如果有 URL，优先搜索包含 URL 的行
        if prefer_url:
            url_pattern = prefer_url.replace("https://", "").replace("http://", "")[:30]
            for i, line in enumerate(content_lines):
                if url_pattern in line:
                    return {
                        "start_line": i + 1,
                        "end_line": min(i + 3, len(content_lines)),
                        "text_snippet": snippet_clean
                    }
        
        # 搜索时跳过前10行
        skip_first_n = 10
        
        for i, line in enumerate(content_lines):
            if line.strip().startswith('#') or i < skip_first_n:
                continue
            if snippet_clean[:30] in line:
                return {
                    "start_line": i + 1,
                    "end_line": min(i + 3, len(content_lines)),
                    "text_snippet": snippet_clean
                }
        
        return {"start_line": 0, "end_line": 0, "text_snippet": snippet_clean}
    
    for item in items:
        # 只处理自动生成的 items (跳过用户手动创建的笔记)
        item_type = item.get("type")
        
        # 跳过笔记类型 (用户创建)
        if item_type == "note":
            continue
        
        title = item.get("title", "Unknown")
        desc = item.get("description", "")
        data = item.get("data", {})
        analysis = data.get("analysis", {})
        asset = data.get("asset", {})
        
        if item_type == "method":
            loc_text = (
                analysis.get("text_snippet") or
                analysis.get("method_name") or
                title
            )
            location = find_text_location(loc_text)
            methods.append({
                "name": title,
                "description": desc,
                "location": location
            })
        elif item_type == "dataset":
            loc_text = (
                asset.get("text_snippet") or
                asset.get("name") or
                title
            )
            resource_url = asset.get("url")
            location = find_text_location(loc_text, prefer_url=resource_url)
            datasets.append({
                "name": title,
                "description": desc,
                "usage": asset.get("usage_in_paper", ""),
                "location": location,
                "url": resource_url
            })
        elif item_type == "code":
            loc_text = (
                asset.get("text_snippet") or
                asset.get("name") or
                title
            )
            resource_url = asset.get("url")
            location = find_text_location(loc_text, prefer_url=resource_url)
            code_refs.append({
                "description": desc,
                "repo_url": resource_url,
                "location": location
            })
    
    return GuestAnalysisResponse(
        paper_id=share_link.paper_id,
        status=paper.get("status", "unknown"),
        summary=paper.get("summary"),
        methods=methods,
        datasets=datasets,
        code_refs=code_refs,
        structure=paper.get("structure"),
    )
