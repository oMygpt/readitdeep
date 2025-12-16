"""
Read it DEEP - 文本向量化服务 (Volcengine Embedding)

API 文档: /docs/enbedding.md
Endpoint: https://ark.cn-beijing.volces.com/api/v3/embeddings
Model: doubao-embedding-text-240715
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
    """
    文本向量化服务
    
    支持:
    - Volcengine ARK API (doubao-embedding)
    - OpenAI-compatible API (本地 vLLM)
    """
    
    # Volcengine ARK API
    VOLCENGINE_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings"
    
    def __init__(self):
        settings = get_settings()
        self.provider = settings.embedding_provider  # "local" or "volcengine"
        self.base_url = settings.embedding_base_url
        self.api_key = settings.embedding_api_key
        self.model = settings.embedding_model
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
        """
        将文本列表转换为向量
        
        Args:
            texts: 文本列表
            model: 模型名称 (可选，默认使用配置的模型)
        
        Returns:
            EmbeddingResult: 包含向量和 token 用量
        """
        if not texts:
            return EmbeddingResult(
                embeddings=[],
                prompt_tokens=0,
                total_tokens=0,
                success=True,
            )
        
        model = model or self.model
        
        try:
            if self.provider == "volcengine":
                return await self._embed_volcengine(texts, model)
            else:
                return await self._embed_openai_compatible(texts, model)
        except Exception as e:
            return EmbeddingResult(
                embeddings=[],
                prompt_tokens=0,
                total_tokens=0,
                success=False,
                error=str(e),
            )
    
    async def _embed_volcengine(
        self,
        texts: list[str],
        model: str,
    ) -> EmbeddingResult:
        """
        调用 Volcengine ARK API
        
        POST https://ark.cn-beijing.volces.com/api/v3/embeddings
        """
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
        
        # 提取向量
        embeddings = [item["embedding"] for item in result["data"]]
        
        return EmbeddingResult(
            embeddings=embeddings,
            prompt_tokens=result["usage"]["prompt_tokens"],
            total_tokens=result["usage"]["total_tokens"],
            success=True,
        )
    
    async def _embed_openai_compatible(
        self,
        texts: list[str],
        model: str,
    ) -> EmbeddingResult:
        """
        调用 OpenAI 兼容接口 (vLLM, Ollama 等)
        
        POST {base_url}/embeddings
        """
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
        
        # 提取向量 (OpenAI 格式)
        embeddings = [item["embedding"] for item in result["data"]]
        
        usage = result.get("usage", {})
        return EmbeddingResult(
            embeddings=embeddings,
            prompt_tokens=usage.get("prompt_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            success=True,
        )
    
    async def embed_single(self, text: str) -> list[float]:
        """
        单文本向量化 (便捷方法)
        """
        result = await self.embed_texts([text])
        if result.success and result.embeddings:
            return result.embeddings[0]
        return []


# 单例
_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service
