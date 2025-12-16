"""
Read it DEEP - Semantic Scholar API 服务

使用 semanticscholar 库获取论文引用、参考文献、推荐论文
遵守 API 限流规则 (无 key: 100请求/5分钟)
"""

from typing import Optional
from dataclasses import dataclass
import logging
import asyncio

logger = logging.getLogger(__name__)

# 使用同步库，需要在线程池中运行
try:
    from semanticscholar import SemanticScholar
    S2_AVAILABLE = True
except ImportError:
    S2_AVAILABLE = False
    logger.warning("semanticscholar library not installed. Run: pip install semanticscholar")


@dataclass
class S2Paper:
    """Semantic Scholar 论文数据"""
    external_id: str  # CorpusId:xxx or paperId
    title: str
    authors: list[str]
    year: Optional[int]
    venue: Optional[str]
    citation_count: Optional[int]
    doi: Optional[str]
    arxiv_id: Optional[str]
    abstract: Optional[str] = None


class SemanticScholarService:
    """
    Semantic Scholar API 封装
    
    限流: 无 API Key 时 100 请求/5 分钟
    """
    
    def __init__(self, api_key: Optional[str] = None):
        if not S2_AVAILABLE:
            raise ImportError("semanticscholar library not available")
        
        self.api_key = api_key
        # SemanticScholar 是同步库，需要包装
        self._sch = SemanticScholar(api_key=api_key) if api_key else SemanticScholar()
    
    def _paper_to_s2paper(self, paper) -> S2Paper:
        """转换 S2 Paper 对象为 S2Paper 数据类"""
        external_ids = paper.externalIds or {}
        return S2Paper(
            external_id=f"CorpusId:{paper.corpusId}" if paper.corpusId else paper.paperId,
            title=paper.title or "",
            authors=[a.name for a in (paper.authors or [])],
            year=paper.year,
            venue=paper.venue,
            citation_count=paper.citationCount,
            doi=external_ids.get("DOI"),
            arxiv_id=external_ids.get("ArXiv"),
            abstract=paper.abstract,
        )
    
    async def get_paper(self, paper_id: str) -> Optional[S2Paper]:
        """
        通过 ID 获取论文
        
        支持格式:
        - DOI: "10.1093/mind/lix.236.433"
        - ArXiv: "arXiv:2106.09685" 或 "2106.09685"
        - CorpusId: "CorpusId:12345678"
        """
        try:
            # 在线程池中运行同步代码
            loop = asyncio.get_event_loop()
            paper = await loop.run_in_executor(None, self._sch.get_paper, paper_id)
            if paper:
                return self._paper_to_s2paper(paper)
            return None
        except Exception as e:
            logger.warning(f"S2 get_paper error for {paper_id}: {e}")
            return None
    
    async def get_citations(self, paper_id: str, limit: int = 20) -> list[S2Paper]:
        """
        获取引用该论文的论文列表
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        try:
            loop = asyncio.get_event_loop()
            paper = await loop.run_in_executor(None, self._sch.get_paper, paper_id)
            
            if not paper or not paper.citations:
                return []
            
            citations = paper.citations[:limit]
            return [self._paper_to_s2paper(p) for p in citations if p]
        except Exception as e:
            logger.warning(f"S2 get_citations error for {paper_id}: {e}")
            return []
    
    async def get_references(self, paper_id: str, limit: int = 20) -> list[S2Paper]:
        """
        获取该论文引用的论文列表
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        try:
            loop = asyncio.get_event_loop()
            paper = await loop.run_in_executor(None, self._sch.get_paper, paper_id)
            
            if not paper or not paper.references:
                return []
            
            references = paper.references[:limit]
            return [self._paper_to_s2paper(p) for p in references if p]
        except Exception as e:
            logger.warning(f"S2 get_references error for {paper_id}: {e}")
            return []
    
    async def get_recommendations(self, paper_id: str, limit: int = 10) -> list[S2Paper]:
        """
        获取基于该论文的推荐论文
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        try:
            loop = asyncio.get_event_loop()
            recs = await loop.run_in_executor(
                None, 
                self._sch.get_recommended_papers, 
                paper_id
            )
            
            if not recs:
                return []
            
            return [self._paper_to_s2paper(p) for p in recs[:limit] if p]
        except Exception as e:
            logger.warning(f"S2 get_recommendations error for {paper_id}: {e}")
            return []
    
    async def search_paper(self, query: str, limit: int = 10) -> list[S2Paper]:
        """
        搜索论文
        
        Args:
            query: 搜索关键词
            limit: 最大返回数量
        """
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self._sch.search_paper(query, limit=limit)
            )
            
            if not results:
                return []
            
            return [self._paper_to_s2paper(p) for p in results if p]
        except Exception as e:
            logger.warning(f"S2 search_paper error for '{query}': {e}")
            return []


# 单例
_s2_service: Optional[SemanticScholarService] = None


def get_s2_service() -> SemanticScholarService:
    """获取 Semantic Scholar 服务实例"""
    global _s2_service
    if _s2_service is None:
        _s2_service = SemanticScholarService()
    return _s2_service
