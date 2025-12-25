"""
Read it DEEP - Authors API

获取论文作者信息及其主要论文 (支持数据库缓存)
"""

from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import logging
import json

from app.services.openalex import get_openalex_service, OpenAlexAuthor, OpenAlexPaper
from app.core.store import store
from app.core.database import get_db
from app.models.author_cache import AuthorCache, PaperAuthorCache

logger = logging.getLogger(__name__)

router = APIRouter()

# 缓存有效期 (7天)
CACHE_TTL_DAYS = 7


# ==================== Response Models ====================

class AuthorWork(BaseModel):
    """作者论文"""
    title: str
    year: Optional[int] = None
    venue: Optional[str] = None
    citation_count: Optional[int] = None
    doi: Optional[str] = None
    openalex_url: str


class AuthorWithWorks(BaseModel):
    """作者及其论文"""
    openalex_id: str
    display_name: str
    affiliation: Optional[str] = None
    works_count: int
    cited_by_count: int
    orcid: Optional[str] = None
    top_works: List[AuthorWork]


class AuthorsWorksResponse(BaseModel):
    """作者论文响应"""
    paper_id: str
    authors: List[AuthorWithWorks]
    from_cache: bool = False


# ==================== Helper Functions ====================

def is_cache_valid(updated_at: datetime) -> bool:
    """检查缓存是否仍然有效"""
    if not updated_at:
        return False
    # 处理时区问题
    now = datetime.utcnow()
    if updated_at.tzinfo:
        updated_at = updated_at.replace(tzinfo=None)
    return (now - updated_at) < timedelta(days=CACHE_TTL_DAYS)


async def get_cached_authors(
    paper_id: str, 
    db: AsyncSession
) -> Optional[List[AuthorWithWorks]]:
    """从数据库获取缓存的作者信息"""
    # 查询论文关联的作者
    result = await db.execute(
        select(PaperAuthorCache, AuthorCache)
        .join(AuthorCache, PaperAuthorCache.author_cache_id == AuthorCache.id)
        .where(PaperAuthorCache.paper_id == paper_id)
        .order_by(PaperAuthorCache.author_position)
    )
    rows = result.all()
    
    if not rows:
        return None
    
    # 检查缓存是否过期
    authors: List[AuthorWithWorks] = []
    for _, author_cache in rows:
        if not is_cache_valid(author_cache.updated_at):
            return None  # 缓存过期，需要刷新
        
        # 解析缓存的论文数据
        top_works = []
        if author_cache.top_works_json:
            try:
                works_data = json.loads(author_cache.top_works_json)
                top_works = [AuthorWork(**w) for w in works_data]
            except Exception as e:
                logger.warning(f"Failed to parse cached works: {e}")
        
        authors.append(AuthorWithWorks(
            openalex_id=author_cache.openalex_id,
            display_name=author_cache.display_name,
            affiliation=author_cache.affiliation,
            works_count=author_cache.works_count,
            cited_by_count=author_cache.cited_by_count,
            orcid=author_cache.orcid,
            top_works=top_works,
        ))
    
    return authors


async def cache_authors(
    paper_id: str, 
    authors: List[AuthorWithWorks], 
    db: AsyncSession
):
    """将作者信息保存到数据库缓存"""
    try:
        # 先删除旧的关联
        result = await db.execute(
            select(PaperAuthorCache).where(PaperAuthorCache.paper_id == paper_id)
        )
        old_associations = result.scalars().all()
        for assoc in old_associations:
            await db.delete(assoc)
        
        for position, author in enumerate(authors):
            # 查找或创建作者缓存
            result = await db.execute(
                select(AuthorCache).where(AuthorCache.openalex_id == author.openalex_id)
            )
            author_cache = result.scalar_one_or_none()
            
            # 序列化论文数据
            works_json = json.dumps([
                {
                    "title": w.title,
                    "year": w.year,
                    "venue": w.venue,
                    "citation_count": w.citation_count,
                    "doi": w.doi,
                    "openalex_url": w.openalex_url,
                }
                for w in author.top_works
            ], ensure_ascii=False)
            
            if author_cache:
                # 更新现有缓存
                author_cache.display_name = author.display_name
                author_cache.affiliation = author.affiliation
                author_cache.orcid = author.orcid
                author_cache.works_count = author.works_count
                author_cache.cited_by_count = author.cited_by_count
                author_cache.top_works_json = works_json
            else:
                # 创建新缓存
                author_cache = AuthorCache(
                    openalex_id=author.openalex_id,
                    display_name=author.display_name,
                    affiliation=author.affiliation,
                    orcid=author.orcid,
                    works_count=author.works_count,
                    cited_by_count=author.cited_by_count,
                    top_works_json=works_json,
                )
                db.add(author_cache)
                await db.flush()  # 获取 ID
            
            # 创建论文-作者关联
            association = PaperAuthorCache(
                paper_id=paper_id,
                author_cache_id=author_cache.id,
                author_position=position,
            )
            db.add(association)
        
        await db.commit()
        logger.info(f"Cached {len(authors)} authors for paper {paper_id}")
        
    except Exception as e:
        logger.error(f"Failed to cache authors: {e}")
        await db.rollback()


# ==================== Endpoints ====================

@router.get("/{paper_id}/authors-works", response_model=AuthorsWorksResponse)
async def get_authors_works(
    paper_id: str,
    works_limit: int = 5,
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    获取论文作者信息及其主要论文
    
    Args:
        paper_id: 论文 ID
        works_limit: 每位作者返回的论文数量 (默认 5)
        refresh: 是否强制刷新缓存
    
    Returns:
        作者列表，每个作者包含其信息和高引用论文
    """
    # 尝试从缓存获取
    if not refresh:
        cached = await get_cached_authors(paper_id, db)
        if cached:
            logger.info(f"Returning cached authors for paper {paper_id}")
            return AuthorsWorksResponse(
                paper_id=paper_id,
                authors=cached,
                from_cache=True
            )
    
    # 获取论文信息
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Paper {paper_id} not found"
        )
    
    # 需要 DOI 或 arXiv ID 来查询 OpenAlex
    identifier = None
    if paper.get("doi"):
        identifier = paper["doi"]
    elif paper.get("arxiv_id"):
        identifier = paper["arxiv_id"]
    
    if not identifier:
        # 没有标识符，返回空结果
        logger.info(f"Paper {paper_id} has no DOI or arXiv ID, cannot fetch authors")
        return AuthorsWorksResponse(
            paper_id=paper_id,
            authors=[],
            from_cache=False
        )
    
    # 从 OpenAlex 获取作者信息
    service = get_openalex_service()
    try:
        authors = await service.get_authors_from_paper(identifier)
        
        if not authors:
            logger.info(f"No authors found for paper {paper_id} ({identifier})")
            return AuthorsWorksResponse(
                paper_id=paper_id,
                authors=[],
                from_cache=False
            )
        
        # 获取每位作者的论文 (限制最多处理 5 位作者以避免太慢)
        result_authors: List[AuthorWithWorks] = []
        for author in authors[:5]:
            works = await service.get_author_works(
                author.openalex_id, 
                limit=works_limit
            )
            
            top_works = [
                AuthorWork(
                    title=w.title,
                    year=w.year,
                    venue=w.venue,
                    citation_count=w.citation_count,
                    doi=w.doi,
                    openalex_url=w.openalex_id,
                )
                for w in works
            ]
            
            result_authors.append(AuthorWithWorks(
                openalex_id=author.openalex_id,
                display_name=author.display_name,
                affiliation=author.affiliation,
                works_count=author.works_count,
                cited_by_count=author.cited_by_count,
                orcid=author.orcid,
                top_works=top_works,
            ))
        
        # 保存到缓存
        await cache_authors(paper_id, result_authors, db)
        
        logger.info(f"Found {len(result_authors)} authors with works for paper {paper_id}")
        return AuthorsWorksResponse(
            paper_id=paper_id,
            authors=result_authors,
            from_cache=False
        )
        
    except Exception as e:
        logger.error(f"Error fetching authors for paper {paper_id}: {e}")
        # 如果 OpenAlex 失败，尝试返回缓存数据 (即使过期)
        cached = await get_cached_authors(paper_id, db)
        if cached:
            return AuthorsWorksResponse(
                paper_id=paper_id,
                authors=cached,
                from_cache=True
            )
        # 返回空结果而不是抛出错误
        return AuthorsWorksResponse(
            paper_id=paper_id,
            authors=[],
            from_cache=False
        )
