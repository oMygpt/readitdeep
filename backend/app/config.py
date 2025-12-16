"""
Read it DEEP - 配置管理
使用 pydantic-settings 管理环境变量
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置"""
    
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),  # 尝试当前目录和上级目录
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )
    
    # 应用
    app_name: str = "Read it DEEP"
    debug: bool = False
    secret_key: str = "change-me-in-production"
    cors_origins: str = "http://localhost:5173"
    
    # 数据库 (Supabase)
    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/readitdeep"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    redis_url: str = "redis://localhost:6379/0"
    
    # LLM 配置
    llm_base_url: str = "http://localhost:8000/v1"
    llm_api_key: str = ""
    llm_model: str = "qwen2.5-72b"
    
    # 翻译 LLM
    translation_base_url: str = "http://localhost:8000/v1"
    translation_api_key: str = ""
    translation_model: str = "qwen2.5-72b"
    
    # Embedding (支持 local/volcengine)
    embedding_provider: Literal["local", "volcengine"] = "local"
    embedding_base_url: str = "http://localhost:8000/v1"  # local vLLM
    embedding_api_key: str = ""  # 本地 vLLM 或 Volcengine ARK API Key
    embedding_model: str = "bge-m3"  # 本地: bge-m3, Volcengine: doubao-embedding-text-240715
    
    # Mineru PDF 解析
    mineru_api_url: str = "https://mineru.net/api/v4"  # 正确的 API 地址
    mineru_api_key: str = ""
    
    # 文件存储
    storage_type: Literal["local", "s3"] = "local"
    storage_path: str = "./uploads"
    s3_endpoint: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = "readitdeep"
    
    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    """获取缓存的配置实例"""
    return Settings()
