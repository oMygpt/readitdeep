"""
Read it DEEP - Analysis API

论文 AI 分析接口
- POST /api/papers/{paper_id}/analyze: 触发分析
- GET /api/papers/{paper_id}/analysis: 获取分析结果
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List

from app.services.analysis import (
    start_paper_analysis,
    run_analysis_task,
    get_analysis_result,
)


router = APIRouter()


class TextLocation(BaseModel):
    """文本定位"""
    start_line: int
    end_line: int
    text_snippet: str


class MethodItem(BaseModel):
    """研究方法"""
    name: str
    description: str
    location: Optional[TextLocation] = None


class DatasetItem(BaseModel):
    """数据集"""
    name: str
    url: Optional[str] = None
    description: str
    usage: Optional[str] = None  # 在论文中的使用方式
    location: Optional[TextLocation] = None


class CodeRefItem(BaseModel):
    """代码引用"""
    repo_url: Optional[str] = None
    description: str
    location: Optional[TextLocation] = None


class StructureSection(BaseModel):
    """文档结构章节"""
    title: str
    level: int
    start_line: int


class StructureInfo(BaseModel):
    """文档结构"""
    sections: List[StructureSection]


class AnalysisStartResponse(BaseModel):
    """分析启动响应"""
    paper_id: str
    status: str
    message: str


class AnalysisResultResponse(BaseModel):
    """分析结果响应"""
    paper_id: str
    status: str
    summary: Optional[str] = None
    methods: List[MethodItem] = []
    datasets: List[DatasetItem] = []
    code_refs: List[CodeRefItem] = []
    structure: Optional[StructureInfo] = None
    error_message: Optional[str] = None


@router.post("/{paper_id}/analyze", response_model=AnalysisStartResponse)
async def trigger_analysis(
    paper_id: str,
    background_tasks: BackgroundTasks,
) -> AnalysisStartResponse:
    """
    触发论文分析
    
    使用 LangGraph 多智能体系统并行分析：
    - Summary Agent: 论文概要
    - Method Agent: 研究方法提取
    - Dataset Agent: 数据集识别
    - Code Agent: 代码仓库提取
    - Structure Agent: 文档结构分析
    """
    try:
        result = await start_paper_analysis(paper_id)
        
        # 添加后台任务
        if result.get("status") == "started":
            background_tasks.add_task(run_analysis_task, paper_id)
        
        return AnalysisStartResponse(
            paper_id=paper_id,
            status=result.get("status", "started"),
            message=result.get("message", "Analysis started")
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start analysis: {str(e)}")


@router.get("/{paper_id}/analysis", response_model=AnalysisResultResponse)
async def get_analysis(paper_id: str) -> AnalysisResultResponse:
    """
    获取论文分析结果
    
    返回 LangGraph 多智能体分析的结果：
    - summary: 论文概要
    - methods: 研究方法列表 (含定位信息)
    - datasets: 数据集列表 (含定位信息)
    - code_refs: 代码引用列表 (含定位信息)
    - structure: 文档结构
    """
    result = get_analysis_result(paper_id)
    
    if not result:
        raise HTTPException(
            status_code=404, 
            detail="Analysis not found. Please trigger analysis first."
        )
    
    # 转换 structure
    structure = None
    if result.get("structure"):
        structure = StructureInfo(
            sections=[
                StructureSection(**s) for s in result["structure"].get("sections", [])
            ]
        )
    
    return AnalysisResultResponse(
        paper_id=paper_id,
        status=result.get("status", "pending"),
        summary=result.get("summary"),
        methods=[MethodItem(**m) for m in result.get("methods", []) if m],
        datasets=[DatasetItem(**d) for d in result.get("datasets", []) if d],
        code_refs=[CodeRefItem(**c) for c in result.get("code_refs", []) if c],
        structure=structure,
        error_message=result.get("error_message"),
    )
