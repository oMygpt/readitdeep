"""
Read it DEEP - Papers API
处理论文上传和解析
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.config import get_settings


router = APIRouter()


class PaperUploadResponse(BaseModel):
    """上传响应"""
    id: str
    filename: str
    status: str  # uploading, parsing, indexing, completed, failed
    message: str
    created_at: datetime


class PaperDetail(BaseModel):
    """论文详情"""
    id: str
    filename: str
    title: Optional[str] = None
    category: Optional[str] = None
    status: str
    markdown_content: Optional[str] = None
    translated_content: Optional[str] = None
    created_at: datetime
    updated_at: datetime


from app.core.store import store

# 移除 SQLAlchemy 导入
# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy import select
# from app.core.database import get_db, engine
# from app.models.paper import Paper
# from fastapi import Depends

async def parse_paper_task(paper_id: str, file_path: str, file_content: bytes, filename: str) -> None:
    """
    后台任务: 使用 Mineru API 解析论文
    
    增强流程:
    1. Mineru 解析
    2. 提取 DOI/ArXiv ID
    3. 生成 Embedding
    4. 触发 AI 分析
    """
    from app.services.mineru import get_mineru_service
    from app.services.embedding import get_embedding_service
    from app.services.analysis import run_analysis_task
    import logging
    import os
    import re
    import asyncio
    
    logger = logging.getLogger(__name__)
    settings = get_settings()
    
    # DOI/ArXiv 正则模式
    DOI_PATTERN = r'10\.\d{4,}/[^\s\)\]\"\']+' 
    ARXIV_PATTERN = r'(?:arXiv:)?(\d{4}\.\d{4,5})(?:v\d+)?'
    
    # 辅助更新函数
    def update_paper(updates: dict):
        paper = store.get(paper_id)
        if paper:
            paper.update(updates)
            paper["updated_at"] = datetime.utcnow()
            store.set(paper_id, paper)

    def extract_doi(content: str, filename: str) -> str | None:
        """从内容或文件名提取 DOI"""
        # 1. 从内容中提取
        match = re.search(DOI_PATTERN, content)
        if match:
            return match.group(0).rstrip('.')
        return None
    
    def extract_arxiv(content: str, filename: str) -> str | None:
        """从内容或文件名提取 ArXiv ID"""
        # 1. 从文件名提取 (e.g., 2106.09685.pdf)
        fn_match = re.search(ARXIV_PATTERN, filename)
        if fn_match:
            return fn_match.group(1)
        
        # 2. 从内容中提取
        content_match = re.search(r'arXiv:(\d{4}\.\d{4,5})', content)
        if content_match:
            return content_match.group(1)
        
        return None

    # 检查 API Key
    if not settings.mineru_api_key:
        logger.error(f"Paper {paper_id}: MINERU_API_KEY not configured")
        update_paper({"status": "failed", "error_message": "MINERU_API_KEY 未配置，请在 .env 中设置"})
        return
    
    mineru = get_mineru_service()
    
    try:
        # 更新状态: 解析中
        update_paper({"status": "parsing"})
        logger.info(f"Paper {paper_id}: Starting Mineru parsing for {filename}")
        
        # 调用 Mineru 解析
        result = await mineru.parse_file(
            filename=filename,
            file_content=file_content,
            data_id=paper_id,
        )
        
        if not result.success:
            update_paper({"status": "failed", "error_message": result.error})
            return
        
        # 更新状态: 索引中
        update_paper({"status": "indexing"})
        
        # 修正 Markdown 图片路径 & 提取标题
        markdown_content = result.markdown_content
        
        # 1. 保存图片并构建映射
        image_mapping = {}
        if result.images:
            images_dir = f"{settings.storage_path}/images/{paper_id}"
            os.makedirs(images_dir, exist_ok=True)
            
            for img_name, img_bytes in result.images.items():
                safe_name = os.path.basename(img_name)
                img_path = f"{images_dir}/{safe_name}"
                with open(img_path, 'wb') as f:
                    f.write(img_bytes)
                
                new_url = f"/uploads/images/{paper_id}/{safe_name}"
                image_mapping[img_name] = new_url
        
        # 2. 替换图片路径
        for original_path, new_url in image_mapping.items():
            markdown_content = markdown_content.replace(f"({original_path})", f"({new_url})")
            if not original_path.startswith("./"):
                markdown_content = markdown_content.replace(f"(./{original_path})", f"({new_url})")

        # 3. 提取标题
        title = None
        title_match = re.search(r'^#\s+(.+)$', markdown_content, re.MULTILINE)
        if title_match:
            title = title_match.group(1).strip()
        
        if not title:
            title = os.path.splitext(filename)[0]
        
        # 4. 提取 DOI/ArXiv ID (新增)
        doi = extract_doi(markdown_content, filename)
        arxiv_id = extract_arxiv(markdown_content, filename)
        
        logger.info(f"Paper {paper_id}: Extracted DOI={doi}, ArXiv={arxiv_id}")

        # 5. 更新状态: 完成基础解析
        update_paper({
            "status": "completed",
            "title": title,
            "markdown_content": markdown_content,
            "doi": doi,
            "arxiv_id": arxiv_id,
        })
        
        # 6. 生成 Embedding (异步，非阻塞)
        async def generate_embedding():
            try:
                embedding_service = get_embedding_service()
                # 截取前 8000 字符用于 embedding
                text_for_embedding = markdown_content[:8000]
                embedding = await embedding_service.embed_single(text_for_embedding)
                if embedding:
                    update_paper({"embedding": embedding})
                    logger.info(f"Paper {paper_id}: Embedding generated (dim={len(embedding)})")
            except Exception as e:
                logger.warning(f"Paper {paper_id}: Embedding generation failed: {e}")
        
        # 7. 触发 AI 分析 (异步，非阻塞)
        async def trigger_analysis():
            try:
                await run_analysis_task(paper_id)
                logger.info(f"Paper {paper_id}: AI analysis completed")
            except Exception as e:
                logger.warning(f"Paper {paper_id}: AI analysis failed: {e}")
        
        # 8. 触发智能分类 (异步，非阻塞)
        async def trigger_classification():
            try:
                from app.services.classification import suggest_tags
                await suggest_tags(paper_id)
                logger.info(f"Paper {paper_id}: Classification completed")
            except Exception as e:
                logger.warning(f"Paper {paper_id}: Classification failed: {e}")
        
        # 并行执行 embedding、AI 分析和分类
        asyncio.create_task(generate_embedding())
        asyncio.create_task(trigger_analysis())
        asyncio.create_task(trigger_classification())
        
    except Exception as e:
        logger.error(f"Task exception for {paper_id}: {str(e)}")
        update_paper({"status": "failed", "error_message": str(e)})




@router.post("/upload", response_model=PaperUploadResponse)
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> PaperUploadResponse:
    """上传论文文件"""
    settings = get_settings()
    
    allowed_types = [".pdf", ".tex", ".docx", ".doc"]
    file_ext = "." + file.filename.split(".")[-1].lower() if file.filename else ""
    if file_ext not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型。支持: {', '.join(allowed_types)}"
        )
    
    paper_id = str(uuid.uuid4())
    file_path = f"{settings.storage_path}/papers/{paper_id}{file_ext}"
    try:
        import aiofiles
        async with aiofiles.open(file_path, "wb") as f:
            content = await file.read()
            await f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")
    
    # Store
    now = datetime.utcnow()
    new_paper = {
        "id": paper_id,
        "filename": file.filename,
        "file_path": file_path,
        "status": "uploading",
        "title": None,
        "category": None,
        "markdown_content": None,
        "translated_content": None,
        "created_at": now,
        "updated_at": now,
    }
    store.set(paper_id, new_paper)
    
    background_tasks.add_task(
        parse_paper_task, 
        paper_id, 
        file_path, 
        content, 
        file.filename or "unknown.pdf"
    )
    
    return PaperUploadResponse(
        id=paper_id,
        filename=file.filename or "unknown",
        status="uploading",
        message="文件已上传，正在解析中...",
        created_at=now,
    )


@router.get("/{paper_id}", response_model=PaperDetail)
async def get_paper(paper_id: str) -> PaperDetail:
    """获取论文详情"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    return PaperDetail(**paper)


@router.get("/{paper_id}/content")
async def get_paper_content(paper_id: str) -> dict:
    """获取论文内容"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")
    
    if paper["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"论文尚未解析完成，当前状态: {paper['status']}")
    
    return {
        "id": paper_id,
        "content": paper.get("markdown_content"),
        "translated": paper.get("translated_content"),
    }
