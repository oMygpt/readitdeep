"""
Read it DEEP - 论文分析 Agent 节点实现

包含 5 个并行 Agent：
1. Summary Agent - 论文概要
2. Method Agent - 研究方法提取
3. Dataset Agent - 数据集识别
4. Code Agent - 代码仓库提取
5. Structure Agent - 文档结构分析

使用 prompts.py 进行 Prompt 版本管理
"""

import json
import re
from typing import Any

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.agents import (
    PaperAnalysisState,
    AnalysisResult,
    TextLocation,
    MethodItem,
    DatasetItem,
    CodeRefItem,
    StructureSection,
    StructureInfo,
)
from app.agents.prompts import (
    get_summary_prompt,
    get_method_prompt,
    get_dataset_prompt,
    get_code_prompt,
)
from app.core.token_tracker import get_tracking_callback

settings = get_settings()

# 初始化 LLM
llm = ChatOpenAI(
    base_url=settings.llm_base_url,
    api_key=settings.llm_api_key or "dummy",
    model=settings.llm_model,
    temperature=0.3,
)


def find_text_location(content: str, snippet: str) -> TextLocation | None:
    """在内容中查找文本片段的行号位置"""
    if not snippet or not content:
        return None
    
    # 清理 snippet
    snippet_clean = snippet.strip()[:100]  # 取前100字符
    
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if snippet_clean[:30] in line:  # 模糊匹配前30字符
            return {
                "start_line": i + 1,
                "end_line": min(i + 3, len(lines)),
                "text_snippet": snippet_clean
            }
    
    return None


def parse_json_response(response: str) -> Any:
    """从 LLM 响应中解析 JSON"""
    # 尝试提取 JSON 块
    json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # 尝试直接解析
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass
    
    # 尝试提取花括号内容
    brace_match = re.search(r'\{[\s\S]*\}', response)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass
    
    return {}


async def summary_agent_node(state: PaperAnalysisState) -> dict:
    """
    Summary Agent: 生成论文概要
    使用版本化 Prompt
    """
    content = state.get("paper_content", "")[:6000]  # 截取前6000字符
    
    # 获取当前活跃版本的 Prompt
    prompt_ver = get_summary_prompt()
    prompt = prompt_ver.user_prompt_template.format(content=content)

    try:
        callback = get_tracking_callback("agent_summary")
        response = await llm.ainvoke([
            SystemMessage(content=prompt_ver.system_prompt),
            HumanMessage(content=prompt)
        ], config={"callbacks": [callback]})
        
        summary = response.content.strip()
        
        return {
            "analysis_results": [{
                "type": "summary",
                "data": summary,
                "prompt_version": prompt_ver.version,
            }]
        }
    except Exception as e:
        return {
            "analysis_results": [{
                "type": "summary",
                "data": f"摘要生成失败: {str(e)}"
            }]
        }


async def method_agent_node(state: PaperAnalysisState) -> dict:
    """
    Method Agent: 提取研究方法
    使用版本化 Prompt
    """
    content = state.get("paper_content", "")[:8000]
    
    # 获取当前活跃版本的 Prompt
    prompt_ver = get_method_prompt()
    prompt = prompt_ver.user_prompt_template.format(content=content)

    try:
        callback = get_tracking_callback("agent_method")
        response = await llm.ainvoke([
            SystemMessage(content=prompt_ver.system_prompt),
            HumanMessage(content=prompt)
        ], config={"callbacks": [callback]})
        
        result = parse_json_response(response.content)
        methods_raw = result.get("methods", [])
        
        methods: list[MethodItem] = []
        for m in methods_raw:
            location = find_text_location(content, m.get("location", ""))
            methods.append({
                "name": m.get("name", ""),
                "category": m.get("category", ""),
                "description": m.get("description", ""),
                "location": location
            })
        
        return {
            "analysis_results": [{
                "type": "methods",
                "data": methods,
                "prompt_version": prompt_ver.version,
            }]
        }
    except Exception as e:
        return {
            "analysis_results": [{
                "type": "methods",
                "data": []
            }],
            "errors": [f"Method extraction failed: {str(e)}"]
        }


async def dataset_agent_node(state: PaperAnalysisState) -> dict:
    """
    Dataset Agent: 识别数据集
    使用版本化 Prompt
    """
    content = state.get("paper_content", "")[:8000]
    
    # 获取当前活跃版本的 Prompt
    prompt_ver = get_dataset_prompt()
    prompt = prompt_ver.user_prompt_template.format(content=content)

    try:
        callback = get_tracking_callback("agent_dataset")
        response = await llm.ainvoke([
            SystemMessage(content=prompt_ver.system_prompt),
            HumanMessage(content=prompt)
        ], config={"callbacks": [callback]})
        
        result = parse_json_response(response.content)
        datasets_raw = result.get("datasets", [])
        
        datasets: list[DatasetItem] = []
        for d in datasets_raw:
            # 支持两种字段名：text_snippet (新) 或 location (旧)
            snippet = d.get("text_snippet") or d.get("location", "")
            location = find_text_location(content, snippet)
            datasets.append({
                "name": d.get("name", ""),
                "url": d.get("url"),
                "description": d.get("description", ""),
                "usage": d.get("usage", ""),  # 新增 usage 字段
                "location": location
            })
        
        return {
            "analysis_results": [{
                "type": "datasets",
                "data": datasets,
                "prompt_version": prompt_ver.version,
            }]
        }
    except Exception as e:
        return {
            "analysis_results": [{
                "type": "datasets",
                "data": []
            }]
        }


async def code_agent_node(state: PaperAnalysisState) -> dict:
    """
    Code Agent: 提取代码仓库引用
    使用版本化 Prompt
    """
    content = state.get("paper_content", "")[:8000]
    
    # 获取当前活跃版本的 Prompt
    prompt_ver = get_code_prompt()
    prompt = prompt_ver.user_prompt_template.format(content=content)

    try:
        callback = get_tracking_callback("agent_code")
        response = await llm.ainvoke([
            SystemMessage(content=prompt_ver.system_prompt),
            HumanMessage(content=prompt)
        ], config={"callbacks": [callback]})
        
        result = parse_json_response(response.content)
        code_refs_raw = result.get("code_refs", [])
        
        code_refs: list[CodeRefItem] = []
        for c in code_refs_raw:
            location = find_text_location(content, c.get("location", ""))
            code_refs.append({
                "repo_url": c.get("repo_url"),
                "description": c.get("description", ""),
                "location": location
            })
        
        return {
            "analysis_results": [{
                "type": "code",
                "data": code_refs,
                "prompt_version": prompt_ver.version,
            }]
        }
    except Exception as e:
        return {
            "analysis_results": [{
                "type": "code",
                "data": []
            }]
        }


async def structure_agent_node(state: PaperAnalysisState) -> dict:
    """
    Structure Agent: 分析文档结构
    
    不需要 LLM，直接解析 Markdown 标题结构
    """
    content = state.get("paper_content", "")
    
    sections: list[StructureSection] = []
    lines = content.split('\n')
    
    for i, line in enumerate(lines):
        # 匹配 Markdown 标题 (# ## ### 等)
        match = re.match(r'^(#{1,6})\s+(.+)$', line.strip())
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            sections.append({
                "title": title,
                "level": level,
                "start_line": i + 1
            })
    
    structure: StructureInfo = {"sections": sections}
    
    return {
        "analysis_results": [{
            "type": "structure",
            "data": structure
        }]
    }


def aggregator_node(state: PaperAnalysisState) -> dict:
    """
    Aggregator: 汇聚所有分析结果
    """
    results = state.get("analysis_results", [])
    
    summary = None
    methods = []
    datasets = []
    code_refs = []
    structure = None
    
    for result in results:
        result_type = result.get("type")
        data = result.get("data")
        
        if result_type == "summary":
            summary = data
        elif result_type == "methods":
            methods = data
        elif result_type == "datasets":
            datasets = data
        elif result_type == "code":
            code_refs = data
        elif result_type == "structure":
            structure = data
    
    return {
        "summary": summary,
        "methods": methods,
        "datasets": datasets,
        "code_refs": code_refs,
        "structure": structure,
        "status": "completed"
    }
