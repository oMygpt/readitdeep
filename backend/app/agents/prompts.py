"""
Read it DEEP - 内容分析 Prompt 版本管理

支持功能:
- 版本化管理所有 Agent Prompt
- 支持迭代和 A/B 测试
- 记录 Prompt 变更历史
- (Refactored) 动态从 Markdown 文件加载 Prompt
"""

from typing import Optional
from enum import Enum
from app.agents.prompt_loader import get_prompt_loader, PromptFile


class PromptType(Enum):
    """Prompt 类型"""
    SUMMARY = "summary"
    METHOD = "method"
    DATASET = "dataset"
    CODE = "code"


# =============================================================================
# Prompt Registry - 版本管理中心 (Refactored to use PromptLoader)
# =============================================================================

class PromptRegistry:
    """
    Prompt 版本注册中心
    
    支持:
    - 获取当前活跃版本
    - 按版本号获取特定版本
    - 列出所有版本
    - 切换活跃版本
    """
    
    @classmethod
    def get_loader(cls):
        return get_prompt_loader()
    
    @classmethod
    def get_active_prompt(cls, prompt_type: PromptType) -> PromptFile:
        """获取指定类型的当前活跃 Prompt"""
        loader = cls.get_loader()
        prompt = loader.get_prompt(prompt_type.value)
        if not prompt:
            # Fallback if no prompt found (shouldn't happen if files exist)
            raise ValueError(f"No prompt found for {prompt_type.value}")
        return prompt
    
    @classmethod
    def get_prompt(cls, prompt_type: PromptType, version: str) -> PromptFile:
        """获取指定类型和版本的 Prompt"""
        loader = cls.get_loader()
        prompt = loader.get_prompt(prompt_type.value, version)
        if not prompt:
            raise ValueError(f"No prompt found for {prompt_type.value} version {version}")
        return prompt
    
    @classmethod
    def list_versions(cls, prompt_type: PromptType) -> list[dict]:
        """列出指定类型的所有版本"""
        loader = cls.get_loader()
        return loader.list_versions(prompt_type.value)
    
    @classmethod
    def set_active_version(cls, prompt_type: PromptType, version: str) -> bool:
        """设置指定类型的活跃版本"""
        loader = cls.get_loader()
        return loader.set_active_version(prompt_type.value, version)
    
    @classmethod
    def get_all_active_versions(cls) -> dict[str, str]:
        """获取所有类型的活跃版本"""
        loader = cls.get_loader()
        return loader._active_versions.copy()


# 便捷函数
def get_summary_prompt() -> PromptFile:
    return PromptRegistry.get_active_prompt(PromptType.SUMMARY)

def get_method_prompt() -> PromptFile:
    return PromptRegistry.get_active_prompt(PromptType.METHOD)

def get_dataset_prompt() -> PromptFile:
    return PromptRegistry.get_active_prompt(PromptType.DATASET)

def get_code_prompt() -> PromptFile:
    return PromptRegistry.get_active_prompt(PromptType.CODE)
