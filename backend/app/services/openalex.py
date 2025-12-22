"""
Read it DEEP - OpenAlex API 服务

作为 Semantic Scholar 的后备方案，当 S2 限流时使用

API 文档: https://docs.openalex.org/
限流: 100,000 请求/天 (无需 API Key)
"""

from typing import Optional, List
from dataclasses import dataclass
import logging
import httpx

logger = logging.getLogger(__name__)

# OpenAlex API Base URL
OPENALEX_API_BASE = "https://api.openalex.org"

# Contact email for polite pool (higher rate limit)
CONTACT_EMAIL = "readitdeep@example.com"


@dataclass
class OpenAlexPaper:
    """OpenAlex 论文数据"""
    openalex_id: str  # https://openalex.org/W123456
    title: str
    authors: list[str]
    year: Optional[int]
    venue: Optional[str]
    citation_count: Optional[int]
    doi: Optional[str]
    arxiv_id: Optional[str]
    abstract: Optional[str] = None


class OpenAlexApiError(Exception):
    """OpenAlex API 错误"""
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class OpenAlexService:
    """
    OpenAlex API 封装
    
    作为 Semantic Scholar 的后备方案
    免费使用，100k 请求/天
    """
    
    def __init__(self, email: Optional[str] = None):
        self.email = email or CONTACT_EMAIL
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=OPENALEX_API_BASE,
                timeout=30.0,
                params={"mailto": self.email},  # Polite pool
            )
        return self._client
    
    def _paper_from_dict(self, data: dict) -> OpenAlexPaper:
        """Convert OpenAlex API response to OpenAlexPaper"""
        # Extract authors
        authors = []
        for authorship in data.get("authorships", []):
            author = authorship.get("author", {})
            if author.get("display_name"):
                authors.append(author["display_name"])
        
        # Extract venue
        venue = None
        primary_location = data.get("primary_location") or {}
        source = primary_location.get("source") or {}
        if source.get("display_name"):
            venue = source["display_name"]
        
        # Extract IDs
        ids = data.get("ids", {})
        doi = ids.get("doi", "").replace("https://doi.org/", "") if ids.get("doi") else None
        arxiv_id = None
        if ids.get("arxiv"):
            arxiv_id = ids["arxiv"].replace("https://arxiv.org/abs/", "")
        
        return OpenAlexPaper(
            openalex_id=data.get("id", ""),
            title=data.get("title") or "",
            authors=authors,
            year=data.get("publication_year"),
            venue=venue,
            citation_count=data.get("cited_by_count"),
            doi=doi,
            arxiv_id=arxiv_id,
            abstract=data.get("abstract"),
        )
    
    def _to_s2_format(self, paper: OpenAlexPaper) -> dict:
        """转换为 S2Paper 兼容格式"""
        return {
            "external_id": paper.openalex_id,
            "title": paper.title,
            "authors": paper.authors,
            "year": paper.year,
            "venue": paper.venue,
            "citation_count": paper.citation_count,
            "doi": paper.doi,
            "arxiv_id": paper.arxiv_id,
        }
    
    async def get_paper_by_doi(self, doi: str) -> Optional[OpenAlexPaper]:
        """通过 DOI 获取论文"""
        try:
            client = await self._get_client()
            
            # Clean DOI
            if doi.startswith("DOI:"):
                doi = doi[4:]
            if doi.startswith("https://doi.org/"):
                doi = doi.replace("https://doi.org/", "")
            
            response = await client.get(f"/works/doi:{doi}")
            
            if response.status_code == 404:
                logger.info(f"OpenAlex: Paper not found by DOI: {doi}")
                return None
            
            response.raise_for_status()
            return self._paper_from_dict(response.json())
            
        except httpx.HTTPStatusError as e:
            logger.warning(f"OpenAlex get_paper_by_doi error for {doi}: {e.response.status_code}")
            return None
        except Exception as e:
            logger.warning(f"OpenAlex get_paper_by_doi error for {doi}: {e}")
            return None
    
    async def get_paper_by_arxiv(self, arxiv_id: str) -> Optional[OpenAlexPaper]:
        """通过 arXiv ID 获取论文"""
        try:
            client = await self._get_client()
            
            # Clean arXiv ID
            if arxiv_id.lower().startswith("arxiv:"):
                arxiv_id = arxiv_id.split(":", 1)[1]
            
            response = await client.get(
                "/works",
                params={
                    "filter": f"ids.arxiv:{arxiv_id}",
                    "mailto": self.email,
                }
            )
            
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            
            if not results:
                logger.info(f"OpenAlex: Paper not found by arXiv: {arxiv_id}")
                return None
            
            return self._paper_from_dict(results[0])
            
        except Exception as e:
            logger.warning(f"OpenAlex get_paper_by_arxiv error for {arxiv_id}: {e}")
            return None
    
    async def get_paper(self, identifier: str) -> Optional[OpenAlexPaper]:
        """
        自动识别 ID 类型获取论文
        
        支持:
        - DOI: "10.1234/xxxx" 或 "DOI:10.1234/xxxx"
        - arXiv: "2106.09685" 或 "arXiv:2106.09685"
        - OpenAlex: "https://openalex.org/W123" 或 "W123"
        """
        if identifier.lower().startswith("arxiv:") or "." in identifier and "/" not in identifier:
            return await self.get_paper_by_arxiv(identifier)
        elif identifier.startswith("https://openalex.org/") or identifier.startswith("W"):
            return await self.get_paper_by_openalex_id(identifier)
        else:
            return await self.get_paper_by_doi(identifier)
    
    async def get_paper_by_openalex_id(self, openalex_id: str) -> Optional[OpenAlexPaper]:
        """通过 OpenAlex ID 获取论文"""
        try:
            client = await self._get_client()
            
            # Normalize ID
            if openalex_id.startswith("https://openalex.org/"):
                work_id = openalex_id.split("/")[-1]
            else:
                work_id = openalex_id
            
            response = await client.get(f"/works/{work_id}")
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            return self._paper_from_dict(response.json())
            
        except Exception as e:
            logger.warning(f"OpenAlex get_paper_by_openalex_id error: {e}")
            return None
    
    async def get_citations(self, identifier: str, limit: int = 20) -> list[dict]:
        """
        获取引用该论文的论文列表 (谁引用了这篇)
        
        Args:
            identifier: DOI 或 arXiv ID
            limit: 最大返回数量
        
        Returns:
            S2Paper 兼容格式的字典列表
        """
        try:
            # 先获取论文的 OpenAlex ID
            paper = await self.get_paper(identifier)
            if not paper:
                logger.info(f"OpenAlex: Cannot find paper for citations: {identifier}")
                return []
            
            work_id = paper.openalex_id.split("/")[-1]
            
            client = await self._get_client()
            response = await client.get(
                "/works",
                params={
                    "filter": f"cites:{work_id}",
                    "per-page": limit,
                    "sort": "cited_by_count:desc",
                    "mailto": self.email,
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            results = []
            for item in data.get("results", []):
                if item.get("title"):
                    paper = self._paper_from_dict(item)
                    results.append(self._to_s2_format(paper))
            
            logger.info(f"OpenAlex: Found {len(results)} citations for {identifier}")
            return results
            
        except Exception as e:
            logger.warning(f"OpenAlex get_citations error for {identifier}: {e}")
            return []
    
    async def get_references(self, identifier: str, limit: int = 20) -> list[dict]:
        """
        获取该论文引用的论文列表 (这篇引用了谁)
        
        Args:
            identifier: DOI 或 arXiv ID
            limit: 最大返回数量
        
        Returns:
            S2Paper 兼容格式的字典列表
        """
        try:
            # 先获取论文的 OpenAlex ID
            paper = await self.get_paper(identifier)
            if not paper:
                logger.info(f"OpenAlex: Cannot find paper for references: {identifier}")
                return []
            
            work_id = paper.openalex_id.split("/")[-1]
            
            client = await self._get_client()
            
            # Get the paper with referenced_works
            response = await client.get(
                f"/works/{work_id}",
                params={"select": "referenced_works"}
            )
            
            response.raise_for_status()
            data = response.json()
            
            referenced_work_ids = data.get("referenced_works", [])[:limit]
            
            if not referenced_work_ids:
                return []
            
            # Fetch details for referenced works
            work_ids = [w.split("/")[-1] for w in referenced_work_ids]
            filter_str = "|".join(work_ids)
            
            response = await client.get(
                "/works",
                params={
                    "filter": f"openalex_id:{filter_str}",
                    "per-page": limit,
                    "mailto": self.email,
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            results = []
            for item in data.get("results", []):
                if item.get("title"):
                    paper = self._paper_from_dict(item)
                    results.append(self._to_s2_format(paper))
            
            logger.info(f"OpenAlex: Found {len(results)} references for {identifier}")
            return results
            
        except Exception as e:
            logger.warning(f"OpenAlex get_references error for {identifier}: {e}")
            return []
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None


# 单例
_openalex_service: Optional[OpenAlexService] = None


def get_openalex_service() -> OpenAlexService:
    """获取 OpenAlex 服务实例"""
    global _openalex_service
    if _openalex_service is None:
        _openalex_service = OpenAlexService()
    return _openalex_service
