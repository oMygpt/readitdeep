"""
Read it DEEP - 智能论文分类服务

功能:
- LLM 自动分析论文内容并建议标签
- 不预定义分类，根据内容动态建议
- 支持多标签
- 用户可确认/修改/添加标签
"""

from typing import Optional
from dataclasses import dataclass
import logging
import json
import re

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.core.store import store

logger = logging.getLogger(__name__)
settings = get_settings()

# LLM 实例
llm = ChatOpenAI(
    base_url=settings.llm_base_url,
    api_key=settings.llm_api_key or "dummy",
    model=settings.llm_model,
    temperature=0.3,
)


@dataclass
class TagSuggestion:
    """标签建议"""
    name: str           # 标签名称
    confidence: float   # 置信度 (0-1)
    reason: str         # 建议原因


CLASSIFICATION_PROMPT = """请分析以下学术论文内容，为其推荐合适的分类标签。

## 要求
1. 根据论文的研究领域、方法、应用场景推荐 2-5 个标签
2. 标签应该简洁（2-4个中文字或英文词组）
3. 优先使用学术领域通用术语
4. 每个标签需说明推荐理由

## 标签类型参考
- 研究领域：如 "深度学习", "NLP", "计算机视觉", "强化学习"
- 任务类型：如 "文本分类", "目标检测", "机器翻译", "对话系统"
- 技术方法：如 "Transformer", "GNN", "Diffusion", "RLHF"
- 应用场景：如 "医疗AI", "金融风控", "自动驾驶"

## 论文内容
{content}

## 输出格式
请以 JSON 格式返回：
```json
{{
  "tags": [
    {{"name": "标签名", "confidence": 0.95, "reason": "推荐理由"}}
  ]
}}
```
"""


async def suggest_tags(paper_id: str) -> list[TagSuggestion]:
    """
    为论文生成标签建议
    
    Args:
        paper_id: 论文 ID
    
    Returns:
        标签建议列表
    """
    paper = store.get(paper_id)
    if not paper:
        raise ValueError(f"Paper {paper_id} not found")
    
    content = paper.get("markdown_content", "")[:6000]  # 截取前6000字符
    
    if not content:
        logger.warning(f"Paper {paper_id} has no content for classification")
        return []
    
    prompt = CLASSIFICATION_PROMPT.format(content=content)
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content="你是一个学术论文分类专家，擅长识别论文的研究领域和技术方向。"),
            HumanMessage(content=prompt)
        ])
        
        # 解析 JSON 响应
        result = _parse_json_response(response.content)
        tags_raw = result.get("tags", [])
        
        suggestions = []
        for tag in tags_raw:
            suggestions.append(TagSuggestion(
                name=tag.get("name", ""),
                confidence=float(tag.get("confidence", 0.5)),
                reason=tag.get("reason", ""),
            ))
        
        # 按置信度排序
        suggestions.sort(key=lambda x: x.confidence, reverse=True)
        
        # 更新论文的建议标签
        store.set(paper_id, {
            **paper,
            "suggested_tags": [s.name for s in suggestions],
            "tag_suggestions": [
                {"name": s.name, "confidence": s.confidence, "reason": s.reason}
                for s in suggestions
            ],
        })
        
        logger.info(f"Paper {paper_id}: Suggested {len(suggestions)} tags")
        return suggestions
        
    except Exception as e:
        logger.error(f"Classification failed for {paper_id}: {e}")
        return []


def confirm_tags(paper_id: str, tags: list[str]) -> bool:
    """
    用户确认/修改论文标签
    
    Args:
        paper_id: 论文 ID
        tags: 确认的标签列表
    
    Returns:
        是否成功
    """
    paper = store.get(paper_id)
    if not paper:
        return False
    
    store.set(paper_id, {
        **paper,
        "tags": tags,
        "tags_confirmed": True,
    })
    
    logger.info(f"Paper {paper_id}: Confirmed tags {tags}")
    return True


def add_tag(paper_id: str, tag: str) -> bool:
    """
    为论文添加自定义标签
    """
    paper = store.get(paper_id)
    if not paper:
        return False
    
    current_tags = paper.get("tags", [])
    if tag not in current_tags:
        current_tags.append(tag)
    
    store.set(paper_id, {
        **paper,
        "tags": current_tags,
    })
    
    return True


def remove_tag(paper_id: str, tag: str) -> bool:
    """
    移除论文标签
    """
    paper = store.get(paper_id)
    if not paper:
        return False
    
    current_tags = paper.get("tags", [])
    if tag in current_tags:
        current_tags.remove(tag)
    
    store.set(paper_id, {
        **paper,
        "tags": current_tags,
    })
    
    return True


def get_all_tags() -> list[dict]:
    """
    获取所有已使用的标签及其论文数量
    """
    tag_counts: dict[str, int] = {}
    
    for paper_id in store.keys():
        paper = store.get(paper_id)
        if paper:
            for tag in paper.get("tags", []):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    
    # 按使用次数排序
    return [
        {"name": name, "count": count}
        for name, count in sorted(tag_counts.items(), key=lambda x: -x[1])
    ]


def _parse_json_response(response: str) -> dict:
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
