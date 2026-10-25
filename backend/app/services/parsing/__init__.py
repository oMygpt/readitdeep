"""
Read it DEEP - 可插拔论文解析

parse_with_fallback() 按系统配置的顺序依次尝试解析器，第一个成功的结果被采用，
结果里的 parser 字段记录实际使用的解析器。

- vlm:                 视觉语言模型逐页转写（校内 Qwen3-VL 等；公式 LaTeX、表格、裁图），仅 PDF
- mineru:              MinerU 云 API（版面、公式、图片质量最好，需要 API Key）
- grobid:              自建 GROBID（校内可用；文本、章节、图表标题、参考文献，不含图片，仅 PDF）
- paperdaily_markdown: PaperDaily 关联模式下直接使用主站已解析的开放许可全文（R4）

配置（系统配置或环境变量）：
- parse_providers / PARSE_PROVIDERS：逗号分隔的顺序；为空时自动选择——
  配了视觉模型（vlm_model）的放最前，其后依次是 MinerU（有 Key）与 GROBID（有地址）
- grobid_url / GROBID_URL
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ParseResult:
    success: bool
    markdown_content: str = ""
    images: dict[str, bytes] = field(default_factory=dict)
    error: Optional[str] = None
    parser: Optional[str] = None
    meta: dict = field(default_factory=dict)


def provider_order(config: dict) -> list[str]:
    explicit = [p.strip() for p in re.split(r"[,\s]+", config.get("parse_providers") or "") if p.strip()]
    if explicit:
        return explicit
    order = []
    if config.get("vlm_model"):
        order.append("vlm")
    if config.get("mineru_api_key"):
        order.append("mineru")
    if config.get("grobid_url"):
        order.append("grobid")
    return order


async def _run(name: str, config: dict, filename: str, content: bytes, paper_id: str, user_id: Optional[str] = None) -> ParseResult:
    if name == "vlm":
        if not config.get("vlm_model"):
            return ParseResult(False, error="视觉模型未配置")
        from app.services.parsing.vlm import parse_with_vlm

        return await parse_with_vlm(filename, content, user_id, int(config.get("vlm_max_pages") or 80))
    if name == "mineru":
        if not config.get("mineru_api_key"):
            return ParseResult(False, error="MinerU API Key 未配置")
        from app.services.mineru import MineruService

        service = MineruService(api_key=config["mineru_api_key"])
        try:
            r = await service.parse_file(filename=filename, file_content=content, data_id=paper_id)
        finally:
            await service.close()
        return ParseResult(r.success, r.markdown_content or "", r.images or {}, r.error)
    if name == "grobid":
        if not config.get("grobid_url"):
            return ParseResult(False, error="GROBID 地址未配置")
        from app.services.parsing.grobid import parse_with_grobid

        return await parse_with_grobid(config["grobid_url"], filename, content)
    if name == "paperdaily_markdown":
        return ParseResult(False, error="PaperDaily 全文来源将在关联模式中提供")
    return ParseResult(False, error=f"未知解析器: {name}")


async def parse_with_fallback(config: dict, filename: str, content: bytes, paper_id: str, user_id: Optional[str] = None) -> ParseResult:
    order = provider_order(config)
    if not order:
        return ParseResult(False, error="未配置论文解析服务：请管理员配置视觉模型、MinerU API Key 或 GROBID 地址")
    errors = []
    for name in order:
        try:
            result = await _run(name, config, filename, content, paper_id, user_id)
        except Exception as e:  # 单个解析器异常不影响回退
            logger.exception("Parser %s crashed for %s", name, paper_id)
            result = ParseResult(False, error=str(e))
        if result.success and result.markdown_content.strip():
            result.parser = name
            return result
        errors.append(f"{name}: {result.error or '结果为空'}")
        logger.warning("Parser %s failed for %s: %s", name, paper_id, result.error)
    return ParseResult(False, error="；".join(errors))
