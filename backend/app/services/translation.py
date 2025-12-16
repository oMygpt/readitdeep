"""
Read it DEEP - 流式翻译服务

功能:
- SSE 流式输出翻译结果
- 保持 Markdown 格式
- 持久化翻译结果
"""

from typing import AsyncGenerator
import logging
import re

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.core.store import store

logger = logging.getLogger(__name__)
settings = get_settings()

# 翻译 LLM (使用 streaming)
llm = ChatOpenAI(
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


async def translate_paper_stream(paper_id: str) -> AsyncGenerator[str, None]:
    """
    流式翻译论文内容
    
    Yields:
        翻译文本片段 (SSE 格式)
    """
    paper = store.get(paper_id)
    if not paper:
        yield "data: [ERROR] 论文不存在\n\n"
        return
    
    content = paper.get("markdown_content", "")
    if not content:
        yield "data: [ERROR] 论文内容为空\n\n"
        return
    
    # 分块翻译 (避免超长内容)
    # 按段落分块，每块约 3000 字符
    chunks = _split_content(content, max_chars=3000)
    
    translated_parts = []
    
    yield f"data: [START] 开始翻译 ({len(chunks)} 个段落)\n\n"
    
    for i, chunk in enumerate(chunks):
        yield f"data: [PROGRESS] 翻译段落 {i+1}/{len(chunks)}\n\n"
        
        prompt = TRANSLATION_PROMPT.format(content=chunk)
        
        try:
            async for token in llm.astream([
                SystemMessage(content="你是一个专业的学术论文翻译专家，精通中英文学术写作。"),
                HumanMessage(content=prompt)
            ]):
                if token.content:
                    # 转义换行符以适应 SSE 格式
                    escaped = token.content.replace("\n", "\\n")
                    yield f"data: {escaped}\n\n"
                    translated_parts.append(token.content)
        except Exception as e:
            logger.error(f"Translation error for chunk {i}: {e}")
            yield f"data: [ERROR] 翻译失败: {str(e)}\n\n"
    
    # 保存翻译结果
    full_translation = "".join(translated_parts)
    store.set(paper_id, {
        **paper,
        "translated_content": full_translation,
        "is_translated": True,
    })
    
    yield "data: [DONE]\n\n"
    logger.info(f"Paper {paper_id}: Translation completed ({len(full_translation)} chars)")


def _split_content(content: str, max_chars: int = 3000) -> list[str]:
    """
    按段落分割内容
    """
    # 按双换行分割段落
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


def get_translation(paper_id: str) -> str | None:
    """
    获取已保存的翻译结果
    """
    paper = store.get(paper_id)
    if paper:
        return paper.get("translated_content")
    return None
