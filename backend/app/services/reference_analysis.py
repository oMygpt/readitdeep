"""
Read it DEEP - 引用论文分析服务

功能:
- 用户点击触发，调用 OpenAlex 获取引用论文
- LLM 生成相关工作总结
- 返回引用列表 + AI 总结
"""

import logging
from typing import Optional
from dataclasses import dataclass

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.core.store import store
from app.services.openalex import get_openalex_service

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ReferenceAnalysisResult:
    """引用分析结果"""
    paper_id: str
    references: list[dict]  # OpenAlex 返回的引用列表
    ai_summary: str         # LLM 生成的总结
    status: str = "completed"
    error: Optional[str] = None


REFERENCE_SUMMARY_PROMPT = """请根据以下引用论文信息，生成一段简要的"相关工作总结"。

## 要求
1. 用中文回答
2. 总结这些引用论文的主要贡献和研究方向
3. 指出它们与主论文的关联性
4. 控制在 200-400 字

## 主论文标题
{main_title}

## 引用论文列表
{references}

## 相关工作总结
"""


def _get_llm():
    """获取 LLM 实例"""
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key or "dummy",
        model=settings.llm_model,
        temperature=0.3,
    )


async def analyze_references(paper_id: str, limit: int = 5) -> ReferenceAnalysisResult:
    """
    分析论文的引用关系并生成 AI 总结
    
    用户点击触发，非自动执行
    
    Args:
        paper_id: 论文 ID
        limit: 获取的引用数量 (默认 5)
    
    Returns:
        ReferenceAnalysisResult
    """
    paper = store.get(paper_id)
    if not paper:
        return ReferenceAnalysisResult(
            paper_id=paper_id,
            references=[],
            ai_summary="",
            status="error",
            error="论文不存在"
        )
    
    # 获取论文标识符 (DOI > arXiv)
    doi = paper.get("doi")
    arxiv_id = paper.get("arxiv_id")
    identifier = doi or arxiv_id
    
    if not identifier:
        return ReferenceAnalysisResult(
            paper_id=paper_id,
            references=[],
            ai_summary="",
            status="error",
            error="论文无 DOI 或 arXiv ID，无法查询引用"
        )
    
    try:
        # 1. 调用 OpenAlex 获取引用
        openalex = get_openalex_service()
        references = await openalex.get_references(identifier, limit=limit)
        
        if not references:
            return ReferenceAnalysisResult(
                paper_id=paper_id,
                references=[],
                ai_summary="未找到引用论文信息",
                status="completed"
            )
        
        # 2. 格式化引用信息供 LLM 使用
        ref_text = ""
        for i, ref in enumerate(references, 1):
            ref_text += f"{i}. {ref.get('title', 'Unknown')} ({ref.get('year', 'N/A')})\n"
            # 注意: OpenAlex 的 abstract 可能为空
        
        # 3. LLM 生成总结
        llm = _get_llm()
        prompt = REFERENCE_SUMMARY_PROMPT.format(
            main_title=paper.get("title", "未知论文"),
            references=ref_text
        )
        
        response = await llm.ainvoke([
            SystemMessage(content="你是一个学术论文分析专家，擅长总结论文的相关工作。"),
            HumanMessage(content=prompt)
        ])
        
        ai_summary = response.content
        
        # 4. 保存结果到 store
        store.set(paper_id, {
            **paper,
            "reference_analysis": {
                "references": references,
                "ai_summary": ai_summary,
                "status": "completed"
            }
        })
        
        logger.info(f"Paper {paper_id}: Reference analysis completed with {len(references)} refs")
        
        return ReferenceAnalysisResult(
            paper_id=paper_id,
            references=references,
            ai_summary=ai_summary,
            status="completed"
        )
        
    except Exception as e:
        logger.error(f"Reference analysis failed for {paper_id}: {e}")
        return ReferenceAnalysisResult(
            paper_id=paper_id,
            references=[],
            ai_summary="",
            status="error",
            error=str(e)
        )


def get_cached_reference_analysis(paper_id: str) -> Optional[dict]:
    """获取缓存的引用分析结果"""
    paper = store.get(paper_id)
    if paper:
        return paper.get("reference_analysis")
    return None
