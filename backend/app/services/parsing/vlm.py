"""
视觉模型解析：PDF 逐页渲染成图片，交给视觉语言模型（如校内 Qwen3-VL-32B）转写为 Markdown。

- 公式输出为 LaTeX，表格输出为 Markdown 表格；
- 图片：要求模型给出图在页面上的归一化坐标（0-1000），再从页面上裁出图片；
- 页面并发受模型池的 vlm 通道限制；单页失败重试一次，仍失败则在该处标注；
  失败页超过 30% 视为整体失败，交给下一个解析器（如 GROBID）。
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from typing import Optional

from app.services.parsing import ParseResult

logger = logging.getLogger(__name__)

DPI = 150
PROMPT = (
    "把这一页学术论文完整转写为 Markdown：保留标题层级、段落、公式（LaTeX，行内 $...$，独立 $$...$$）、"
    "表格（Markdown 表格）。遇到图片/示意图（不是表格）时，单独输出一行 ![图注文字](bbox:x1,y1,x2,y2)，"
    "坐标是该图在页面上的位置，按 0-1000 归一化（左上为原点）。页眉、页脚和页码不要输出。"
    "只输出转写结果，不要总结，看不清的内容不要编造。"
)
# 模型有时省略 bbox: 前缀，两种都认
_FIGURE = re.compile(r"!\[([^\]]*)\]\((?:bbox:)?\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)")
_FENCE = re.compile(r"^\s*```(?:markdown|md)?\s*\n(.*?)\n\s*```\s*$", re.S)


def _clean(text: str) -> str:
    m = _FENCE.match(text or "")
    return (m.group(1) if m else (text or "")).strip()


def crop_figures(page, page_no: int, markdown: str) -> tuple[str, dict[str, bytes]]:
    """把 ![图注](bbox:…) 替换为裁出的图片文件名，返回（新 Markdown，{文件名: PNG}）。"""
    import pymupdf

    images: dict[str, bytes] = {}
    rect = page.rect

    def replace(m: re.Match) -> str:
        caption = m.group(1).strip()
        x1, y1, x2, y2 = (float(m.group(i)) for i in range(2, 6))
        x1, x2 = sorted((max(0.0, min(1000.0, x1)), max(0.0, min(1000.0, x2))))
        y1, y2 = sorted((max(0.0, min(1000.0, y1)), max(0.0, min(1000.0, y2))))
        if x2 - x1 < 5 or y2 - y1 < 5:
            return f"*{caption}*" if caption else ""
        clip = pymupdf.Rect(x1 / 1000 * rect.width, y1 / 1000 * rect.height, x2 / 1000 * rect.width, y2 / 1000 * rect.height)
        name = f"p{page_no}_fig{len(images) + 1}.png"
        images[name] = page.get_pixmap(dpi=DPI, clip=clip).tobytes("png")
        return f"![{caption}]({name})"

    return _FIGURE.sub(replace, markdown), images


async def _transcribe(llm, png: bytes) -> str:
    from langchain_core.messages import HumanMessage

    message = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
        {"type": "text", "text": PROMPT},
    ])
    last: Optional[Exception] = None
    for _ in range(2):
        try:
            response = await llm.ainvoke([message], max_tokens=4000)
            if (getattr(response, "response_metadata", {}) or {}).get("finish_reason") in {"length", "max_tokens"}:
                raise ValueError("VLM page output truncated at token limit")
            return _clean(response.content)
        except ValueError:
            raise
        except Exception as e:  # 单页重试一次
            last = e
    raise last  # type: ignore[misc]


async def parse_with_vlm(filename: str, content: bytes, user_id: Optional[str], max_pages: int = 80) -> ParseResult:
    if not filename.lower().endswith(".pdf"):
        return ParseResult(False, error="视觉模型解析只支持 PDF")
    import pymupdf

    from app.services.llm import VLM, get_chat_model

    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as e:
        return ParseResult(False, error=f"PDF 无法打开: {e}")
    if doc.page_count == 0:
        return ParseResult(False, error="PDF 没有页面")
    if doc.page_count > max_pages:
        return ParseResult(False, error=f"页数 {doc.page_count} 超过视觉解析上限 {max_pages}")

    llm = await get_chat_model("vlm", user_id, temperature=0, timeout=180, channel=VLM, usage_label="vlm_parse")
    pages = [doc[i] for i in range(doc.page_count)]
    renders = [p.get_pixmap(dpi=DPI).tobytes("png") for p in pages]
    results = await asyncio.gather(*(_transcribe(llm, png) for png in renders), return_exceptions=True)

    parts: list[str] = []
    images: dict[str, bytes] = {}
    failed: list[int] = []
    for i, (page, result) in enumerate(zip(pages, results), start=1):
        if isinstance(result, BaseException) or not result:
            failed.append(i)
            logger.warning("VLM page %d failed: %s", i, result)
            parts.append(f"> [第 {i} 页解析失败]")
            continue
        markdown, page_images = crop_figures(page, i, result)
        images.update(page_images)
        parts.append(markdown)
    if len(failed) > 0.3 * doc.page_count:
        return ParseResult(False, error=f"视觉解析失败页过多（{len(failed)}/{doc.page_count}）")

    markdown = "\n\n".join(parts) + "\n"
    title_match = re.search(r"^#\s+(.+)$", markdown, re.M)
    meta = {"pages": doc.page_count, "failed_pages": failed, "figures": len(images),
            "title": title_match.group(1).strip() if title_match else ""}
    return ParseResult(True, markdown, images, meta=meta)
