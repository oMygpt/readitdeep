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
    cors_origins: str = "*"
    # 是否允许普通用户自定义 LLM/MinerU 等服务地址（托管部署应保持 false，见 app/core/url_guard.py）
    allow_user_endpoints: bool = False
    
    # 数据库 (SQLite 本地开发 / PostgreSQL 生产)
    database_url: str = "sqlite"  # 使用 sqlite 自动创建本地数据库
    supabase_url: str = ""
    supabase_anon_key: str = ""
    
    # LLM 配置
    llm_base_url: str = "http://localhost:8000/v1"
    llm_api_key: str = ""
    llm_model: str = "qwen2.5-72b"
    # 透传给 OpenAI 兼容服务的额外参数（JSON），如校内 Qwen3 关闭思考输出：
    # {"chat_template_kwargs": {"enable_thinking": false}}
    llm_extra_body: str = ""
    # 每个进程的模型并发上限：交互（划词分析/对话/@AI）与批量（翻译/自动分析/分类）
    llm_concurrency_interactive: int = 8
    llm_concurrency_batch: int = 2
    
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
