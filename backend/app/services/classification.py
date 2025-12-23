"""
Read it DEEP - 智能论文分类服务

功能:
- LLM 自动分析论文内容并建议标签
- 预定义 Category 列表，由 LLM 从中选择
- 自由 Tags，由 LLM 动态生成
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
from app.core.database import async_session_maker
from app.core.config_manager import ConfigManager

logger = logging.getLogger(__name__)
settings = get_settings()


# 预定义 Category 列表 (v1.1.0)
PREDEFINED_CATEGORIES = [
    "Machine Learning",
    "Natural Language Processing",
    "Computer Vision",
    "Reinforcement Learning",
    "Speech & Audio",
    "Robotics",
    "Data Mining",
    "AI for Science",
    "AI Safety & Ethics",
    "Systems & Infrastructure",
    "Multimodal",
    "Generative AI",
    "Other",
]


async def get_llm_for_classification(paper_id: str):
    """根据论文归属获取配置好的 LLM 实例用于分类"""
    paper = store.get(paper_id)
    user_id = paper.get("user_id") if paper else None
    
    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
        
    return ChatOpenAI(
        base_url=config.get("llm_base_url") or settings.llm_base_url,
        api_key=config.get("llm_api_key") or settings.llm_api_key or "dummy",
        model=config.get("llm_model") or settings.llm_model,
        temperature=0.3,
        request_timeout=90,
    )


@dataclass
class TagSuggestion:
    """标签建议"""
    name: str           # 标签名称
    confidence: float   # 置信度 (0-1)
    reason: str         # 建议原因


@dataclass
class ClassificationResult:
    """分类结果 (v1.1.0)"""
    category: str              # 主分类（来自预定义列表）
    tags: list[TagSuggestion]  # 标签建议列表


# v1.1.0 Prompt: 同时输出 category + tags
CLASSIFICATION_PROMPT = """请分析以下学术论文内容，完成分类和标签推荐。

## 分类规则 (Category)
从以下预定义列表中选择 **1个** 最匹配的主分类：
- Machine Learning: 机器学习基础理论、优化算法、模型架构
- Natural Language Processing: 文本处理、语言模型、对话系统、翻译
- Computer Vision: 图像识别、目标检测、视频分析、3D视觉
- Reinforcement Learning: 强化学习、决策优化、多智能体
- Speech & Audio: 语音识别、语音合成、音频处理
- Robotics: 机器人控制、运动规划、人机交互
- Data Mining: 数据分析、推荐系统、知识图谱
- AI for Science: 科学计算、生物AI、化学AI、物理模拟
- AI Safety & Ethics: 安全对齐、可解释性、公平性、隐私
- Systems & Infrastructure: 分布式训练、模型压缩、推理优化
- Multimodal: 多模态融合、视觉语言、跨模态检索
- Generative AI: 生成模型、扩散模型、创意AI
- Other: 不属于以上类别

## 标签规则 (Tags)
1. 推荐 2-5 个细粒度标签
2. 标签可自由生成，不受预定义限制
3. 标签应简洁（2-4个中文字或英文词组）
4. 每个标签需说明推荐理由

## 论文内容
{content}

## 输出格式
请以 JSON 格式返回：
```json
{{
  "category": "从上方列表选择一个（英文）",
  "tags": [
    {{"name": "标签名", "confidence": 0.95, "reason": "推荐理由"}}
  ]
}}
```
"""


def find_similar_category(new_category: str, existing_categories: list[str], threshold: float = 0.8) -> str | None:
    """
    检查是否有相似的已有分类
    
    Args:
        new_category: 新分类名称
        existing_categories: 已有分类列表
        threshold: 相似度阈值 (0-1)
    
    Returns:
        相似的已有分类名称，或 None
    """
    try:
        from rapidfuzz import fuzz
        for existing in existing_categories:
            # 使用 token_sort_ratio 处理中英文混合的情况
            similarity = fuzz.token_sort_ratio(new_category.lower(), existing.lower()) / 100
            if similarity >= threshold:
                logger.info(f"Category merge: '{new_category}' -> '{existing}' (similarity: {similarity:.2f})")
                return existing
    except ImportError:
        # 如果没有 rapidfuzz，退回到简单比较
        for existing in existing_categories:
            if new_category.lower() == existing.lower():
                return existing
    return None


def get_all_categories() -> list[str]:
    """获取所有已使用的分类"""
    categories = set()
    for paper_id in store.keys():
        paper = store.get(paper_id)
        if paper and paper.get("category"):
            categories.add(paper["category"])
    return list(categories)


async def suggest_tags(paper_id: str) -> list[TagSuggestion]:
    """
    为论文生成 Category + Tags (v1.1.0)
    
    规则:
    - Category: 从 PREDEFINED_CATEGORIES 中选择
    - Tags: 只保留置信度 >= 0.85 的标签，最多 3 个
    - 自动确认为正式标签
    
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
        llm = await get_llm_for_classification(paper_id)
        response = await llm.ainvoke([
            SystemMessage(content="你是一个学术论文分类专家。请根据论文内容选择最匹配的分类，并推荐相关标签。"),
            HumanMessage(content=prompt)
        ])
        
        # 解析 JSON 响应
        result = _parse_json_response(response.content)
        
        # ========== v1.1.0: 解析 Category ==========
        category = result.get("category", "Other")
        # 验证 category 是否在预定义列表中
        if category not in PREDEFINED_CATEGORIES:
            logger.warning(f"Paper {paper_id}: Unknown category '{category}', fallback to 'Other'")
            # 尝试模糊匹配
            category_lower = category.lower()
            matched = False
            for predefined in PREDEFINED_CATEGORIES:
                if predefined.lower() in category_lower or category_lower in predefined.lower():
                    category = predefined
                    matched = True
                    break
            if not matched:
                category = "Other"
        
        # ========== 解析 Tags ==========
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
        
        # 过滤置信度 >= 0.85 的标签，最多 3 个
        MIN_CONFIDENCE = 0.85
        MAX_TAGS = 3
        high_confidence_tags = [s for s in suggestions if s.confidence >= MIN_CONFIDENCE][:MAX_TAGS]
        confirmed_tag_names = [s.name for s in high_confidence_tags]
        
        # ========== 更新论文: category + tags ==========
        store.set(paper_id, {
            **paper,
            "category": category,  # v1.1.0: 直接使用 LLM 返回的 category
            "tags": confirmed_tag_names,
            "suggested_tags": [s.name for s in suggestions],
            "tag_suggestions": [
                {"name": s.name, "confidence": s.confidence, "reason": s.reason}
                for s in suggestions
            ],
            "tags_confirmed": True,
        })
        
        logger.info(f"Paper {paper_id}: Category='{category}', Tags={confirmed_tag_names}")
        return high_confidence_tags
        
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
