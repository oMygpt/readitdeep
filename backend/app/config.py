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
    # 是否开放自助注册。关闭后只能由管理员创建账号（第一个账号仍可注册为管理员）；
    # 关联 PaperDaily 后本地注册与密码登录整体关闭
    allow_registration: bool = True

    # ---------- 部署模式 ----------
    # standalone（默认）：本地账号。linked：只用 PaperDaily 账号登录（见 docs/plans/paperdaily-connect-contract.md）
    rid_mode: Literal["standalone", "linked"] = "standalone"
    public_base_url: str = "http://localhost:3000"  # 本站对外地址，用于拼 OAuth 回调
    paperdaily_base_url: str = "https://paperdaily.org"  # 服务端调用 /api/auth/connect/*
    paperdaily_web_url: str = "https://paperdaily.org"   # 浏览器授权页 /connect/read 所在站点
    paperdaily_issuer: str = "https://paperdaily.org"    # 令牌 subject.issuer 必须等于此值
    # 登录后授予本站管理员的 PaperDaily 用户（subject.sub，逗号分隔）
    paperdaily_admin_subjects: str = ""
    paperdaily_client_id: str = "read"
    paperdaily_client_secret: str = ""
    paperdaily_webhook_secret: str = ""  # 主站目前只提供拉取接口；配置后才接受推送
    # 委托 key 加密密钥：逗号分隔的 "版本:base64(32 字节)"，第一个用于加密，其余仅用于解密（轮换）
    paperdaily_token_keys: str = ""
    paperdaily_scopes: str = ""  # Default identity only; research scopes require an explicit consent flow.
    # 关联模式下的本地 JWT 有效期（分钟），设计上限 15
    linked_jwt_minutes: int = 15

    # ---------- 系列站（设计 2026-10-27 v0.2）----------
    # 管理员可为各任务选择的模型（逗号分隔）。linked 模式下系统配置里的模型名必须在此列表内
    allowed_models: str = ""
    # 「获取开放获取 PDF」只从这些域名（含子域）下载
    oa_pdf_hosts: str = "arxiv.org,export.arxiv.org"
    oa_pdf_max_bytes: int = 50 * 1024 * 1024
    # 按篇计费：off（不计费，独立模式或主站计费开通前）| paperdaily（主站 read-jobs）
    read_billing: Literal["off", "paperdaily"] = "off"
    read_free_paper_limit: int = 5  # 注册（非 Pro/机构）用户每周期可处理的 PDF 篇数
    read_free_paper_period: Literal["month", "lifetime"] = "month"
    read_chat_daily_limit_free: int = 50  # 问答、划词翻译等交互 AI 的每日次数
    read_chat_daily_limit_paid: int = 300
    # 主站 read-jobs 受信 runner 身份与 client assertion 密钥（只放保险库）
    paperdaily_runner_id: str = "rid"
    paperdaily_runner_secret: str = ""
    paperdaily_assertion_secret: str = ""

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
    llm_concurrency_vlm: int = 4
    # 每个进程同时处理的任务数（0 = 默认：解析 2、分析 2、翻译 1）。关联主站计费时，解析数不应超过主站 read.bridge.concurrency
    jobs_parse_concurrency: int = 0
    jobs_analyze_concurrency: int = 0
    jobs_translate_concurrency: int = 0

    # 视觉模型（PDF 逐页转写）。地址/Key 为空时沿用主 LLM 的；vlm_model 为空则不启用
    vlm_base_url: str = ""
    vlm_api_key: str = ""
    vlm_model: str = ""
    vlm_max_pages: int = 80
    
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

    # 论文解析：GROBID 地址与解析器顺序（见 app/services/parsing）
    grobid_url: str = ""
    parse_providers: str = ""
    
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
