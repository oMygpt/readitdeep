"""
Read it DEEP - 翻译 API

端点:
- POST /papers/{id}/translate - 触发后台翻译任务
- GET /papers/{id}/translate/stream - SSE 流式翻译
- GET /papers/{id}/translation - 获取翻译状态和结果
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import logging

from app.api.deps import charge_ai_quota, require_paper_access
from app.api.v1.auth import get_current_user
from app.core.files import sign_markdown_images
from app.models.user import User
from app.services.translation import (
    start_translation_task,
    translate_paper_stream,
    get_translation_status,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class TranslationResponse(BaseModel):
    paper_id: str
    status: str  # not_started | translating | completed | failed
    progress: int = 0
    is_translated: bool = False
    translated_content: Optional[str] = None
    chunks_done: int = 0
    chunks_total: int = 0
    error: Optional[str] = None


class TriggerResponse(BaseModel):
    success: bool
    status: str
    message: str


async def _charge_if_new_translation(paper_id: str, user: User) -> None:
    """已完成或正在进行的翻译不再计配额；只有真正启动一次新翻译才扣调用者的 AI 配额。"""
    if get_translation_status(paper_id)["status"] in ("completed", "translating"):
        return
    from app.config import get_settings

    if get_settings().rid_mode == "linked":
        return  # 关联模式：全文翻译含在每篇 PDF 的价格里（设计 v0.2 §4）
    await charge_ai_quota(user.id)


@router.post("/{paper_id}/translate", response_model=TriggerResponse)
async def trigger_translation(
    paper_id: str,
    paper: dict = Depends(require_paper_access),
    current_user: User = Depends(get_current_user),
):
    """
    触发后台翻译任务
    
    翻译会在后台继续，即使客户端断开连接。
    使用 GET /translation 查询状态和结果。
    """
    if paper.get("status") not in ["completed", "analyzed"]:
        raise HTTPException(status_code=400, detail="论文尚未解析完成")

    await _charge_if_new_translation(paper_id, current_user)
    result = await start_translation_task(paper_id, current_user.id)
    return TriggerResponse(**result)


@router.get("/{paper_id}/translate/stream")
async def stream_translate_paper(
    paper_id: str,
    paper: dict = Depends(require_paper_access),
    current_user: User = Depends(get_current_user),
):
    """
    流式翻译论文 (SSE)
    
    返回 Server-Sent Events 流，包含:
    - [START] 开始信号
    - [PROGRESS] 进度信息
    - 翻译文本片段
    - [ERROR] 错误信息
    - [DONE] 完成信号
    - [ALREADY_DONE] 已翻译完成
    
    如果后台任务已在运行，会监听其进度。
    """
    if paper.get("status") not in ["completed", "analyzed"]:
        raise HTTPException(status_code=400, detail="论文尚未解析完成")

    await _charge_if_new_translation(paper_id, current_user)
    return StreamingResponse(
        translate_paper_stream(paper_id, current_user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/{paper_id}/translation", response_model=TranslationResponse)
async def get_paper_translation(paper_id: str, paper: dict = Depends(require_paper_access)):
    """
    获取翻译状态和结果
    
    返回:
    - status: 翻译状态 (not_started | translating | completed | failed)
    - progress: 进度百分比 (0-100)
    - is_translated: 是否已完成翻译
    - translated_content: 翻译内容 (可能是部分内容，如果正在翻译)
    """
    status_info = get_translation_status(paper_id)
    
    return TranslationResponse(
        paper_id=paper_id,
        status=status_info["status"],
        progress=status_info["progress"],
        is_translated=status_info["is_translated"],
        translated_content=sign_markdown_images(status_info["translated_content"]),
        chunks_done=status_info.get("chunks_done", 0),
        chunks_total=status_info.get("chunks_total", 0),
        error=status_info.get("error"),
    )
