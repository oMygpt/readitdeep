"""
Read it DEEP - Prompt 加载器

从 Markdown 文件加载 Prompt：
- 支持 YAML frontmatter 元数据
- 支持版本管理
- 支持目录扫描自动发现
"""

import os
import re
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

import yaml

logger = logging.getLogger(__name__)

# Prompt 文件目录
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


@dataclass
class PromptFile:
    """从文件加载的 Prompt"""
    type: str
    version: str
    description: str
    system_prompt: str
    user_prompt_template: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    file_path: Optional[str] = None


def parse_prompt_file(content: str, file_path: str = "") -> Optional[PromptFile]:
    """
    解析 Prompt Markdown 文件
    
    格式:
    ---
    type: summary
    version: v1.0.0
    description: 描述
    created_at: 2025-12-15
    ---
    
    # System Prompt
    系统提示内容
    
    # User Prompt
    用户提示内容（包含 {content} 占位符）
    """
    # 分离 frontmatter 和正文
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
    if not fm_match:
        logger.warning(f"Invalid prompt file format: {file_path}")
        return None
    
    try:
        frontmatter = yaml.safe_load(fm_match.group(1))
        body = fm_match.group(2)
    except yaml.YAMLError as e:
        logger.error(f"YAML parse error in {file_path}: {e}")
        return None
    
    # 提取 System Prompt 和 User Prompt
    system_match = re.search(r'#\s*System\s+Prompt\s*\n(.*?)(?=#\s*User\s+Prompt|\Z)', body, re.DOTALL | re.IGNORECASE)
    user_match = re.search(r'#\s*User\s+Prompt\s*\n(.*?)(?=\Z)', body, re.DOTALL | re.IGNORECASE)
    
    if not system_match or not user_match:
        logger.warning(f"Missing System/User Prompt sections in {file_path}")
        return None
    
    system_prompt = system_match.group(1).strip()
    user_prompt = user_match.group(1).strip()
    
    # 解析 created_at
    created_at = frontmatter.get("created_at")
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at)
        except ValueError:
            created_at = datetime.utcnow()
    elif not isinstance(created_at, datetime):
        created_at = datetime.utcnow()
    
    return PromptFile(
        type=frontmatter.get("type", "unknown"),
        version=frontmatter.get("version", "v1.0.0"),
        description=frontmatter.get("description", ""),
        system_prompt=system_prompt,
        user_prompt_template=user_prompt,
        created_at=created_at,
        file_path=file_path,
    )


def load_prompt_file(file_path: Path) -> Optional[PromptFile]:
    """加载单个 Prompt 文件"""
    try:
        content = file_path.read_text(encoding="utf-8")
        return parse_prompt_file(content, str(file_path))
    except Exception as e:
        logger.error(f"Failed to load prompt file {file_path}: {e}")
        return None


def discover_prompts(prompts_dir: Path = PROMPTS_DIR) -> dict[str, list[PromptFile]]:
    """
    发现并加载所有 Prompt 文件
    
    Returns:
        字典: {prompt_type: [PromptFile, ...]}
    """
    prompts: dict[str, list[PromptFile]] = {}
    
    if not prompts_dir.exists():
        logger.warning(f"Prompts directory not found: {prompts_dir}")
        return prompts
    
    for type_dir in prompts_dir.iterdir():
        if not type_dir.is_dir():
            continue
        
        prompt_type = type_dir.name
        prompts[prompt_type] = []
        
        for md_file in type_dir.glob("*.md"):
            prompt = load_prompt_file(md_file)
            if prompt:
                prompts[prompt_type].append(prompt)
                logger.info(f"Loaded prompt: {prompt_type}/{prompt.version}")
        
        # 按版本排序
        prompts[prompt_type].sort(key=lambda p: p.version)
    
    return prompts


class PromptLoader:
    """
    Prompt 加载器 - 单例模式
    
    提供从文件加载 Prompt 的接口
    """
    _instance: Optional["PromptLoader"] = None
    _prompts: dict[str, list[PromptFile]] = {}
    _active_versions: dict[str, str] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_all()
        return cls._instance
    
    def _load_all(self):
        """加载所有 Prompt"""
        self._prompts = discover_prompts()
        
        # 设置默认活跃版本 (每个类型的最新版本)
        for prompt_type, versions in self._prompts.items():
            if versions:
                self._active_versions[prompt_type] = versions[-1].version
    
    def reload(self):
        """重新加载所有 Prompt"""
        self._load_all()
    
    def get_prompt(self, prompt_type: str, version: Optional[str] = None) -> Optional[PromptFile]:
        """
        获取指定类型和版本的 Prompt
        
        Args:
            prompt_type: Prompt 类型 (summary, method, dataset, code, classification)
            version: 版本号，None 则使用活跃版本
        """
        versions = self._prompts.get(prompt_type, [])
        if not versions:
            return None
        
        target_version = version or self._active_versions.get(prompt_type)
        
        for p in versions:
            if p.version == target_version:
                return p
        
        # 返回最新版本作为 fallback
        return versions[-1] if versions else None
    
    def list_versions(self, prompt_type: str) -> list[dict]:
        """列出指定类型的所有版本"""
        versions = self._prompts.get(prompt_type, [])
        active = self._active_versions.get(prompt_type)
        return [
            {
                "version": p.version,
                "description": p.description,
                "is_active": p.version == active,
                "file_path": p.file_path,
            }
            for p in versions
        ]
    
    def set_active_version(self, prompt_type: str, version: str) -> bool:
        """设置活跃版本"""
        versions = self._prompts.get(prompt_type, [])
        if any(p.version == version for p in versions):
            self._active_versions[prompt_type] = version
            return True
        return False
    
    def get_all_types(self) -> list[str]:
        """获取所有 Prompt 类型"""
        return list(self._prompts.keys())


# 便捷函数
def get_prompt_loader() -> PromptLoader:
    """获取 PromptLoader 单例"""
    return PromptLoader()
