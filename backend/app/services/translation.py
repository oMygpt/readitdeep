"""
Read it DEEP - 翻译服务 (Background Task)

功能:
- 后台任务翻译 (离开页面继续)
- SSE 流式输出 (可选实时查看)
- 增量保存翻译结果
- 保持 Markdown 格式
"""

import asyncio
from typing import AsyncGenerator, Dict, Any
import logging
import re

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.core.store import store

logger = logging.getLogger(__name__)
settings = get_settings()

# 翻译 LLM (使用 streaming)
def get_translation_llm():
    """获取翻译 LLM (每次获取以支持动态配置)"""
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key or "dummy",
        model=settings.llm_model,
        temperature=0.3,
        streaming=True,
    )

TRANSLATION_PROMPT = """请将以下学术论文内容翻译成中文。

## 翻译要求
1. **保持格式**: 保留所有 Markdown 格式（标题、列表、代码块、表格等）
2. **术语准确**: 专业术语翻译准确，必要时保留英文原词
3. **学术风格**: 使用学术论文的正式语体
4. **公式保留**: LaTeX 公式保持原样，不翻译
5. **引用保留**: 参考文献引用格式保持原样

## 原文内容
{content}

## 翻译结果
"""

# 存储活跃的翻译任务
_active_translation_tasks: Dict[str, asyncio.Task] = {}


async def start_translation_task(paper_id: str) -> Dict[str, Any]:
    """
    启动后台翻译任务
    
    这是主入口 - 翻译会在后台继续，即使客户端断开
    
    Returns:
        {"success": True/False, "status": "...", "message": "..."}
    """
    paper = store.get(paper_id)
    if not paper:
        return {"success": False, "status": "error", "message": "论文不存在"}
    
    # 检查是否已经在翻译或已翻译
    translation_status = paper.get("translation_status", "not_started")
    if translation_status == "translating":
        return {"success": True, "status": "translating", "message": "翻译正在进行中"}
    if translation_status == "completed" and paper.get("translated_content"):
        return {"success": True, "status": "completed", "message": "翻译已完成"}
    
    content = paper.get("markdown_content", "")
    if not content:
        return {"success": False, "status": "error", "message": "论文内容为空"}
    
    # 标记为翻译中
    store.set(paper_id, {
        **paper,
        "translation_status": "translating",
        "translation_progress": 0,
        "translation_chunks_total": 0,
        "translation_chunks_done": 0,
    })
    
    # 创建后台任务
    task = asyncio.create_task(_translate_paper_background(paper_id))
    _active_translation_tasks[paper_id] = task
    
    # 任务完成时清理
    task.add_done_callback(lambda t: _active_translation_tasks.pop(paper_id, None))
    
    logger.info(f"Started background translation for paper {paper_id}")
    return {"success": True, "status": "translating", "message": "翻译已开始"}


async def _translate_paper_background(paper_id: str) -> None:
    """
    后台翻译论文 - 增量保存，不依赖客户端连接
    """
    try:
        paper = store.get(paper_id)
        if not paper:
            return
        
        content = paper.get("markdown_content", "")
        chunks = _split_content(content, max_chars=3000)
        total_chunks = len(chunks)
        
        # 更新 chunk 总数
        store.set(paper_id, {
            **store.get(paper_id),
            "translation_chunks_total": total_chunks,
        })
        
        translated_parts = []
        llm = get_translation_llm()
        
        for i, chunk in enumerate(chunks):
            prompt = TRANSLATION_PROMPT.format(content=chunk)
            chunk_result = []
            
            try:
                async for token in llm.astream([
                    SystemMessage(content="你是一个专业的学术论文翻译专家，精通中英文学术写作。"),
                    HumanMessage(content=prompt)
                ]):
                    if token.content:
                        chunk_result.append(token.content)
            except Exception as e:
                logger.error(f"Translation error for chunk {i}: {e}")
                chunk_result.append(f"\n\n[翻译错误: {str(e)}]\n\n")
            
            translated_parts.append("".join(chunk_result))
            
            # 增量保存进度
            current_paper = store.get(paper_id)
            if current_paper:
                progress = int(((i + 1) / total_chunks) * 100)
                store.set(paper_id, {
                    **current_paper,
                    "translation_status": "translating",
                    "translation_progress": progress,
                    "translation_chunks_done": i + 1,
                    # 增量保存已翻译内容
                    "translated_content": "\n\n".join(translated_parts),
                })
        
        # 翻译完成
        final_paper = store.get(paper_id)
        if final_paper:
            store.set(paper_id, {
                **final_paper,
                "translation_status": "completed",
                "translation_progress": 100,
                "is_translated": True,
                "translated_content": "\n\n".join(translated_parts),
            })
        
        logger.info(f"Paper {paper_id}: Background translation completed")
        
    except Exception as e:
        logger.error(f"Background translation failed for {paper_id}: {e}")
        paper = store.get(paper_id)
        if paper:
            store.set(paper_id, {
                **paper,
                "translation_status": "failed",
                "translation_error": str(e),
            })


async def translate_paper_stream(paper_id: str) -> AsyncGenerator[str, None]:
    """
    流式翻译论文内容 (SSE 格式)
    
    如果后台任务已在运行，则监听其进度
    否则启动新任务并流式输出
    """
    paper = store.get(paper_id)
    if not paper:
        yield "data: [ERROR] 论文不存在\n\n"
        return
    
    # 检查状态
    translation_status = paper.get("translation_status", "not_started")
    
    if translation_status == "completed" and paper.get("translated_content"):
        yield "data: [ALREADY_DONE]\n\n"
        return
    
    # 如果没有在翻译，启动任务
    if translation_status != "translating":
        result = await start_translation_task(paper_id)
        if not result["success"]:
            yield f"data: [ERROR] {result['message']}\n\n"
            return
    
    content = paper.get("markdown_content", "")
    chunks = _split_content(content, max_chars=3000)
    total_chunks = len(chunks)
    
    yield f"data: [START] 开始翻译 ({total_chunks} 个段落)\n\n"
    
    # 等待后台任务并流式输出
    last_progress = 0
    last_content_len = 0
    
    while True:
        await asyncio.sleep(0.5)  # 轮询间隔
        
        current_paper = store.get(paper_id)
        if not current_paper:
            yield "data: [ERROR] 论文不存在\n\n"
            return
        
        status = current_paper.get("translation_status", "not_started")
        progress = current_paper.get("translation_progress", 0)
        translated = current_paper.get("translated_content", "")
        
        # 输出进度
        if progress > last_progress:
            chunks_done = current_paper.get("translation_chunks_done", 0)
            yield f"data: [PROGRESS] 翻译段落 {chunks_done}/{total_chunks}\n\n"
            last_progress = progress
        
        # 输出新增内容
        if len(translated) > last_content_len:
            new_content = translated[last_content_len:]
            escaped = new_content.replace("\n", "\\n")
            yield f"data: {escaped}\n\n"
            last_content_len = len(translated)
        
        # 检查完成
        if status == "completed":
            yield "data: [DONE]\n\n"
            return
        elif status == "failed":
            error = current_paper.get("translation_error", "未知错误")
            yield f"data: [ERROR] {error}\n\n"
            return


def get_translation_status(paper_id: str) -> Dict[str, Any]:
    """
    获取翻译状态和结果
    """
    paper = store.get(paper_id)
    if not paper:
        return {
            "status": "not_found",
            "progress": 0,
            "is_translated": False,
            "translated_content": None,
        }
    
    return {
        "status": paper.get("translation_status", "not_started"),
        "progress": paper.get("translation_progress", 0),
        "is_translated": paper.get("is_translated", False),
        "translated_content": paper.get("translated_content"),
        "chunks_done": paper.get("translation_chunks_done", 0),
        "chunks_total": paper.get("translation_chunks_total", 0),
        "error": paper.get("translation_error"),
    }


def get_translation(paper_id: str) -> str | None:
    """
    获取已保存的翻译结果
    """
    paper = store.get(paper_id)
    if paper:
        return paper.get("translated_content")
    return None


def _split_content(content: str, max_chars: int = 3000) -> list[str]:
    """
    按段落分割内容
    """
    paragraphs = re.split(r'\n\n+', content)
    
    chunks = []
    current_chunk = []
    current_length = 0
    
    for para in paragraphs:
        para_length = len(para)
        
        if current_length + para_length > max_chars and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [para]
            current_length = para_length
        else:
            current_chunk.append(para)
            current_length += para_length
    
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))
    
    return chunks
