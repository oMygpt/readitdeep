"""
Read it DEEP - 智能分析服务

支持类型:
- math: 公式解析 (smart_math)
- feynman: 费曼教学法 (smart_feynman)
- deep: 深度研究分析 (smart_deep)
- chat: Chat with PDF 对话 (smart_chat)

配置优先级:
1. 如果 smart_analysis_mode = 'custom' 且对应字段有值，使用独立配置
2. 否则继承主 LLM 配置
"""

import logging
from typing import Dict, Any, Optional, List

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.core.store import store
from app.core.database import async_session_maker
from app.core.config_manager import ConfigManager
from app.core.token_tracker import get_tracking_callback
from app.agents.prompt_loader import get_prompt_loader

logger = logging.getLogger(__name__)
settings = get_settings()

# Action type 到 Prompt type 的映射
ACTION_TO_PROMPT = {
    "math": "smart_math",
    "feynman": "smart_feynman",
    "deep": "smart_deep",
    "chat": "smart_chat",
}

# Fallback prompts
FALLBACK_PROMPTS = {
    "math": {
        "system": "你是一位数学专家。请用清晰专业的方式解释公式含义、变量定义和推导过程。",
        "user": "请解析以下公式：\n\n{text}\n\n来源论文：{paper_title}"
    },
    "feynman": {
        "system": "你是一位优秀教师。请用简单语言解释复杂概念，像给没有专业背景的人讲解。",
        "user": "请用费曼学习法解释：\n\n{text}\n\n来源论文：{paper_title}"
    },
    "deep": {
        "system": "你是一位资深学术审稿人。请从核心贡献、方法论、局限性等角度深度分析。",
        "user": "请深度分析：\n\n{text}\n\n来源论文：{paper_title}"
    },
    "chat": {
        "system": "你是专业的论文阅读助手。请基于论文内容回答问题，如果超出范围请诚实说明。",
        "user": "论文：{paper_title}\n选中内容：{text}\n问题：{user_message}"
    },
}


async def get_llm_for_action(paper_id: str, action_type: str) -> ChatOpenAI:
    """
    获取指定 action 的 LLM 实例
    
    逻辑:
    1. 获取 paper 关联的 user_id
    2. 获取有效配置 (用户 > 系统 > 环境变量)
    3. 如果 smart_analysis_mode = 'custom' 且有独立配置，使用独立配置
    4. 否则使用主 LLM 配置
    """
    paper = store.get(paper_id)
    user_id = paper.get("user_id") if paper else None
    
    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
    
    # 检查是否使用独立配置
    smart_mode = config.get("smart_analysis_mode", "inherit")
    
    if smart_mode == "custom":
        # 尝试获取独立配置
        prefix = f"smart_{action_type}_"
        action_base_url = config.get(f"{prefix}base_url") or ""
        action_model = config.get(f"{prefix}model") or ""
        action_api_key = config.get(f"{prefix}api_key") or ""
        
        # 如果有独立配置，使用它
        if action_base_url or action_model or action_api_key:
            return ChatOpenAI(
                base_url=action_base_url or config.get("llm_base_url") or settings.llm_base_url,
                api_key=action_api_key or config.get("llm_api_key") or settings.llm_api_key or "dummy",
                model=action_model or config.get("llm_model") or settings.llm_model,
                temperature=0.3,
                request_timeout=90,  # 90 seconds timeout for LLM calls
            )
    
    # 继承主 LLM 配置
    base_url = config.get("llm_base_url") or settings.llm_base_url
    api_key = config.get("llm_api_key") or settings.llm_api_key or "dummy"
    model = config.get("llm_model") or settings.llm_model
    
    logger.info(f"[SmartAnalysis] Using LLM config: base_url={base_url}, model={model}, api_key_set={bool(api_key and api_key != 'dummy')}")
    
    return ChatOpenAI(
        base_url=base_url,
        api_key=api_key,
        model=model,
        temperature=0.3,
        request_timeout=90,  # 90 seconds timeout for LLM calls
    )


async def smart_analyze(
    text: str,
    paper_id: str,
    paper_title: str,
    action_type: str,
    context: Optional[str] = None,
    chat_history: Optional[List[Dict[str, str]]] = None,
    user_message: Optional[str] = None,
) -> Dict[str, Any]:
    """
    智能分析选中文本
    """
    if action_type not in ACTION_TO_PROMPT:
        return {"success": False, "error": f"未知的分析类型: {action_type}"}
    
    try:
        # 获取 LLM (支持 per-action 配置)
        llm = await get_llm_for_action(paper_id, action_type)
        
        # 从 PromptLoader 获取 Prompt
        loader = get_prompt_loader()
        prompt_type = ACTION_TO_PROMPT[action_type]
        prompt_file = loader.get_prompt(prompt_type)
        
        if prompt_file:
            system_prompt = prompt_file.system_prompt
            user_prompt_template = prompt_file.user_prompt_template
            prompt_version = prompt_file.version
        else:
            logger.warning(f"Prompt not found for {prompt_type}, using fallback")
            fallback = FALLBACK_PROMPTS[action_type]
            system_prompt = fallback["system"]
            user_prompt_template = fallback["user"]
            prompt_version = "fallback"
        
        # 构建用户 prompt
        format_args = {
            "text": text[:3000],
            "paper_title": paper_title,
            "location": "",
            "context": (context or "")[:5000],
            "user_message": user_message or "请解释这段内容",
        }
        
        try:
            user_prompt = user_prompt_template.format(**format_args)
        except KeyError:
            user_prompt = user_prompt_template
            for key, value in format_args.items():
                user_prompt = user_prompt.replace("{" + key + "}", str(value))
        
        # Chat 模式
        if action_type == "chat":
            if context:
                system_prompt += f"\n\n**论文上下文片段：**\n{context[:5000]}"
            
            messages = [SystemMessage(content=system_prompt)]
            
            if chat_history:
                for msg in chat_history[-10:]:
                    if msg.get("role") == "user":
                        messages.append(HumanMessage(content=msg["content"]))
                    else:
                        messages.append(SystemMessage(content=msg["content"]))
            
            messages.append(HumanMessage(content=user_prompt))
        else:
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
        
        # 调用 LLM (带 token 追踪)
        callback = get_tracking_callback(f"smart_{action_type}")
        response = await llm.ainvoke(messages, config={"callbacks": [callback]})
        
        return {
            "success": True,
            "result": response.content,
            "action_type": action_type,
            "prompt_version": prompt_version,
        }
        
    except Exception as e:
        logger.error(f"Smart analysis failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "action_type": action_type,
        }
