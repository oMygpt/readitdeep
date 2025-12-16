"""
Read it DEEP - Analysis Service

封装 LangGraph 论文分析工作流的服务层
分析结果持久化保存在论文记录中
"""

from datetime import datetime
from typing import Optional
import logging

from app.agents.graph import run_paper_analysis
from app.core.store import store

logger = logging.getLogger(__name__)


# 内存缓存 (用于跟踪进行中的分析)
analysis_cache: dict[str, dict] = {}


def _get_paper_analysis(paper_id: str) -> Optional[dict]:
    """从论文记录中获取分析结果"""
    paper = store.get(paper_id)
    if not paper:
        return None
    return paper.get("analysis")


def _save_paper_analysis(paper_id: str, analysis: dict) -> None:
    """保存分析结果到论文记录中"""
    paper = store.get(paper_id)
    if paper:
        store.update(paper_id, {"analysis": analysis})


async def start_paper_analysis(paper_id: str) -> dict:
    """
    启动论文分析任务
    
    Args:
        paper_id: 论文 ID
    
    Returns:
        任务状态信息
    """
    # 获取论文信息
    paper = store.get(paper_id)
    if not paper:
        raise ValueError(f"Paper {paper_id} not found")
    
    if paper.get("status") != "completed":
        raise ValueError(f"Paper {paper_id} is not ready (status: {paper.get('status')})")
    
    content = paper.get("markdown_content", "")
    if not content:
        raise ValueError(f"Paper {paper_id} has no content")
    
    # 检查是否已有完成的分析 (持久化数据)
    existing = paper.get("analysis")
    if existing and existing.get("status") == "completed":
        return {
            "paper_id": paper_id,
            "status": "completed",
            "message": "Analysis already completed, loading cached results"
        }
    
    # 检查是否正在分析中 (内存缓存)
    if paper_id in analysis_cache and analysis_cache[paper_id].get("status") == "analyzing":
        return {
            "paper_id": paper_id,
            "status": "analyzing",
            "message": "Analysis already in progress"
        }
    
    # 初始化分析记录
    analysis_record = {
        "paper_id": paper_id,
        "status": "analyzing",
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "summary": None,
        "methods": [],
        "datasets": [],
        "code_refs": [],
        "structure": None,
        "error_message": None,
    }
    
    # 保存到内存缓存
    analysis_cache[paper_id] = analysis_record
    
    # 保存到持久化存储
    _save_paper_analysis(paper_id, analysis_record)
    
    return {
        "paper_id": paper_id,
        "status": "started",
        "message": "Analysis started"
    }


async def run_analysis_task(paper_id: str) -> None:
    """
    后台执行分析任务
    
    Args:
        paper_id: 论文 ID
    """
    try:
        paper = store.get(paper_id)
        if not paper:
            logger.error(f"Paper {paper_id} not found for analysis")
            return
        
        content = paper.get("markdown_content", "")
        title = paper.get("title", "")
        
        logger.info(f"Starting LangGraph analysis for paper {paper_id}")
        
        # 运行 LangGraph 工作流
        result = await run_paper_analysis(
            paper_id=paper_id,
            paper_content=content,
            paper_title=title
        )
        
        # 构建分析结果
        analysis_result = {
            "paper_id": paper_id,
            "status": "completed",
            "started_at": analysis_cache.get(paper_id, {}).get("started_at"),
            "completed_at": datetime.utcnow().isoformat(),
            "summary": result.get("summary"),
            "methods": result.get("methods", []),
            "datasets": result.get("datasets", []),
            "code_refs": result.get("code_refs", []),
            "structure": result.get("structure"),
            "error_message": None,
        }
        
        # 更新内存缓存
        analysis_cache[paper_id] = analysis_result
        
        # 持久化保存到论文记录
        _save_paper_analysis(paper_id, analysis_result)
        
        logger.info(f"Analysis completed and persisted for paper {paper_id}")
        
    except Exception as e:
        logger.error(f"Analysis failed for paper {paper_id}: {str(e)}")
        
        error_result = {
            "paper_id": paper_id,
            "status": "failed",
            "started_at": analysis_cache.get(paper_id, {}).get("started_at"),
            "completed_at": datetime.utcnow().isoformat(),
            "error_message": str(e),
        }
        
        analysis_cache[paper_id] = error_result
        _save_paper_analysis(paper_id, error_result)


def get_analysis_result(paper_id: str) -> Optional[dict]:
    """
    获取分析结果
    
    优先从内存缓存获取（用于进行中的分析），
    否则从持久化存储加载（用于已完成的分析）
    
    Args:
        paper_id: 论文 ID
    
    Returns:
        分析结果字典，不存在返回 None
    """
    # 先检查内存缓存（进行中的分析）
    if paper_id in analysis_cache:
        return analysis_cache[paper_id]
    
    # 从持久化存储加载
    return _get_paper_analysis(paper_id)


def get_all_analyses() -> list[dict]:
    """
    获取所有分析结果
    
    Returns:
        分析结果列表
    """
    # 从所有论文中收集分析结果
    results = []
    for paper in store.get_all():
        analysis = paper.get("analysis")
        if analysis:
            results.append(analysis)
    return results
