"""
Read it DEEP - PDF 入库（设计 2026-10-27 v0.2 §3）

题录与 PDF 分离：论文可以只有题录（status=metadata），用户上传或抓取 PDF 后才计费并解析。
- inspect_pdf：校验是 PDF，算 SHA-256、页数、字节数（计费与缓存身份）；
- fetch_open_access：只从部署层白名单域名（OA_PDF_HOSTS）抓取，每一跳都校验域名与公网地址，限 3 次跳转、限大小。
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Optional
from urllib.parse import quote, urljoin, urlparse

import httpx

from app.config import get_settings

MAX_REDIRECTS = 3


class IntakeError(ValueError):
    """消息可直接给用户看"""


def inspect_pdf(content: bytes) -> dict:
    if not content.startswith(b"%PDF-"):
        raise IntakeError("文件不是有效的 PDF")
    if len(content) > get_settings().oa_pdf_max_bytes:
        raise IntakeError("PDF 超过大小上限")
    try:
        import fitz  # PyMuPDF

        with fitz.open(stream=content, filetype="pdf") as doc:
            pages = doc.page_count
    except Exception as e:
        raise IntakeError("PDF 无法打开（可能已损坏或加密）") from e
    if pages <= 0:
        raise IntakeError("PDF 没有页面")
    return {"sha256": hashlib.sha256(content).hexdigest(), "pages": pages, "bytes": len(content)}


def save_pdf(user_id: str, paper_id: str, filename: str, content: bytes) -> str:
    upload_dir = f"data/uploads/{user_id}"
    os.makedirs(upload_dir, exist_ok=True)
    safe = os.path.basename((filename or "paper.pdf").replace("\\", "/")) or "paper.pdf"
    if not safe.lower().endswith(".pdf"):
        safe += ".pdf"
    path = os.path.join(upload_dir, f"{paper_id}_{safe}")
    with open(path, "wb") as f:
        f.write(content)
    return path


def _hosts() -> list[str]:
    return [h.strip().lower() for h in get_settings().oa_pdf_hosts.split(",") if h.strip()]


def host_allowed(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host == h or host.endswith("." + h) for h in _hosts())


ARXIV_ABS = re.compile(r"^https://(?:www\.|export\.)?arxiv\.org/abs/(.+?)(?:v\d+)?/?$")
ARXIV_ID = re.compile(r"^(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?$")


def oa_candidates(paper: dict) -> list[str]:
    """论文题录里可以尝试的开放获取 PDF 地址（只保留白名单域名）"""
    urls: list[str] = []
    arxiv = (paper.get("arxiv_id") or "").strip()
    if arxiv and ARXIV_ID.match(arxiv):
        urls.append(f"https://arxiv.org/pdf/{arxiv}")
    for key in ("oa_pdf_url", "external_full_text_url"):
        url = (paper.get(key) or "").strip()
        m = ARXIV_ABS.match(url)
        if m:
            url = f"https://arxiv.org/pdf/{m.group(1)}"
        if url and host_allowed(url) and url not in urls:
            urls.append(url)
    return [u for u in urls if host_allowed(u)]


# 非开放获取论文：按 DOI 前缀判断出版商数据库，给用户可点击的落地页（不代理、不抓取）
PUBLISHERS: dict[str, str] = {
    "10.1016": "ScienceDirect", "10.1007": "SpringerLink", "10.1002": "Wiley", "10.1111": "Wiley",
    "10.1080": "Taylor & Francis", "10.1177": "SAGE", "10.1109": "IEEE Xplore", "10.1145": "ACM",
    "10.1093": "Oxford Academic", "10.1017": "Cambridge Core", "10.2307": "JSTOR", "10.1257": "AEA",
    "10.1086": "Chicago Journals", "10.1287": "INFORMS", "10.1162": "MIT Press", "10.1038": "Nature",
    "10.1126": "Science", "10.1073": "PNAS", "10.1021": "ACS", "10.1103": "APS", "10.1088": "IOP",
    "10.1108": "Emerald", "10.1037": "APA PsycNet", "10.1515": "De Gruyter", "10.3982": "Econometric Society",
    "10.1146": "Annual Reviews", "10.2139": "SSRN", "10.3386": "NBER", "10.1142": "World Scientific",
}
DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)?(10\.\d{4,9}/\S+)$", re.I)
CJK = re.compile(r"[\u4e00-\u9fff]")


def access_links(paper: dict) -> list[dict]:
    """论文题录 → 数据库落地页链接 [{label, url}]；DOI 走 doi.org 解析到出版商，中文题名附知网检索。"""
    links: list[dict] = []
    m = DOI.match((paper.get("doi") or "").strip())
    if m:
        doi = m.group(1)
        name = PUBLISHERS.get(doi.split("/", 1)[0])
        links.append({"label": name or "DOI", "url": f"https://doi.org/{quote(doi, safe='/:;()._-')}"})
    title = (paper.get("title") or "").strip()
    if title and CJK.search(title):
        links.append({"label": "知网", "url": f"https://kns.cnki.net/kns8s/defaultresult/index?kw={quote(title[:200])}"})
    if not links and title:
        links.append({"label": "Google Scholar", "url": f"https://scholar.google.com/scholar?q={quote(title[:300])}"})
    return links


def http_client() -> httpx.AsyncClient:  # 测试替换
    return httpx.AsyncClient(timeout=60, follow_redirects=False, headers={"User-Agent": "ReadItDeep/1.0 (+https://read.paperdaily.org)"})


async def fetch_open_access(url: str) -> bytes:
    from app.core.url_guard import validate_public_url

    limit = get_settings().oa_pdf_max_bytes
    async with http_client() as c:
        for _ in range(MAX_REDIRECTS + 1):
            if not host_allowed(url):
                raise IntakeError("该来源不在开放获取白名单内，请手动上传 PDF")
            try:
                validate_public_url(url)
            except ValueError as e:
                raise IntakeError(str(e)) from e
            async with c.stream("GET", url) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200:
                    raise IntakeError(f"开放获取来源返回 {r.status_code}，请手动上传 PDF")
                declared = int(r.headers.get("content-length") or 0)
                if declared > limit:
                    raise IntakeError("PDF 超过大小上限")
                chunks, total = [], 0
                async for chunk in r.aiter_bytes():
                    total += len(chunk)
                    if total > limit:
                        raise IntakeError("PDF 超过大小上限")
                    chunks.append(chunk)
                return b"".join(chunks)
    raise IntakeError("跳转次数过多，请手动上传 PDF")


def metadata_fields(pd_paper: dict) -> dict:
    """主站论文详情 → 本站题录字段（只取需要的，长度截断）"""
    authors = pd_paper.get("authors")
    if isinstance(authors, list):
        names = [a.get("name") if isinstance(a, dict) else str(a) for a in authors]
        authors = ", ".join(n for n in names if n)[:5000]
    elif authors is not None:
        authors = str(authors)[:5000]
    return {
        "title": (pd_paper.get("title") or "")[:1000] or None,
        "authors": authors or None,
        "abstract": (pd_paper.get("abstract") or None),
        "doi": (pd_paper.get("doi") or None),
        "arxiv_id": (pd_paper.get("arxiv_id") or pd_paper.get("arxiv") or None),
        "external_full_text_url": pd_paper.get("external_full_text_url") or None,
        "oa_pdf_url": pd_paper.get("oa_pdf_url") or None,
        "venue_name": pd_paper.get("venue_name") or None,
        "publication_date": str(pd_paper.get("publication_date") or "")[:10] or None,
    }


def first(values: list[Optional[str]]) -> Optional[str]:
    return next((v for v in values if v), None)
