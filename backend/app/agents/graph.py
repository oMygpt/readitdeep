"""
Read it DEEP - LangGraph 论文分析工作流

构建并行执行图：
START -> [5 Parallel Agents] -> Aggregator -> END
"""

from langgraph.graph import StateGraph, START, END

from app.agents import PaperAnalysisState
from app.agents.nodes import (
    summary_agent_node,
    method_agent_node,
    dataset_agent_node,
    code_agent_node,
    structure_agent_node,
    aggregator_node,
)


def build_paper_analysis_graph():
    """
    构建论文分析的并行执行图
    
    图结构:
    START
      ├─> summary_agent ─┐
      ├─> method_agent ──┤
      ├─> dataset_agent ─┼─> aggregator -> END
      ├─> code_agent ────┤
      └─> structure_agent┘
    """
    
    builder = StateGraph(PaperAnalysisState)
    
    # 添加节点
    builder.add_node("summary_agent", summary_agent_node)
    builder.add_node("method_agent", method_agent_node)
    builder.add_node("dataset_agent", dataset_agent_node)
    builder.add_node("code_agent", code_agent_node)
    builder.add_node("structure_agent", structure_agent_node)
    builder.add_node("aggregator", aggregator_node)
    
    # 并行边：从 START 同时触发所有 Agent
    builder.add_edge(START, "summary_agent")
    builder.add_edge(START, "method_agent")
    builder.add_edge(START, "dataset_agent")
    builder.add_edge(START, "code_agent")
    builder.add_edge(START, "structure_agent")
    
    # 所有 Agent 完成后汇聚到 Aggregator
    builder.add_edge("summary_agent", "aggregator")
    builder.add_edge("method_agent", "aggregator")
    builder.add_edge("dataset_agent", "aggregator")
    builder.add_edge("code_agent", "aggregator")
    builder.add_edge("structure_agent", "aggregator")
    
    # Aggregator 完成后结束
    builder.add_edge("aggregator", END)
    
    return builder.compile()


# 编译后的图实例（单例）
paper_analysis_graph = build_paper_analysis_graph()


async def run_paper_analysis(
    paper_id: str,
    paper_content: str,
    paper_title: str = ""
) -> dict:
    """
    运行论文分析工作流
    
    Args:
        paper_id: 论文 ID
        paper_content: 论文 Markdown 内容
        paper_title: 论文标题
    
    Returns:
        分析结果字典，包含 summary, methods, datasets, code_refs, structure
    """
    
    initial_state: PaperAnalysisState = {
        "paper_id": paper_id,
        "paper_content": paper_content,
        "paper_title": paper_title,
        "analysis_results": [],
        "summary": None,
        "methods": None,
        "datasets": None,
        "code_refs": None,
        "structure": None,
        "status": "analyzing",
        "errors": []
    }
    
    # 执行图
    result = await paper_analysis_graph.ainvoke(initial_state)
    
    return {
        "paper_id": paper_id,
        "summary": result.get("summary"),
        "methods": result.get("methods", []),
        "datasets": result.get("datasets", []),
        "code_refs": result.get("code_refs", []),
        "structure": result.get("structure"),
        "status": result.get("status", "completed")
    }
