"""
Read it DEEP - Authors API

获取论文作者信息及其主要论文
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import logging

from app.services.openalex import get_openalex_service, OpenAlexAuthor, OpenAlexPaper
from app.core.store import store

logger = logging.getLogger(__name__)

router = APIRouter()


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


# ==================== Endpoints ====================

@router.get("/{paper_id}/authors-works", response_model=AuthorsWorksResponse)
async def get_authors_works(
    paper_id: str,
    works_limit: int = 5,
):
    """
    获取论文作者信息及其主要论文
    
    Args:
        paper_id: 论文 ID
        works_limit: 每位作者返回的论文数量 (默认 5)
    
    Returns:
        作者列表，每个作者包含其信息和高引用论文
    """
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
            authors=[]
        )
    
    # 从 OpenAlex 获取作者信息
    service = get_openalex_service()
    try:
        authors = await service.get_authors_from_paper(identifier)
        
        if not authors:
            logger.info(f"No authors found for paper {paper_id} ({identifier})")
            return AuthorsWorksResponse(
                paper_id=paper_id,
                authors=[]
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
        
        logger.info(f"Found {len(result_authors)} authors with works for paper {paper_id}")
        return AuthorsWorksResponse(
            paper_id=paper_id,
            authors=result_authors
        )
        
    except Exception as e:
        logger.error(f"Error fetching authors for paper {paper_id}: {e}")
        # 返回空结果而不是抛出错误
        return AuthorsWorksResponse(
            paper_id=paper_id,
            authors=[]
        )
