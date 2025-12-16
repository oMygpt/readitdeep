"""
Read it DEEP - 工作台 API

端点:
- GET  /workbench              # 全局工作台
- POST /workbench/items        # 添加项目
- GET  /workbench/items/{id}   # 获取项目
- PUT  /workbench/items/{id}   # 更新项目
- DELETE /workbench/items/{id} # 删除项目
- GET  /workbench/stats        # 统计信息
- GET  /papers/{id}/workbench  # 论文工作台
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

from app.core.workbench_store import workbench_store

logger = logging.getLogger(__name__)
router = APIRouter()


# Request/Response Models
class AddItemRequest(BaseModel):
    type: str  # method, dataset, code, note
    title: str
    description: str
    source_paper_id: Optional[str] = None
    zone: str = "notes"  # methods, datasets, notes
    data: Optional[Dict[str, Any]] = None


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    zone: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class WorkbenchItemResponse(BaseModel):
    id: str
    type: str
    title: str
    description: str
    source_paper_id: Optional[str] = None
    zone: str
    created_at: str
    data: Dict[str, Any]


class WorkbenchResponse(BaseModel):
    methods: List[WorkbenchItemResponse]
    datasets: List[WorkbenchItemResponse]
    notes: List[WorkbenchItemResponse]


class WorkbenchStatsResponse(BaseModel):
    total_items: int
    methods_count: int
    datasets_count: int
    notes_count: int
    papers_count: int


# Global Workbench Endpoints
@router.get("", response_model=WorkbenchResponse)
async def get_global_workbench():
    """
    获取全局工作台
    
    返回所有论文的工作台项目汇总
    """
    data = workbench_store.get_global_workbench()
    return WorkbenchResponse(
        methods=[WorkbenchItemResponse(**item) for item in data["methods"]],
        datasets=[WorkbenchItemResponse(**item) for item in data["datasets"]],
        notes=[WorkbenchItemResponse(**item) for item in data["notes"]],
    )


@router.get("/stats", response_model=WorkbenchStatsResponse)
async def get_workbench_stats():
    """
    获取工作台统计信息
    """
    return WorkbenchStatsResponse(**workbench_store.get_stats())


@router.post("/items", response_model=WorkbenchItemResponse)
async def add_workbench_item(request: AddItemRequest):
    """
    添加工作台项目
    """
    item = workbench_store.add_item(
        type=request.type,
        title=request.title,
        description=request.description,
        source_paper_id=request.source_paper_id,
        zone=request.zone,
        data=request.data or {},
    )
    return WorkbenchItemResponse(
        id=item.id,
        type=item.type,
        title=item.title,
        description=item.description,
        source_paper_id=item.source_paper_id,
        zone=item.zone,
        created_at=item.created_at,
        data=item.data,
    )


@router.get("/items/{item_id}", response_model=WorkbenchItemResponse)
async def get_workbench_item(item_id: str):
    """
    获取单个工作台项目
    """
    item = workbench_store.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="项目不存在")
    return WorkbenchItemResponse(**item)


@router.put("/items/{item_id}", response_model=WorkbenchItemResponse)
async def update_workbench_item(item_id: str, request: UpdateItemRequest):
    """
    更新工作台项目
    """
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    success = workbench_store.update_item(item_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    item = workbench_store.get_item(item_id)
    return WorkbenchItemResponse(**item)


@router.delete("/items/{item_id}")
async def delete_workbench_item(item_id: str):
    """
    删除工作台项目
    """
    success = workbench_store.delete_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"success": True, "message": "项目已删除"}


# Paper Workbench Router (to be mounted under /papers)
paper_workbench_router = APIRouter()


@paper_workbench_router.get("/{paper_id}/workbench", response_model=WorkbenchResponse)
async def get_paper_workbench(paper_id: str):
    """
    获取论文工作台
    
    返回特定论文关联的工作台项目
    """
    data = workbench_store.get_paper_workbench(paper_id)
    return WorkbenchResponse(
        methods=[WorkbenchItemResponse(**item) for item in data["methods"]],
        datasets=[WorkbenchItemResponse(**item) for item in data["datasets"]],
        notes=[WorkbenchItemResponse(**item) for item in data["notes"]],
    )


@paper_workbench_router.post("/{paper_id}/workbench/items", response_model=WorkbenchItemResponse)
async def add_paper_workbench_item(paper_id: str, request: AddItemRequest):
    """
    为论文添加工作台项目
    """
    item = workbench_store.add_item(
        type=request.type,
        title=request.title,
        description=request.description,
        source_paper_id=paper_id,  # 自动关联论文
        zone=request.zone,
        data=request.data or {},
    )
    return WorkbenchItemResponse(
        id=item.id,
        type=item.type,
        title=item.title,
        description=item.description,
        source_paper_id=item.source_paper_id,
        zone=item.zone,
        created_at=item.created_at,
        data=item.data,
    )


# ============ Analysis Endpoints ============

from app.services.workbench_analysis import (
    analyze_method,
    analyze_asset,
    create_smart_note,
    update_note_reflection,
)


class AnalyzeTextRequest(BaseModel):
    """分析文本请求"""
    text: str
    paper_id: str
    paper_title: str
    location: str = ""


class CreateNoteRequest(BaseModel):
    """创建笔记请求"""
    text: str
    paper_id: str
    paper_title: str
    location: str = ""
    is_title_note: bool = False
    reflection: str = ""


class UpdateReflectionRequest(BaseModel):
    """更新心得请求"""
    reflection: str


@router.post("/analyze/method")
async def analyze_method_endpoint(request: AnalyzeTextRequest):
    """
    方法炼金台分析
    
    分析选中的文本，提炼研究方法，生成伪代码，以审稿视角分析
    """
    result = await analyze_method(
        text=request.text,
        paper_id=request.paper_id,
        paper_title=request.paper_title,
        location=request.location,
    )
    return result


@router.post("/analyze/asset")
async def analyze_asset_endpoint(request: AnalyzeTextRequest):
    """
    资产仓库分析
    
    识别选中文本中的 GitHub/Huggingface/数据集等可复用资源
    """
    result = await analyze_asset(
        text=request.text,
        paper_id=request.paper_id,
        paper_title=request.paper_title,
        location=request.location,
    )
    return result


@router.post("/notes")
async def create_note_endpoint(request: CreateNoteRequest):
    """
    创建智能笔记
    
    保留原文，记录位置，支持用户心得
    """
    result = create_smart_note(
        text=request.text,
        paper_id=request.paper_id,
        paper_title=request.paper_title,
        location=request.location,
        is_title_note=request.is_title_note,
        reflection=request.reflection,
    )
    return result


@router.put("/notes/{item_id}/reflection")
async def update_reflection_endpoint(item_id: str, request: UpdateReflectionRequest):
    """
    更新笔记心得
    """
    result = update_note_reflection(item_id, request.reflection)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "更新失败"))
    return result


# ============ Smart Analysis Endpoints ============

from app.services.smart_analysis import smart_analyze


class SmartAnalyzeRequest(BaseModel):
    """智能分析请求"""
    text: str
    paper_id: str
    paper_title: str
    action_type: str  # 'math' | 'feynman' | 'deep' | 'chat'
    context: Optional[str] = None  # 周围上下文 (用于 chat)
    chat_history: Optional[List[Dict[str, str]]] = None  # 聊天历史
    user_message: Optional[str] = None  # 用户消息 (用于 chat)


@router.post("/analyze/smart")
async def smart_analyze_endpoint(request: SmartAnalyzeRequest):
    """
    智能分析选中文本
    
    支持类型:
    - math: 公式解析
    - feynman: 费曼教学法讲解
    - deep: 深度研究分析
    - chat: Chat with PDF 对话
    """
    result = await smart_analyze(
        text=request.text,
        paper_id=request.paper_id,
        paper_title=request.paper_title,
        action_type=request.action_type,
        context=request.context,
        chat_history=request.chat_history,
        user_message=request.user_message,
    )
    return result
