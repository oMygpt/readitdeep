"""
GROBID 解析：PDF → TEI XML → Markdown

输出结构：标题、作者、摘要、按编号分级的章节、公式文本、图表（标题与表格）、
脚注、致谢、参考文献（编号与正文中的 [n] 引用一致）。不含图片（GROBID 只给坐标）。
"""

from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

from app.services.parsing import ParseResult

TEI = "{http://www.tei-c.org/ns/1.0}"
_semaphore: Optional[asyncio.Semaphore] = None


def _limit() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(2)  # 校内 GROBID 与入库流程共用，单进程最多 2 个并发
    return _semaphore


def _text(el: Optional[ET.Element]) -> str:
    if el is None:
        return ""
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def _heading(head: ET.Element) -> str:
    n = head.get("n")
    title = _text(head)
    if n:
        level = min(2 + n.rstrip(".").count("."), 4)
        return f"{'#' * level} {n} {title}"
    return f"### {title}"


def _table(table: ET.Element) -> str:
    rows = [[_text(c).replace("|", "\\|") for c in row.findall(f"{TEI}cell")] for row in table.findall(f"{TEI}row")]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _figure(fig: ET.Element) -> str:
    desc = _text(fig.find(f"{TEI}figDesc"))
    head = _text(fig.find(f"{TEI}head"))
    caption = desc or head
    parts = []
    if caption:
        parts.append(f"**{caption}**" if fig.get("type") == "table" else f"> **图** {caption}")
    table = fig.find(f"{TEI}table")
    if table is not None:
        md = _table(table)
        if md:
            parts.append(md)
    return "\n\n".join(parts)


def _block(el: ET.Element) -> str:
    tag = el.tag.replace(TEI, "")
    if tag == "head":
        return _heading(el)
    if tag == "p":
        return _text(el)
    if tag == "formula":
        label = _text(el.find(f"{TEI}label"))
        body = re.sub(r"\s+", " ", (el.text or "")).strip() or _text(el)
        if label and body.endswith(label):
            body = body[: -len(label)].strip()
        return f"*{body}*" + (f" {label}" if label else "")
    if tag == "figure":
        return _figure(el)
    if tag == "list":
        return "\n".join(f"- {_text(i)}" for i in el.findall(f"{TEI}item"))
    return _text(el)


def _authors(analytic: Optional[ET.Element]) -> list[str]:
    if analytic is None:
        return []
    names = []
    for pers in analytic.findall(f"{TEI}author/{TEI}persName"):
        name = " ".join(_text(x) for x in pers if x.tag in (f"{TEI}forename", f"{TEI}surname"))
        if name:
            names.append(name)
    return names


def _reference(bibl: ET.Element) -> str:
    # 优先用论文里印刷的原始引文（includeRawCitations=1），最忠实；没有时再用结构化字段拼
    raw = _text(bibl.find(f"{TEI}note[@type='raw_reference']"))
    if raw:
        return raw
    analytic = bibl.find(f"{TEI}analytic")
    monogr = bibl.find(f"{TEI}monogr")
    authors = _authors(analytic) or _authors(monogr)
    title = _text(analytic.find(f"{TEI}title")) if analytic is not None else ""
    venue = _text(monogr.find(f"{TEI}title")) if monogr is not None else ""
    if not title:
        title, venue = venue, ""
    date = bibl.find(f".//{TEI}date")
    year = (date.get("when") or _text(date))[:4] if date is not None else ""
    if not (title or authors):
        return _text(bibl.find(f"{TEI}note[@type='raw_reference']"))
    author_str = ", ".join(authors[:6]) + (" et al." if len(authors) > 6 else "")
    pieces = [p for p in (author_str, title, venue, year) if p]
    return ". ".join(pieces) + "."


def tei_to_markdown(tei_xml: str) -> tuple[str, dict]:
    root = ET.fromstring(tei_xml)
    header = root.find(f"{TEI}teiHeader")
    title = _text(header.find(f".//{TEI}titleStmt/{TEI}title")) if header is not None else ""
    authors = _authors(header.find(f".//{TEI}sourceDesc/{TEI}biblStruct/{TEI}analytic")) if header is not None else []
    doi = _text(header.find(f".//{TEI}sourceDesc//{TEI}idno[@type='DOI']")) if header is not None else ""

    out: list[str] = []
    if title:
        out.append(f"# {title}")
    if authors:
        out.append(", ".join(authors))
    abstract = header.find(f".//{TEI}profileDesc/{TEI}abstract") if header is not None else None
    if abstract is not None and _text(abstract):
        out.append("## Abstract")
        out += [_text(p) for p in abstract.iter(f"{TEI}p") if _text(p)]

    body = root.find(f"{TEI}text/{TEI}body")
    figures, notes = [], []
    if body is not None:
        for child in body:
            tag = child.tag.replace(TEI, "")
            if tag == "div":
                out += [b for b in (_block(el) for el in child) if b]
            elif tag == "figure":
                figures.append(_figure(child))
            elif tag == "note":
                notes.append(_text(child))
            else:
                text = _block(child)
                if text:
                    out.append(text)
    if figures:
        out.append("## 图表")
        out += [f for f in figures if f]
    if notes:
        out.append("## 注释")
        out += [f"- {n}" for n in notes if n]

    back = root.find(f"{TEI}text/{TEI}back")
    references = []
    if back is not None:
        for div in back.findall(f"{TEI}div"):
            if div.get("type") in ("acknowledgement", "funding", "annex"):
                heading = {"acknowledgement": "致谢", "funding": "基金", "annex": "附录"}[div.get("type")]
                paragraphs = [_text(p) for p in div.iter(f"{TEI}p") if _text(p)]
                if paragraphs:
                    out.append(f"## {heading}")
                    out += paragraphs
        references = [_reference(b) for b in back.iter(f"{TEI}biblStruct")]
    if references:
        out.append("## References")
        out += [f"[{i}] {r}" for i, r in enumerate(references, 1) if r]

    meta = {"title": title, "authors": authors, "doi": doi, "reference_count": len(references)}
    return "\n\n".join(out) + "\n", meta


async def parse_with_grobid(base_url: str, filename: str, content: bytes) -> ParseResult:
    if not filename.lower().endswith(".pdf"):
        return ParseResult(False, error="GROBID 只支持 PDF")
    url = base_url.rstrip("/") + "/api/processFulltextDocument"
    async with _limit():
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                url,
                files={"input": (filename, content, "application/pdf")},
                data={"consolidateHeader": "0", "includeRawCitations": "1"},
            )
    if response.status_code != 200:
        return ParseResult(False, error=f"GROBID 返回 {response.status_code}")
    try:
        markdown, meta = tei_to_markdown(response.text)
    except ET.ParseError as e:
        return ParseResult(False, error=f"GROBID 输出无法解析: {e}")
    return ParseResult(True, markdown, {}, meta=meta)
