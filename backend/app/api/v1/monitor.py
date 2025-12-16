"""
Read it DEEP - Monitor API
任务状态监控 (用于前端轮询)
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.store import store

# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy import select
# from fastapi import Depends
# from app.core.database import get_db
# from app.models.paper import Paper

# from app.api.v1.papers import _papers_store


router = APIRouter()


class TaskStatus(BaseModel):
    """任务状态"""
    id: str
    status: str  # uploading, parsing, indexing, completed, failed
    progress: int  # 0-100
    message: str
    updated_at: datetime


# 状态到进度的映射
STATUS_PROGRESS = {
    "uploading": 5,
    "parsing": 20,
    "indexing": 40,
    "embedding": 55,
    "analyzing": 70,
    "classifying": 85,
    "analyzed": 95,
    "completed": 100,
    "failed": 0,
}

STATUS_MESSAGE = {
    "uploading": "文件上传中...",
    "parsing": "正在解析 PDF 文本...",
    "indexing": "处理图片和引用...",
    "embedding": "生成向量索引...",
    "analyzing": "智能分析内容...",
    "classifying": "自动分类中...",
    "analyzed": "分析完成，整理结果...",
    "completed": "✓ 分析完成，可以打开阅读",
    "failed": "处理失败",
}


@router.get("/{paper_id}", response_model=TaskStatus)
async def get_task_status(paper_id: str) -> TaskStatus:
    """
    获取论文解析任务状态
    
    前端轮询此接口获取实时进度:
    - Uploading... → Parsing... → Indexing... → Completed
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    status = paper.get("status")
    
    # 如果失败，显示具体错误信息
    message = STATUS_MESSAGE.get(status, "未知状态")
    if status == "failed" and paper.get("error_message"):
        message = f"解析失败: {paper.get('error_message')}"
    
    return TaskStatus(
        id=paper_id,
        status=status,
        progress=STATUS_PROGRESS.get(status, 0),
        message=message,
        updated_at=paper.get("updated_at", datetime.utcnow()),
    )


@router.get("/")
async def list_active_tasks() -> dict:
    """获取所有进行中的任务"""
    active_statuses = ["uploading", "parsing", "indexing"]
    
    all_papers = store.get_all()
    
    active_tasks = [
        {
            "id": p["id"],
            "filename": p["filename"],
            "status": p["status"],
            "progress": STATUS_PROGRESS.get(p["status"], 0),
        }
        for p in all_papers
        if p.get("status") in active_statuses
    ]
    
    return {"tasks": active_tasks, "count": len(active_tasks)}
