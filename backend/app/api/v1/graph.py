"""
Read it DEEP - Paper Graph API

获取论文关系图:
- 本地相似论文 (pgvector embedding 相似度)
- S2 引用/参考文献/推荐
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import logging

from app.core.store import store
from app.services.semantic_scholar import get_s2_service, S2_AVAILABLE

logger = logging.getLogger(__name__)
router = APIRouter()


class PaperNode(BaseModel):
    """论文节点"""
    id: str
    title: str
    authors: List[str] = []
    year: Optional[int] = None
    venue: Optional[str] = None
    citation_count: Optional[int] = None
    is_local: bool
    external_id: Optional[str] = None


class PaperEdge(BaseModel):
    """论文关系边"""
    source: str
    target: str
    relation: str  # 'cites' | 'cited_by' | 'similar' | 'recommended'
    weight: Optional[float] = None


class CurrentPaper(BaseModel):
    """当前论文"""
    id: str
    title: str
    external_id: Optional[str] = None


class PaperGraphResponse(BaseModel):
    """论文关系图响应"""
    current_paper: CurrentPaper
    nodes: List[PaperNode]
    edges: List[PaperEdge]


@router.get("/{paper_id}/graph", response_model=PaperGraphResponse)
async def get_paper_graph(
    paper_id: str,
    include_local: bool = Query(True, description="包含本地相似论文"),
    include_citations: bool = Query(True, description="包含 S2 引用"),
    include_references: bool = Query(True, description="包含 S2 参考文献"),
    include_recommendations: bool = Query(False, description="包含 S2 推荐"),
    limit: int = Query(10, ge=1, le=50, description="每类最大数量"),
) -> PaperGraphResponse:
    """
    获取论文关系图
    
    返回包含当前论文、相关论文节点和关系边的图结构。
    
    数据源:
    - 本地相似论文: 基于 embedding 相似度 (需要 pgvector)
    - S2 引用: 引用当前论文的论文
    - S2 参考文献: 当前论文引用的论文
    - S2 推荐: 基于当前论文的推荐
    """
    # 获取当前论文
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if paper.get("status") != "completed":
        raise HTTPException(status_code=400, detail=f"论文尚未解析完成 (status: {paper.get('status')})")
    
    # 构建当前论文信息
    external_id = None
    if paper.get("doi"):
        external_id = paper["doi"]
    elif paper.get("arxiv_id"):
        external_id = f"arXiv:{paper['arxiv_id']}"
    
    current = CurrentPaper(
        id=paper_id,
        title=paper.get("title") or paper.get("filename", "Unknown"),
        external_id=external_id,
    )
    
    nodes: list[PaperNode] = []
    edges: list[PaperEdge] = []
    
    # 1. 本地相似论文 (MVP: 暂时跳过，需要 pgvector)
    if include_local:
        # TODO: 实现基于 pgvector 的相似度查询
        # 当前 MVP 使用内存存储，无法进行向量相似度查询
        # 后期迁移到 PostgreSQL 后实现
        pass
    
    # 2. S2 数据 (需要 DOI 或 ArXiv ID)
    if external_id and S2_AVAILABLE:
        try:
            s2 = get_s2_service()
            
            # 2.1 获取引用
            if include_citations:
                citations = await s2.get_citations(external_id, limit=limit)
                for c in citations:
                    node_id = f"s2-{c.external_id}"
                    nodes.append(PaperNode(
                        id=node_id,
                        title=c.title,
                        authors=c.authors,
                        year=c.year,
                        venue=c.venue,
                        citation_count=c.citation_count,
                        is_local=False,
                        external_id=c.external_id,
                    ))
                    edges.append(PaperEdge(
                        source=node_id,
                        target="current",
                        relation="cited_by",
                    ))
            
            # 2.2 获取参考文献
            if include_references:
                references = await s2.get_references(external_id, limit=limit)
                for r in references:
                    node_id = f"s2-{r.external_id}"
                    # 避免重复添加节点
                    if not any(n.id == node_id for n in nodes):
                        nodes.append(PaperNode(
                            id=node_id,
                            title=r.title,
                            authors=r.authors,
                            year=r.year,
                            venue=r.venue,
                            citation_count=r.citation_count,
                            is_local=False,
                            external_id=r.external_id,
                        ))
                    edges.append(PaperEdge(
                        source="current",
                        target=node_id,
                        relation="cites",
                    ))
            
            # 2.3 获取推荐
            if include_recommendations:
                recommendations = await s2.get_recommendations(external_id, limit=limit)
                for rec in recommendations:
                    node_id = f"s2-{rec.external_id}"
                    if not any(n.id == node_id for n in nodes):
                        nodes.append(PaperNode(
                            id=node_id,
                            title=rec.title,
                            authors=rec.authors,
                            year=rec.year,
                            venue=rec.venue,
                            citation_count=rec.citation_count,
                            is_local=False,
                            external_id=rec.external_id,
                        ))
                    edges.append(PaperEdge(
                        source="current",
                        target=node_id,
                        relation="recommended",
                    ))
                    
        except Exception as e:
            logger.warning(f"S2 API error for paper {paper_id}: {e}")
            # 不抛出异常，继续返回已有数据
    
    return PaperGraphResponse(
        current_paper=current,
        nodes=nodes,
        edges=edges,
    )
