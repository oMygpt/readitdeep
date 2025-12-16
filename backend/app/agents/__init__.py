"""
Read it DEEP - LangGraph 论文分析多智能体系统

基于 LangGraph 的并行分析架构：
- 5 个 Agent 并行执行
- 使用 Annotated + operator.add 支持并发写入
- Aggregator 汇聚结果
"""

from typing import TypedDict, Annotated, List, Optional, Any
from langgraph.graph import StateGraph, START, END
import operator


class TextLocation(TypedDict):
    """文本定位信息，用于前端跳转"""
    start_line: int
    end_line: int
    text_snippet: str


class MethodItem(TypedDict):
    """研究方法条目"""
    name: str
    description: str
    location: Optional[TextLocation]


class DatasetItem(TypedDict):
    """数据集条目"""
    name: str
    url: Optional[str]
    description: str
    location: Optional[TextLocation]


class CodeRefItem(TypedDict):
    """代码引用条目"""
    repo_url: Optional[str]
    description: str
    location: Optional[TextLocation]


class StructureSection(TypedDict):
    """文档结构章节"""
    title: str
    level: int
    start_line: int


class StructureInfo(TypedDict):
    """文档结构信息"""
    sections: List[StructureSection]


class AnalysisResult(TypedDict):
    """单个 Agent 的分析结果"""
    type: str  # "summary" | "methods" | "datasets" | "code" | "structure"
    data: Any


class PaperAnalysisState(TypedDict):
    """
    LangGraph 状态：论文分析的共享内存
    
    使用 Annotated + operator.add 支持多个 Agent 并发写入 analysis_results
    """
    # Input
    paper_id: str
    paper_content: str  # Markdown 全文
    paper_title: str
    
    # Parallel Agent Outputs (并发写入)
    analysis_results: Annotated[List[AnalysisResult], operator.add]
    
    # Aggregated Output
    summary: Optional[str]
    methods: Optional[List[MethodItem]]
    datasets: Optional[List[DatasetItem]]
    code_refs: Optional[List[CodeRefItem]]
    structure: Optional[StructureInfo]
    
    # Status
    status: str  # "pending" | "analyzing" | "completed" | "failed"
    errors: List[str]
