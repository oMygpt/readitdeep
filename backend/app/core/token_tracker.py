"""
Read it DEEP - LLM Token 用量追踪器

功能:
- 记录每次 LLM 调用的 token 用量
- 按功能类型分类统计
- 持久化到 JSON 文件
- 提供统计查询接口
"""

import json
import os
from datetime import datetime, date
from typing import Dict, Any, Optional
from pathlib import Path
import threading
import logging
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

logger = logging.getLogger(__name__)

# 数据存储路径
DATA_DIR = Path(__file__).parent.parent.parent / "data"
TOKEN_STATS_FILE = DATA_DIR / "token_stats.json"


class TokenTracker:
    """全局 Token 用量追踪器"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._stats = self._load_stats()
    
    def _load_stats(self) -> Dict[str, Any]:
        """加载统计数据"""
        if TOKEN_STATS_FILE.exists():
            try:
                with open(TOKEN_STATS_FILE, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load token stats: {e}")
        
        return {
            "total_tokens": 0,
            "total_prompt_tokens": 0,
            "total_completion_tokens": 0,
            "by_function": {},
            "by_date": {},
            "calls_count": 0,
        }
    
    def _save_stats(self):
        """保存统计数据"""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with open(TOKEN_STATS_FILE, 'w') as f:
                json.dump(self._stats, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save token stats: {e}")
    
    def record(
        self,
        function_type: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: Optional[int] = None,
        model: str = "",
    ):
        """
        记录一次 LLM 调用的 token 用量
        
        Args:
            function_type: 功能类型 (summary, method, dataset, code, translation, smart_*)
            prompt_tokens: 输入 token 数
            completion_tokens: 输出 token 数
            total_tokens: 总 token 数 (如果提供则优先使用)
            model: 模型名称
        """
        with self._lock:
            if total_tokens is None:
                total_tokens = prompt_tokens + completion_tokens
            
            today = date.today().isoformat()
            
            # 更新总计
            self._stats["total_tokens"] += total_tokens
            self._stats["total_prompt_tokens"] += prompt_tokens
            self._stats["total_completion_tokens"] += completion_tokens
            self._stats["calls_count"] += 1
            
            # 按功能分类
            if function_type not in self._stats["by_function"]:
                self._stats["by_function"][function_type] = {
                    "total_tokens": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "calls_count": 0,
                }
            func_stats = self._stats["by_function"][function_type]
            func_stats["total_tokens"] += total_tokens
            func_stats["prompt_tokens"] += prompt_tokens
            func_stats["completion_tokens"] += completion_tokens
            func_stats["calls_count"] += 1
            
            # 按日期分类
            if today not in self._stats["by_date"]:
                self._stats["by_date"][today] = {
                    "total_tokens": 0,
                    "calls_count": 0,
                }
            date_stats = self._stats["by_date"][today]
            date_stats["total_tokens"] += total_tokens
            date_stats["calls_count"] += 1
            
            # 保存
            self._save_stats()
            
            logger.debug(
                f"Token recorded: {function_type} - "
                f"prompt={prompt_tokens}, completion={completion_tokens}, total={total_tokens}"
            )
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计数据"""
        with self._lock:
            return self._stats.copy()
    
    def reset(self):
        """重置统计数据"""
        with self._lock:
            self._stats = {
                "total_tokens": 0,
                "total_prompt_tokens": 0,
                "total_completion_tokens": 0,
                "by_function": {},
                "by_date": {},
                "calls_count": 0,
            }
            self._save_stats()


class TokenTrackingCallback(BaseCallbackHandler):
    """LangChain 回调处理器，用于追踪 token 用量"""
    
    def __init__(self, function_type: str = "unknown"):
        super().__init__()
        self.function_type = function_type
        self.tracker = TokenTracker()
    
    def on_llm_end(self, response: LLMResult, **kwargs):
        """LLM 调用结束时记录 token"""
        try:
            # 从 response 中提取 token 用量
            if response.llm_output:
                token_usage = response.llm_output.get("token_usage", {})
                prompt_tokens = token_usage.get("prompt_tokens", 0)
                completion_tokens = token_usage.get("completion_tokens", 0)
                total_tokens = token_usage.get("total_tokens", 0)
                model = response.llm_output.get("model_name", "")
                
                if total_tokens > 0 or prompt_tokens > 0 or completion_tokens > 0:
                    self.tracker.record(
                        function_type=self.function_type,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=total_tokens if total_tokens > 0 else None,
                        model=model,
                    )
        except Exception as e:
            logger.error(f"Failed to track tokens: {e}")


# 全局单例
token_tracker = TokenTracker()


def get_tracking_callback(function_type: str) -> TokenTrackingCallback:
    """获取追踪回调实例"""
    return TokenTrackingCallback(function_type=function_type)
