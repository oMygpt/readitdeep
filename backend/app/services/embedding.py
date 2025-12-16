"""
Read it DEEP - 文本向量化服务 (Multi-User Adapted)
"""

from typing import Optional
from dataclasses import dataclass

import httpx

from app.config import get_settings


@dataclass
class EmbeddingResult:
    """向量化结果"""
    embeddings: list[list[float]]
    prompt_tokens: int
    total_tokens: int
    success: bool
    error: Optional[str] = None


class EmbeddingService:
    """文本向量化服务"""
    
    VOLCENGINE_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings"
    
    def __init__(
        self, 
        provider: str = "local",
        base_url: str = "",
        api_key: str = "",
        model: str = ""
    ):
        settings = get_settings()
        # Use provided args or fallback to settings
        self.provider = provider or settings.embedding_provider
        self.base_url = base_url or settings.embedding_base_url
        self.api_key = api_key or settings.embedding_api_key
        self.model = model or settings.embedding_model
        
        self._client: Optional[httpx.AsyncClient] = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def embed_texts(
        self,
        texts: list[str],
        model: Optional[str] = None,
    ) -> EmbeddingResult:
        if not texts:
            return EmbeddingResult([], 0, 0, True)
        
        model = model or self.model
        
        try:
            if self.provider == "volcengine":
                return await self._embed_volcengine(texts, model)
            else:
                return await self._embed_openai_compatible(texts, model)
        except Exception as e:
            return EmbeddingResult([], 0, 0, False, str(e))
    
    async def _embed_volcengine(self, texts: list[str], model: str) -> EmbeddingResult:
        response = await self.client.post(
            self.VOLCENGINE_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            json={
                "model": model,
                "input": texts,
                "encoding_format": "float",
            },
        )
        response.raise_for_status()
        result = response.json()
        
        embeddings = [item["embedding"] for item in result["data"]]
        return EmbeddingResult(
            embeddings=embeddings,
            prompt_tokens=result.get("usage", {}).get("prompt_tokens", 0),
            total_tokens=result.get("usage", {}).get("total_tokens", 0),
            success=True,
        )
    
    async def _embed_openai_compatible(self, texts: list[str], model: str) -> EmbeddingResult:
        url = f"{self.base_url.rstrip('/')}/embeddings"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        response = await self.client.post(
            url,
            headers=headers,
            json={
                "model": model,
                "input": texts,
            },
        )
        response.raise_for_status()
        result = response.json()
        
        embeddings = [item["embedding"] for item in result["data"]]
        usage = result.get("usage", {})
        return EmbeddingResult(
            embeddings=embeddings,
            prompt_tokens=usage.get("prompt_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            success=True,
        )
    
    async def embed_single(self, text: str) -> list[float]:
        result = await self.embed_texts([text])
        if result.success and result.embeddings:
            return result.embeddings[0]
        return []
