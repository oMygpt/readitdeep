"""
Read it DEEP - Citation Export API

支持多种引用格式导出:
- BibTeX (.bib)
- RIS (.ris)
- Plain Text (.txt)
"""

import re
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.store import store
from app.models.user import User
from app.api.v1.auth import get_current_user


router = APIRouter()


# ==================== Request/Response Models ====================

class ExportCitationRequest(BaseModel):
    """导出引用请求"""
    paper_ids: List[str]
    format: str = "bibtex"  # bibtex | ris | plain


# ==================== Format Converters ====================

def sanitize_bibtex_key(text: str) -> str:
    """生成 BibTeX 安全的 citation key"""
    if not text:
        return "unknown"
    # 取第一个单词，移除特殊字符
    key = re.sub(r'[^a-zA-Z0-9]', '', text.split()[0].lower())
    return key[:20] if key else "unknown"


def extract_year(paper: dict) -> str:
    """从论文数据中提取年份"""
    # 尝试从 created_at 获取
    created_at = paper.get("created_at")
    if created_at:
        if isinstance(created_at, str):
            try:
                return created_at[:4]
            except:
                pass
        elif isinstance(created_at, datetime):
            return str(created_at.year)
    
    # 尝试从 arxiv_id 提取 (格式如 2401.12345)
    arxiv_id = paper.get("arxiv_id", "")
    if arxiv_id and len(arxiv_id) >= 4:
        year_prefix = arxiv_id[:2]
        try:
            year = int(year_prefix)
            if year >= 90:
                return f"19{year_prefix}"
            else:
                return f"20{year_prefix}"
        except:
            pass
    
    return str(datetime.now().year)


def extract_authors(paper: dict) -> List[str]:
    """从论文数据中提取作者列表"""
    # 优先使用 authors 字段
    authors = paper.get("authors")
    if authors:
        if isinstance(authors, list):
            return authors
        elif isinstance(authors, str):
            # 可能是逗号分隔的字符串
            return [a.strip() for a in authors.split(",") if a.strip()]
    
    # 尝试从 title 中提取 (作为最后手段)
    return []


def to_bibtex(paper: dict) -> str:
    """
    转换为 BibTeX 格式
    
    @article{key,
      title     = {Title},
      author    = {Author1 and Author2},
      year      = {2024},
      doi       = {10.1234/example},
      note      = {arXiv:2401.12345}
    }
    """
    title = paper.get("title") or paper.get("filename", "Untitled")
    authors = extract_authors(paper)
    year = extract_year(paper)
    doi = paper.get("doi", "")
    arxiv_id = paper.get("arxiv_id", "")
    
    # 生成 citation key: 第一作者姓 + 年份 + 标题首词
    first_author = authors[0].split()[-1] if authors else "unknown"
    title_word = sanitize_bibtex_key(title)
    key = f"{sanitize_bibtex_key(first_author)}{year}{title_word}"
    
    # 构建 BibTeX 条目
    lines = [f"@article{{{key},"]
    lines.append(f"  title     = {{{title}}},")
    
    if authors:
        author_str = " and ".join(authors)
        lines.append(f"  author    = {{{author_str}}},")
    
    lines.append(f"  year      = {{{year}}},")
    
    if doi:
        lines.append(f"  doi       = {{{doi}}},")
    
    if arxiv_id:
        lines.append(f"  note      = {{arXiv:{arxiv_id}}},")
    
    # 移除最后一个逗号
    lines[-1] = lines[-1].rstrip(",")
    lines.append("}")
    
    return "\n".join(lines)


def to_ris(paper: dict) -> str:
    """
    转换为 RIS 格式 (EndNote/RefWorks)
    
    TY  - JOUR
    TI  - Title
    AU  - Author1
    AU  - Author2
    PY  - 2024
    DO  - 10.1234/example
    ER  - 
    """
    title = paper.get("title") or paper.get("filename", "Untitled")
    authors = extract_authors(paper)
    year = extract_year(paper)
    doi = paper.get("doi", "")
    arxiv_id = paper.get("arxiv_id", "")
    
    lines = ["TY  - JOUR"]
    lines.append(f"TI  - {title}")
    
    for author in authors:
        lines.append(f"AU  - {author}")
    
    lines.append(f"PY  - {year}")
    
    if doi:
        lines.append(f"DO  - {doi}")
    
    if arxiv_id:
        lines.append(f"M1  - arXiv:{arxiv_id}")
    
    lines.append("ER  - ")
    
    return "\n".join(lines)


def to_plain_text(paper: dict) -> str:
    """
    转换为纯文本格式
    
    Author1, Author2. (2024). Title. DOI: 10.1234/example
    """
    title = paper.get("title") or paper.get("filename", "Untitled")
    authors = extract_authors(paper)
    year = extract_year(paper)
    doi = paper.get("doi", "")
    arxiv_id = paper.get("arxiv_id", "")
    
    # 构建作者字符串
    if authors:
        if len(authors) == 1:
            author_str = authors[0]
        elif len(authors) == 2:
            author_str = f"{authors[0]} & {authors[1]}"
        else:
            author_str = f"{authors[0]} et al."
    else:
        author_str = "Unknown Author"
    
    # 构建引用字符串
    citation = f"{author_str}. ({year}). {title}."
    
    if doi:
        citation += f" DOI: {doi}"
    elif arxiv_id:
        citation += f" arXiv:{arxiv_id}"
    
    return citation


# ==================== API Endpoints ====================

@router.post("/export/citations")
async def export_citations(
    request: ExportCitationRequest,
    current_user: User = Depends(get_current_user),
):
    """
    批量导出论文引用
    
    支持格式:
    - bibtex: BibTeX 格式 (.bib)
    - ris: RIS 格式 (.ris)
    - plain: 纯文本格式 (.txt)
    """
    if not request.paper_ids:
        raise HTTPException(status_code=400, detail="请选择至少一篇论文")
    
    # 验证格式
    format_lower = request.format.lower()
    if format_lower not in ["bibtex", "ris", "plain"]:
        raise HTTPException(status_code=400, detail="不支持的格式，请使用 bibtex, ris 或 plain")
    
    # 获取论文数据
    papers = []
    for paper_id in request.paper_ids:
        paper = store.get(paper_id)
        if paper:
            # 验证用户权限
            if paper.get("user_id") == current_user.id or current_user.is_admin:
                papers.append(paper)
    
    if not papers:
        raise HTTPException(status_code=404, detail="未找到可导出的论文")
    
    # 根据格式转换
    if format_lower == "bibtex":
        content = "\n\n".join([to_bibtex(p) for p in papers])
        filename = "citations.bib"
        media_type = "application/x-bibtex"
    elif format_lower == "ris":
        content = "\n\n".join([to_ris(p) for p in papers])
        filename = "citations.ris"
        media_type = "application/x-research-info-systems"
    else:  # plain
        content = "\n\n".join([to_plain_text(p) for p in papers])
        filename = "citations.txt"
        media_type = "text/plain"
    
    # 返回文件下载
    return Response(
        content=content.encode("utf-8"),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )
