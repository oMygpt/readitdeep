"""
Read it DEEP - Semantic Scholar API 服务

使用官方 HTTP API 获取论文引用、参考文献、推荐论文
API 文档: https://api.semanticscholar.org/api-docs/

限流规则 (无 API Key): 100 请求/5分钟
"""

from typing import Optional, List
from dataclasses import dataclass
import logging
import httpx

logger = logging.getLogger(__name__)

# S2 API Base URL
S2_API_BASE = "https://api.semanticscholar.org/graph/v1"

# Default fields to request for papers
PAPER_FIELDS = "paperId,corpusId,externalIds,title,authors,year,venue,citationCount,openAccessPdf,abstract"


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


class S2RateLimitError(Exception):
    """S2 API 限流错误"""
    pass


class S2ApiError(Exception):
    """S2 API 错误"""
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class SemanticScholarService:
    """
    Semantic Scholar API 封装 (HTTP 版本)
    
    使用官方 REST API 而非 Python 库，避免 uvloop 兼容性问题。
    限流: 无 API Key 时 100 请求/5 分钟
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.headers = {}
        if api_key:
            self.headers["x-api-key"] = api_key
        
        # Use async httpx client
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=S2_API_BASE,
                headers=self.headers,
                timeout=30.0,
            )
        return self._client
    
    def _paper_from_dict(self, data: dict) -> S2Paper:
        """Convert S2 API response dict to S2Paper dataclass"""
        external_ids = data.get("externalIds") or {}
        corpus_id = data.get("corpusId")
        paper_id = data.get("paperId", "")
        
        return S2Paper(
            external_id=f"CorpusId:{corpus_id}" if corpus_id else paper_id,
            title=data.get("title") or "",
            authors=[a.get("name", "") for a in (data.get("authors") or [])],
            year=data.get("year"),
            venue=data.get("venue"),
            citation_count=data.get("citationCount"),
            doi=external_ids.get("DOI"),
            arxiv_id=external_ids.get("ArXiv"),
            abstract=data.get("abstract"),
        )
    
    async def get_paper(self, paper_id: str) -> Optional[S2Paper]:
        """
        通过 ID 获取论文
        
        支持格式:
        - DOI: "DOI:10.1093/mind/lix.236.433"
        - ArXiv: "ARXIV:2106.09685"
        - CorpusId: "CorpusId:12345678"
        - S2 Paper ID: 直接使用 paperId
        
        注意: ArXiv ID 格式需要 "ARXIV:" 前缀（大写）
        
        Raises:
            S2RateLimitError: API 限流
            S2ApiError: 其他 API 错误
        """
        try:
            client = await self._get_client()
            
            # Normalize arXiv ID format: arXiv:xxx -> ARXIV:xxx
            if paper_id.lower().startswith("arxiv:"):
                paper_id = "ARXIV:" + paper_id.split(":", 1)[1]
            
            response = await client.get(
                f"/paper/{paper_id}",
                params={"fields": PAPER_FIELDS}
            )
            
            if response.status_code == 404:
                logger.info(f"S2: Paper not found: {paper_id}")
                return None
            
            if response.status_code == 429:
                logger.warning(f"S2: Rate limited for {paper_id}")
                raise S2RateLimitError("Semantic Scholar API 请求过于频繁，请稍后再试")
            
            response.raise_for_status()
            data = response.json()
            return self._paper_from_dict(data)
            
        except S2RateLimitError:
            raise
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 get_paper HTTP error for {paper_id}: {e.response.status_code}")
            if e.response.status_code == 429:
                raise S2RateLimitError("Semantic Scholar API 请求过于频繁，请稍后再试")
            raise S2ApiError(f"S2 API 错误: {e.response.status_code}", e.response.status_code)
        except Exception as e:
            logger.warning(f"S2 get_paper error for {paper_id}: {e}")
            raise S2ApiError(f"S2 API 连接错误: {str(e)}")
    
    async def get_citations(self, paper_id: str, limit: int = 20) -> list[S2Paper]:
        """
        获取引用该论文的论文列表 (Citations = 谁引用了这篇)
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        try:
            client = await self._get_client()
            
            # Normalize arXiv ID format
            if paper_id.lower().startswith("arxiv:"):
                paper_id = "ARXIV:" + paper_id.split(":", 1)[1]
            
            response = await client.get(
                f"/paper/{paper_id}/citations",
                params={
                    "fields": PAPER_FIELDS,
                    "limit": limit
                }
            )
            
            if response.status_code == 404:
                logger.info(f"S2: Paper not found for citations: {paper_id}")
                return []
            
            response.raise_for_status()
            data = response.json()
            
            results = []
            for item in data.get("data", []):
                citing_paper = item.get("citingPaper")
                if citing_paper and citing_paper.get("title"):
                    results.append(self._paper_from_dict(citing_paper))
            
            logger.info(f"S2: Found {len(results)} citations for {paper_id}")
            return results
            
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 get_citations HTTP error for {paper_id}: {e.response.status_code}")
            return []
        except Exception as e:
            logger.warning(f"S2 get_citations error for {paper_id}: {e}")
            return []
    
    async def get_references(self, paper_id: str, limit: int = 20) -> list[S2Paper]:
        """
        获取该论文引用的论文列表 (References = 这篇引用了谁)
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        try:
            client = await self._get_client()
            
            # Normalize arXiv ID format
            if paper_id.lower().startswith("arxiv:"):
                paper_id = "ARXIV:" + paper_id.split(":", 1)[1]
            
            response = await client.get(
                f"/paper/{paper_id}/references",
                params={
                    "fields": PAPER_FIELDS,
                    "limit": limit
                }
            )
            
            if response.status_code == 404:
                logger.info(f"S2: Paper not found for references: {paper_id}")
                return []
            
            response.raise_for_status()
            data = response.json()
            
            results = []
            for item in data.get("data", []):
                cited_paper = item.get("citedPaper")
                if cited_paper and cited_paper.get("title"):
                    results.append(self._paper_from_dict(cited_paper))
            
            logger.info(f"S2: Found {len(results)} references for {paper_id}")
            return results
            
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 get_references HTTP error for {paper_id}: {e.response.status_code}")
            return []
        except Exception as e:
            logger.warning(f"S2 get_references error for {paper_id}: {e}")
            return []
    
    async def get_recommendations(self, paper_id: str, limit: int = 10) -> list[S2Paper]:
        """
        获取基于该论文的推荐论文
        
        注意: S2 官方 API 没有直接的推荐端点，
        这里使用相关论文搜索作为替代方案
        
        Args:
            paper_id: 论文 ID (DOI/ArXiv/CorpusId)
            limit: 最大返回数量
        """
        # S2 Graph API doesn't have a direct recommendations endpoint
        # As a workaround, we return an empty list
        # Future: could use paper title to search for similar papers
        logger.info(f"S2: Recommendations not available via Graph API for {paper_id}")
        return []
    
    async def search_paper(self, query: str, limit: int = 10) -> list[S2Paper]:
        """
        搜索论文
        
        Args:
            query: 搜索关键词
            limit: 最大返回数量
        """
        try:
            client = await self._get_client()
            
            response = await client.get(
                "/paper/search",
                params={
                    "query": query,
                    "fields": PAPER_FIELDS,
                    "limit": limit
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            results = []
            for paper_data in data.get("data", []):
                if paper_data.get("title"):
                    results.append(self._paper_from_dict(paper_data))
            
            return results
            
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 search_paper HTTP error for '{query}': {e.response.status_code}")
            return []
        except Exception as e:
            logger.warning(f"S2 search_paper error for '{query}': {e}")
            return []
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None


# S2 service is always available with HTTP API
S2_AVAILABLE = True

# 单例
_s2_service: Optional[SemanticScholarService] = None


def get_s2_service() -> SemanticScholarService:
    """获取 Semantic Scholar 服务实例"""
    global _s2_service
    if _s2_service is None:
        _s2_service = SemanticScholarService()
    return _s2_service
