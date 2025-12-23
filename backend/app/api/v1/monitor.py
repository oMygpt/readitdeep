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


# ==================== SSE Streaming ====================
import asyncio
import json
from fastapi.responses import StreamingResponse


async def status_event_generator(paper_id: str):
    """
    SSE 事件生成器 - 实时推送论文处理进度
    
    前端使用 EventSource 连接此端点，接收实时更新：
    - event: progress
    - data: {"status": "analyzing", "progress": 70, "message": "..."}
    """
    last_status = None
    retry_count = 0
    max_retries = 300  # 最多等待 5 分钟 (300 * 1秒)
    
    while retry_count < max_retries:
        paper = store.get(paper_id)
        if not paper:
            yield f"event: error\ndata: {json.dumps({'error': 'Paper not found'})}\n\n"
            break
        
        current_status = paper.get("status")
        
        # 只在状态变化时发送事件（减少网络流量）
        if current_status != last_status:
            message = STATUS_MESSAGE.get(current_status, "处理中...")
            if current_status == "failed" and paper.get("error_message"):
                message = f"解析失败: {paper.get('error_message')}"
            
            event_data = {
                "status": current_status,
                "progress": STATUS_PROGRESS.get(current_status, 0),
                "message": message,
                "updated_at": paper.get("updated_at", datetime.utcnow()).isoformat() if hasattr(paper.get("updated_at", datetime.utcnow()), 'isoformat') else str(paper.get("updated_at", ""))
            }
            
            yield f"event: progress\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"
            last_status = current_status
            
            # 如果已完成或失败，发送完成事件并结束
            if current_status in ["completed", "failed"]:
                yield f"event: done\ndata: {json.dumps({'final_status': current_status})}\n\n"
                break
        
        await asyncio.sleep(1)  # 每秒检查一次
        retry_count += 1
    
    # 超时
    if retry_count >= max_retries:
        yield f"event: timeout\ndata: {json.dumps({'error': 'Timeout waiting for completion'})}\n\n"


@router.get("/{paper_id}/stream")
async def stream_task_status(paper_id: str):
    """
    SSE 实时进度流
    
    前端连接方式:
    ```javascript
    const eventSource = new EventSource(`/api/v1/monitor/${paperId}/stream`);
    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      console.log(data.status, data.progress, data.message);
    });
    eventSource.addEventListener('done', () => {
      eventSource.close();
    });
    ```
    """
    return StreamingResponse(
        status_event_generator(paper_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 禁用缓冲
        }
    )
