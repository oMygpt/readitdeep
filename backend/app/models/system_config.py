"""
Read it DEEP - 系统配置模型

多用户支持 - 管理员配置系统级别设置
"""

from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime

from app.core.database import Base


class SystemConfig(Base):
    """系统配置表"""
    __tablename__ = "system_configs"
    
    key = Column(String, primary_key=True, index=True)
    value = Column(JSON, nullable=True)
    description = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String, nullable=True)  # 管理员 ID


# 默认系统配置
DEFAULT_SYSTEM_CONFIG = {
    # ==================== 主 LLM 配置 ====================
    "llm_mode": {
        "value": "shared",  # 'shared' | 'user_defined'
        "description": "主 LLM 模式：shared=全局共享，user_defined=允许用户自定义"
    },
    "llm_base_url": {
        "value": "http://localhost:8000/v1",
        "description": "主 LLM API Base URL"
    },
    "llm_model": {
        "value": "qwen2.5-72b",
        "description": "主 LLM 模型名称"
    },
    "llm_api_key": {
        "value": "",
        "description": "主 LLM API Key"
    },
    
    # ==================== 翻译 LLM 配置 ====================
    "translation_mode": {
        "value": "shared",  # 'shared' | 'user_defined' | 'disabled'
        "description": "翻译服务模式"
    },
    "translation_base_url": {
        "value": "",
        "description": "翻译 LLM Base URL (空则使用主 LLM)"
    },
    "translation_model": {
        "value": "",
        "description": "翻译模型 (空则使用主 LLM)"
    },
    "translation_api_key": {
        "value": "",
        "description": "翻译 API Key (空则使用主 LLM)"
    },
    
    # ==================== Embedding 配置 (全局) ====================
    "embedding_base_url": {
        "value": "http://localhost:8000/v1",
        "description": "Embedding API URL (全局固定)"
    },
    "embedding_model": {
        "value": "bge-m3",
        "description": "Embedding 模型 (全局固定)"
    },
    "embedding_api_key": {
        "value": "",
        "description": "Embedding API Key"
    },
    
    # ==================== MinerU 配置 ====================
    "mineru_mode": {
        "value": "shared",  # 'shared' | 'user_defined' | 'self_hosted'
        "description": "MinerU 配置模式"
    },
    "mineru_api_url": {
        "value": "https://mineru.net/api/v4",
        "description": "MinerU API URL"
    },
    "mineru_api_key": {
        "value": "",
        "description": "MinerU API Key"
    },
    "mineru_self_hosted_url": {
        "value": "",
        "description": "自部署 MinerU URL"
    },
    
    # ==================== 智能分析配置 ====================
    "smart_analysis_mode": {
        "value": "inherit",  # 'inherit' | 'custom'
        "description": "智能分析模式：inherit=继承主LLM，custom=独立配置"
    },
    
    # Math 解析配置 (custom 模式时使用)
    "smart_math_base_url": {
        "value": "",
        "description": "Math 解析 LLM Base URL (空则继承主LLM)"
    },
    "smart_math_model": {
        "value": "",
        "description": "Math 解析模型"
    },
    "smart_math_api_key": {
        "value": "",
        "description": "Math 解析 API Key"
    },
    
    # 费曼教学配置
    "smart_feynman_base_url": {
        "value": "",
        "description": "费曼教学 LLM Base URL"
    },
    "smart_feynman_model": {
        "value": "",
        "description": "费曼教学模型"
    },
    "smart_feynman_api_key": {
        "value": "",
        "description": "费曼教学 API Key"
    },
    
    # 深度研究配置
    "smart_deep_base_url": {
        "value": "",
        "description": "深度研究 LLM Base URL"
    },
    "smart_deep_model": {
        "value": "",
        "description": "深度研究模型"
    },
    "smart_deep_api_key": {
        "value": "",
        "description": "深度研究 API Key"
    },
    
    # Chat with PDF 配置
    "smart_chat_base_url": {
        "value": "",
        "description": "Chat with PDF LLM Base URL"
    },
    "smart_chat_model": {
        "value": "",
        "description": "Chat with PDF 模型"
    },
    "smart_chat_api_key": {
        "value": "",
        "description": "Chat with PDF API Key"
    },
}
