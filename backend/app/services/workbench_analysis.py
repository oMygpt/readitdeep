"""
Read it DEEP - 工作台分析服务

功能:
- 方法炼金台: 提炼研究方法 + 审稿视角分析
- 资产仓库: 识别 GitHub/Huggingface/数据集等资源
- 智能笔记: 保存原文 + 心得 + 位置信息
"""

import json
import logging
import re
from typing import Optional
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.agents.prompt_loader import get_prompt_loader
from app.core.workbench_store import workbench_store

logger = logging.getLogger(__name__)
settings = get_settings()


# 移除全局 LLM 初始化
# llm = ChatOpenAI(...) 

from app.core.store import store
from app.core.config_manager import ConfigManager
from app.core.database import async_session_maker, get_db

async def get_llm_for_paper(paper_id: str):
    """根据论文归属获取配置好的 LLM 实例"""
    paper = store.get(paper_id)
    user_id = paper.get("user_id") if paper else None
    
    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
        
    return ChatOpenAI(
        base_url=config.get("llm_base_url") or settings.llm_base_url,
        api_key=config.get("llm_api_key") or settings.llm_api_key or "dummy",
        model=config.get("llm_model") or settings.llm_model,
        temperature=0.3,
        request_timeout=90,  # 90 seconds timeout for LLM calls
    )

async def analyze_method(
    text: str,
    paper_id: str,
    paper_title: str,
    location: str = "",
) -> dict:
    """
    方法炼金台分析
    
    提炼研究方法，生成伪代码，以审稿视角分析
    """
    llm = await get_llm_for_paper(paper_id)
    
    loader = get_prompt_loader()
    prompt_file = loader.get_prompt("workbench_method")
    
    if not prompt_file:
        # Fallback prompt
        system_prompt = "你是一位资深学术审稿人和研究方法专家。"
        user_prompt = f"分析以下论文片段，提炼研究方法:\n\n{text}"
    else:
        system_prompt = prompt_file.system_prompt
        user_prompt = prompt_file.user_prompt_template.format(
            text=text,
            paper_title=paper_title,
            location=location,
        )
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        
        content = response.content
        
        # 尝试解析 JSON
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            try:
                analysis = json.loads(json_match.group(1))
            except json.JSONDecodeError:
                analysis = {"error": "JSON parse failed", "raw": content} 
        else:
            # 尝试直接解析
            try:
                analysis = json.loads(content)
            except json.JSONDecodeError:
                # 假如返回的不是JSON，尝试封装
                analysis = {"method_name": "Analysis Result", "core_idea": content[:200], "full_text": content}
        
        # 保存到工作台
        item = workbench_store.add_item(
            type="method",
            title=analysis.get("method_name", "未命名方法"),
            description=analysis.get("core_idea", text[:100]),
            source_paper_id=paper_id,
            zone="methods",
            data={
                "analysis": analysis,
                "original_text": text,
                "location": location,
                "analyzed_at": datetime.utcnow().isoformat(),
            },
        )
        
        return {
            "success": True,
            "item_id": item.id,
            "analysis": analysis,
        }
        
    except Exception as e:
        logger.error(f"Method analysis failed: {e}")
        return {
            "success": False,
            "error": str(e),
        }


async def analyze_asset(
    text: str,
    paper_id: str,
    paper_title: str,
    location: str = "",
) -> dict:
    """
    资产仓库分析
    
    识别 GitHub/Huggingface/数据集等可复用资源
    """
    llm = await get_llm_for_paper(paper_id)
    
    loader = get_prompt_loader()
    prompt_file = loader.get_prompt("workbench_asset")
    
    if not prompt_file:
        system_prompt = "你是一位学术资源整理专家。"
        user_prompt = f"识别以下论文片段中的可复用资源:\n\n{text}"
    else:
        system_prompt = prompt_file.system_prompt
        user_prompt = prompt_file.user_prompt_template.format(
            text=text,
            paper_title=paper_title,
            location=location,
        )
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        
        content = response.content
        
        # 解析 JSON
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            try:
                analysis = json.loads(json_match.group(1))
            except json.JSONDecodeError:
                analysis = {"assets": []}
        else:
            try:
                analysis = json.loads(content)
            except json.JSONDecodeError:
                analysis = {"assets": []}
        
        # 为每个识别到的资产创建条目
        created_items = []
        assets = analysis.get("assets", [])
        
        for asset in assets:
            item = workbench_store.add_item(
                type="dataset" if asset.get("type") == "dataset" else "code",
                title=asset.get("name", "未命名资源"),
                description=asset.get("description", ""),
                source_paper_id=paper_id,
                zone="datasets",
                data={
                    "asset": asset,
                    "original_text": text,
                    "location": location,
                    "analyzed_at": datetime.utcnow().isoformat(),
                },
            )
            created_items.append(item.id)
        
        return {
            "success": True,
            "item_ids": created_items,
            "analysis": analysis,
            "assets_count": len(assets),
        }
        
    except Exception as e:
        logger.error(f"Asset analysis failed: {e}")
        return {
            "success": False,
            "error": str(e),
        }


def create_smart_note(
    text: str,
    paper_id: str,
    paper_title: str,
    location: str = "",
    is_title_note: bool = False,
    reflection: str = "",
) -> dict:
    """
    创建智能笔记
    
    保留原文，记录位置，支持用户心得
    """
    item = workbench_store.add_item(
        type="note",
        title=f"📝 {paper_title[:30]}..." if is_title_note else f"📌 {text[:30]}...",
        description=reflection if reflection else "点击添加心得...",
        source_paper_id=paper_id,
        zone="notes",
        data={
            "original_text": text,
            "location": location,
            "is_title_note": is_title_note,
            "reflection": reflection,
            "reflection_updated_at": None,
            "created_at": datetime.utcnow().isoformat(),
        },
    )
    
    return {
        "success": True,
        "item_id": item.id,
        "item": {
            "id": item.id,
            "title": item.title,
            "description": item.description,
            "data": item.data,
        },
    }


def update_note_reflection(item_id: str, reflection: str) -> dict:
    """
    更新笔记心得
    """
    success = workbench_store.update_item(item_id, {
        "description": reflection[:100] + "..." if len(reflection) > 100 else reflection,
        "data": {
            **workbench_store.get_item(item_id).get("data", {}),
            "reflection": reflection,
            "reflection_updated_at": datetime.utcnow().isoformat(),
        },
    })
    
    if success:
        return {
            "success": True,
            "item_id": item_id,
        }
    else:
        return {
            "success": False,
            "error": "Item not found",
        }
