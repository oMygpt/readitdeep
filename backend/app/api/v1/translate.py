"""
Read it DEEP - 翻译 API

端点:
- GET /papers/{id}/translate/stream - SSE 流式翻译
- GET /papers/{id}/translation - 获取已保存译文
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import logging

from app.core.store import store
from app.services.translation import translate_paper_stream, get_translation

logger = logging.getLogger(__name__)
router = APIRouter()


class TranslationResponse(BaseModel):
    paper_id: str
    translated_content: Optional[str] = None
    is_translated: bool = False


@router.get("/{paper_id}/translate/stream")
async def stream_translate_paper(paper_id: str):
    """
    流式翻译论文 (SSE)
    
    返回 Server-Sent Events 流，包含:
    - [START] 开始信号
    - [PROGRESS] 进度信息
    - 翻译文本片段
    - [ERROR] 错误信息
    - [DONE] 完成信号
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if paper.get("status") != "completed":
        raise HTTPException(status_code=400, detail="论文尚未解析完成")
    
    return StreamingResponse(
        translate_paper_stream(paper_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/{paper_id}/translation", response_model=TranslationResponse)
async def get_paper_translation(paper_id: str):
    """
    获取已保存的翻译结果
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    return TranslationResponse(
        paper_id=paper_id,
        translated_content=paper.get("translated_content"),
        is_translated=paper.get("is_translated", False),
    )
