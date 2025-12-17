"""
Read it DEEP - Paper Graph API v0.1

获取论文关系图:
- 本地相似论文 (pgvector embedding 相似度)
- S2 引用/参考文献

存储策略:
- 参考文献 (references): 永久存储，不会变化
- 被引论文 (citations): 每 10 天刷新一次（可能增长）
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import logging

from app.core.store import store
from app.services.semantic_scholar import get_s2_service, S2_AVAILABLE, S2RateLimitError, S2ApiError

logger = logging.getLogger(__name__)
router = APIRouter()

# Citations refresh interval: 10 days
CITATIONS_REFRESH_DAYS = 10


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
    s2_url: Optional[str] = None  # Semantic Scholar URL


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
    from_store: bool = False  # Whether data was loaded from permanent store


def _get_s2_url(external_id: str) -> str:
    """Generate Semantic Scholar paper URL"""
    if external_id.startswith("CorpusId:"):
        corpus_id = external_id.replace("CorpusId:", "")
        return f"https://www.semanticscholar.org/paper/{corpus_id}"
    return f"https://www.semanticscholar.org/search?q={external_id}"


def _should_refresh_citations(paper: dict) -> bool:
    """Check if citations need refresh (older than 10 days)"""
    s2_graph = paper.get("s2_graph", {})
    citations_at = s2_graph.get("citations_fetched_at")
    if not citations_at:
        return True
    try:
        fetch_time = datetime.fromisoformat(citations_at)
        return datetime.now() - fetch_time > timedelta(days=CITATIONS_REFRESH_DAYS)
    except:
        return True


def _has_stored_references(paper: dict) -> bool:
    """Check if references are already stored (permanent)"""
    s2_graph = paper.get("s2_graph", {})
    return bool(s2_graph.get("references"))


def _load_from_store(paper: dict) -> tuple[list[PaperNode], list[PaperEdge]]:
    """Load nodes and edges from permanent store"""
    s2_graph = paper.get("s2_graph", {})
    nodes = []
    edges = []
    
    for c in s2_graph.get("citations", []):
        node_id = f"s2-{c['external_id']}"
        nodes.append(PaperNode(
            id=node_id,
            title=c["title"],
            authors=c.get("authors", []),
            year=c.get("year"),
            venue=c.get("venue"),
            citation_count=c.get("citation_count"),
            is_local=False,
            external_id=c["external_id"],
            s2_url=_get_s2_url(c["external_id"]),
        ))
        edges.append(PaperEdge(
            source=node_id,
            target="current",
            relation="cited_by",
        ))
    
    for r in s2_graph.get("references", []):
        node_id = f"s2-{r['external_id']}"
        if not any(n.id == node_id for n in nodes):
            nodes.append(PaperNode(
                id=node_id,
                title=r["title"],
                authors=r.get("authors", []),
                year=r.get("year"),
                venue=r.get("venue"),
                citation_count=r.get("citation_count"),
                is_local=False,
                external_id=r["external_id"],
                s2_url=_get_s2_url(r["external_id"]),
            ))
        edges.append(PaperEdge(
            source="current",
            target=node_id,
            relation="cites",
        ))
    
    return nodes, edges


async def _fetch_and_store_s2(paper_id: str, external_id: str, limit: int, fetch_citations: bool, fetch_references: bool) -> tuple[list[PaperNode], list[PaperEdge]]:
    """Fetch from S2 API and store permanently"""
    paper = store.get(paper_id)
    if not paper:
        return [], []
    
    s2_graph = paper.get("s2_graph", {})
    nodes: list[PaperNode] = []
    edges: list[PaperEdge] = []
    
    s2 = get_s2_service()
    
    # Fetch and store citations (if needed)
    if fetch_citations:
        citations = await s2.get_citations(external_id, limit=limit)
        s2_graph["citations"] = []
        s2_graph["citations_fetched_at"] = datetime.now().isoformat()
        
        for c in citations:
            node_id = f"s2-{c.external_id}"
            s2_url = _get_s2_url(c.external_id)
            nodes.append(PaperNode(
                id=node_id,
                title=c.title,
                authors=c.authors,
                year=c.year,
                venue=c.venue,
                citation_count=c.citation_count,
                is_local=False,
                external_id=c.external_id,
                s2_url=s2_url,
            ))
            edges.append(PaperEdge(
                source=node_id,
                target="current",
                relation="cited_by",
            ))
            s2_graph["citations"].append({
                "external_id": c.external_id,
                "title": c.title,
                "authors": c.authors,
                "year": c.year,
                "venue": c.venue,
                "citation_count": c.citation_count,
            })
        logger.info(f"Stored {len(citations)} citations for paper {paper_id}")
    
    # Fetch and store references (permanent, only once)
    if fetch_references:
        references = await s2.get_references(external_id, limit=limit)
        s2_graph["references"] = []
        s2_graph["references_fetched_at"] = datetime.now().isoformat()
        
        for r in references:
            node_id = f"s2-{r.external_id}"
            s2_url = _get_s2_url(r.external_id)
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
                    s2_url=s2_url,
                ))
            edges.append(PaperEdge(
                source="current",
                target=node_id,
                relation="cites",
            ))
            s2_graph["references"].append({
                "external_id": r.external_id,
                "title": r.title,
                "authors": r.authors,
                "year": r.year,
                "venue": r.venue,
                "citation_count": r.citation_count,
            })
        logger.info(f"Stored {len(references)} references for paper {paper_id}")
    
    # Save to store
    paper["s2_graph"] = s2_graph
    store.update(paper_id, paper)
    
    return nodes, edges


@router.get("/{paper_id}/graph", response_model=PaperGraphResponse)
async def get_paper_graph(
    paper_id: str,
    include_local: bool = Query(True, description="包含本地相似论文"),
    include_citations: bool = Query(True, description="包含 S2 引用"),
    include_references: bool = Query(True, description="包含 S2 参考文献"),
    limit: int = Query(50, ge=1, le=100, description="每类最大数量"),
    force_refresh: bool = Query(False, description="强制刷新"),
) -> PaperGraphResponse:
    """
    获取论文关系图 v0.1
    
    数据存储策略:
    - 参考文献: 永久存储，只获取一次
    - 被引论文: 每 10 天刷新一次
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if paper.get("status") != "completed":
        raise HTTPException(status_code=400, detail=f"论文尚未解析完成")
    
    # Build external ID
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
    from_store = False
    
    if external_id and S2_AVAILABLE:
        has_refs = _has_stored_references(paper)
        needs_citation_refresh = _should_refresh_citations(paper)
        
        # Determine what to fetch
        fetch_citations = force_refresh or needs_citation_refresh or not paper.get("s2_graph", {}).get("citations")
        fetch_references = force_refresh or not has_refs
        
        if not fetch_citations and not fetch_references:
            # Use stored data
            nodes, edges = _load_from_store(paper)
            from_store = True
            logger.info(f"Loaded graph from store for paper {paper_id}")
        else:
            # Fetch from S2 and store
            try:
                # If we have stored refs but only need citations refresh
                if has_refs and not fetch_references:
                    s2_graph = paper.get("s2_graph", {})
                    # Load existing references
                    for r in s2_graph.get("references", []):
                        node_id = f"s2-{r['external_id']}"
                        nodes.append(PaperNode(
                            id=node_id,
                            title=r["title"],
                            authors=r.get("authors", []),
                            year=r.get("year"),
                            venue=r.get("venue"),
                            citation_count=r.get("citation_count"),
                            is_local=False,
                            external_id=r["external_id"],
                            s2_url=_get_s2_url(r["external_id"]),
                        ))
                        edges.append(PaperEdge(
                            source="current",
                            target=node_id,
                            relation="cites",
                        ))
                    # Fetch only citations
                    new_nodes, new_edges = await _fetch_and_store_s2(
                        paper_id, external_id, limit,
                        fetch_citations=True, fetch_references=False
                    )
                    nodes.extend([n for n in new_nodes if not any(x.id == n.id for x in nodes)])
                    edges.extend(new_edges)
                else:
                    # Fetch both
                    nodes, edges = await _fetch_and_store_s2(
                        paper_id, external_id, limit,
                        fetch_citations=fetch_citations, fetch_references=fetch_references
                    )
            except Exception as e:
                logger.warning(f"S2 API error for paper {paper_id}: {e}")
                # Try to load from store anyway
                nodes, edges = _load_from_store(paper)
                from_store = True
    
    return PaperGraphResponse(
        current_paper=current,
        nodes=nodes,
        edges=edges,
        from_store=from_store,
    )


@router.get("/{paper_id}/graph/expand/{node_external_id}")
async def expand_paper_node(
    paper_id: str,
    node_external_id: str,
    limit: int = Query(20, ge=1, le=50, description="最大数量"),
) -> PaperGraphResponse:
    """
    展开二级引用 - 获取指定节点的引用关系
    
    用于点击图中的论文节点后，获取该论文的引用/参考文献
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if not S2_AVAILABLE:
        raise HTTPException(status_code=503, detail="S2 API 不可用")
    
    # Normalize the external ID for S2 API
    s2_id = node_external_id
    if node_external_id.startswith("CorpusId:"):
        s2_id = node_external_id
    
    s2 = get_s2_service()
    nodes: list[PaperNode] = []
    edges: list[PaperEdge] = []
    
    try:
        # Get the paper info
        target_paper = await s2.get_paper(s2_id)
        if not target_paper:
            raise HTTPException(status_code=404, detail="S2 论文不存在")
        
        current = CurrentPaper(
            id=f"s2-{target_paper.external_id}",
            title=target_paper.title,
            external_id=target_paper.external_id,
        )
        
        # Get citations of this paper
        citations = await s2.get_citations(s2_id, limit=limit)
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
                s2_url=_get_s2_url(c.external_id),
            ))
            edges.append(PaperEdge(
                source=node_id,
                target=f"s2-{target_paper.external_id}",
                relation="cited_by",
            ))
        
        # Get references of this paper
        references = await s2.get_references(s2_id, limit=limit)
        for r in references:
            node_id = f"s2-{r.external_id}"
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
                    s2_url=_get_s2_url(r.external_id),
                ))
            edges.append(PaperEdge(
                source=f"s2-{target_paper.external_id}",
                target=node_id,
                relation="cites",
            ))
        
        return PaperGraphResponse(
            current_paper=current,
            nodes=nodes,
            edges=edges,
            from_store=False,
        )
    
    except S2RateLimitError as e:
        logger.warning(f"S2 rate limit for expand node: {e}")
        raise HTTPException(status_code=429, detail="Semantic Scholar API 请求频繁，请稍后再试")
    except S2ApiError as e:
        logger.warning(f"S2 API error for expand node: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Expand node error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
