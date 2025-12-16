"""
Read it DEEP - Papers API
处理论文上传和解析
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel

from app.config import get_settings
from app.core.store import store
from app.models.user import User
from app.api.v1.auth import get_current_user, get_optional_user


router = APIRouter()


class PaperUploadResponse(BaseModel):
    """上传响应"""
    id: str
    filename: str
    status: str
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
    created_at: datetime
    updated_at: datetime
    user_id: Optional[str] = None
    error_message: Optional[str] = None


async def parse_paper_task(paper_id: str, file_path: str, file_content: bytes, filename: str, user_id: Optional[str] = None):
    """
    后台任务: 使用 Mineru API 解析论文
    
    增强流程:
    1. Mineru 解析
    2. 提取 DOI/ArXiv ID
    3. 生成 Embedding
    4. 触发 AI 分析
    """
    import os
    import re
    import logging
    from datetime import datetime
    from app.core.config_manager import ConfigManager
    from app.core.database import async_session_maker
    from app.config import get_settings
    from app.services.mineru import MineruService
    from app.services.embedding import EmbeddingService
    from app.services.classification import suggest_tags
    from app.services.workbench_analysis import analyze_method, analyze_asset

    # 获取配置
    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
        
    settings = get_settings()
    logger = logging.getLogger(__name__)

    # 辅助更新函数
    def update_paper(updates: dict):
        paper = store.get(paper_id)
        if paper:
            paper.update(updates)
            paper["updated_at"] = datetime.utcnow()
            store.set(paper_id, paper)

    try:
        if not config.get("mineru_api_key"):
            logger.error(f"Paper {paper_id}: MINERU_API_KEY not configured for user {user_id}")
            update_paper({"status": "failed", "error_message": "Mineru API Key missing in Config"})
            return

        # 1. Start Parsing
        update_paper({"status": "parsing"})
        logger.info(f"Starting parsing for {paper_id} with Mineru (User Config)")

        mineru_service = MineruService(api_key=config.get("mineru_api_key"))
        
        # Parse
        result = await mineru_service.parse_file(
            filename=filename,
            file_content=file_content,
            data_id=paper_id
        )

        if not result.success:
            update_paper({"status": "failed", "error_message": result.error})
            return
        
        # 2. Indexing / Processing
        update_paper({"status": "indexing"})
        markdown_content = result.markdown_content
        
        # Handle Images
        image_mapping = {}
        if result.images:
            images_dir = f"{settings.storage_path}/images/{paper_id}"
            os.makedirs(images_dir, exist_ok=True)
            
            for img_name, img_bytes in result.images.items():
                # 安全文件名
                safe_name = os.path.basename(img_name)
                # Ensure validation
                if not safe_name or safe_name in ['.', '..']: continue
                
                img_path = f"{images_dir}/{safe_name}"
                with open(img_path, 'wb') as f:
                    f.write(img_bytes)
                
                new_url = f"/uploads/images/{paper_id}/{safe_name}"
                image_mapping[img_name] = new_url
        
        # Replace Image Links in Markdown
        for original_path, new_url in image_mapping.items():
            # Standard markdown image syntax: ![alt](path)
            # Mineru might return paths like "image_0.jpg"
            # We replace (path) with (new_url)
            markdown_content = markdown_content.replace(f"({original_path})", f"({new_url})")
            if not original_path.startswith("./"):
                markdown_content = markdown_content.replace(f"(./{original_path})", f"({new_url})")

        # Extract Title
        title = None
        title_match = re.search(r'^#\s+(.+)$', markdown_content, re.MULTILINE)
        if title_match:
            title = title_match.group(1).strip()
        else:
            title = os.path.splitext(filename)[0]

        # Extract DOI/ArXiv (Simple Regex for now, kept inline or moved to utils)
        def extract_arxiv(text, fname):
            m = re.search(r'(?:arXiv:)?(\d{4}\.\d{4,5})', fname)
            if m: return m.group(1)
            m = re.search(r'arXiv:(\d{4}\.\d{4,5})', text)
            if m: return m.group(1)
            return None
            
        arxiv_id = extract_arxiv(markdown_content, filename)
        
        # Update Paper with Content
        update_paper({
            "status": "completed",
            "title": title,
            "markdown_content": markdown_content,
            "arxiv_id": arxiv_id,
            "error_message": None # Clear previous errors
        })
        
        # 3. Embedding
        async def do_embedding():
            try:
                embedding_service = EmbeddingService(
                    provider=config.get("embedding_provider", "local"),
                    base_url=config.get("embedding_base_url"),
                    api_key=config.get("embedding_api_key"),
                    model=config.get("embedding_model")
                )
                
                snippet = markdown_content[:8000]
                vector = await embedding_service.embed_single(snippet)
                if vector:
                    store.get(paper_id)["embedding"] = vector
                    update_paper({"status": "embedding_done"})
                await embedding_service.close()
            except Exception as e:
                logger.error(f"Embedding failed: {e}")

        await do_embedding()

        # 4. Deep Analysis (Method + Asset)
        update_paper({"status": "analyzing"})
        async def do_analysis():
            try:
                # Method Analysis
                res_method = await analyze_method(
                    text=markdown_content[:3000],  # Analyze first 3000 chars
                    paper_id=paper_id,
                    paper_title=filename
                )
                
                # Save Summary from Method Analysis if available
                if res_method.get("success"):
                    analysis_data = res_method.get("analysis", {})
                    core_idea = analysis_data.get("core_idea") or analysis_data.get("description")
                    if core_idea:
                        update_paper({"summary": core_idea})

                # Structure Analysis
                structure = {"sections": []}
                # Parse markdown headers
                lines = markdown_content.split('\n')
                for idx, line in enumerate(lines):
                    header_match = re.match(r'^(#+)\s+(.+)$', line)
                    if header_match:
                        level = len(header_match.group(1))
                        title = header_match.group(2).strip()
                        structure["sections"].append({
                            "title": title,
                            "level": level,
                            "start_line": idx + 1
                        })
                
                update_paper({"structure": structure})

                # Asset Analysis
                await analyze_asset(
                    text=markdown_content, 
                    paper_id=paper_id, 
                    paper_title=filename
                )
                
                update_paper({"status": "analyzed"})
            except Exception as e:
                 logger.error(f"Analysis failed: {e}")
        
        await do_analysis()
        
        # 5. Classification
        update_paper({"status": "classifying"})
        
        tags = await suggest_tags(paper_id)
        
        # 自动设置 category 为第一个 tag（置信度最高）
        if tags:
            paper = store.get(paper_id)
            if paper and not paper.get("category"):
                top_tag = tags[0].name if hasattr(tags[0], 'name') else str(tags[0])
                update_paper({"category": top_tag})

        # Finalize
        update_paper({"status": "completed"})

    except Exception as e:
        update_paper({
            "status": "failed",
            "error_message": str(e)
        })


@router.post("/upload", response_model=PaperUploadResponse)
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """
    上传论文文件
    """
    # 验证文件类型
    if not file.filename.lower().endswith(('.pdf', '.docx', '.tex')):
        raise HTTPException(400, "仅支持 .pdf, .docx, .tex 文件")
    
    # 鉴权：如果是强制登录模式，这里可以检查 current_user
    # 目前允许未登录上传，但未登录用户无法在 Library 看到（除非是公共库）
    # 建议：如果没有 current_user，拒绝上传，或者标记为匿名
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
        )

    # 1. 生成 ID
    paper_id = str(uuid.uuid4())
    
    # 2. 保存文件 (本地)
    import os
    upload_dir = "data/uploads"
    if current_user:
        # 按用户隔离存储
        upload_dir = f"data/uploads/{current_user.id}"
    
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, f"{paper_id}_{file.filename}")
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # 3. 记录元数据
    paper_data = {
        "id": paper_id,
        "filename": file.filename,
        "file_path": file_path,
        "status": "uploading",
        "created_at": datetime.now(),
        "updated_at": datetime.now(),
        "user_id": current_user.id if current_user else None
    }
    store.set(paper_id, paper_data)
    
    # 4. 启动后台解析任务
    background_tasks.add_task(
        parse_paper_task, 
        paper_id, 
        file_path, 
        content,
        file.filename,
        current_user.id if current_user else None
    )
    
    return PaperUploadResponse(
        id=paper_id,
        filename=file.filename,
        status="uploading",
        message="上传成功，开始解析",
        created_at=paper_data["created_at"]
    )


@router.get("/{paper_id}", response_model=PaperDetail)
async def get_paper(
    paper_id: str,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """获取论文详情"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 权限检查
    if paper.get("user_id"):
        # 属于某个用户，必须登录且是本人或管理员
        if not current_user:
             raise HTTPException(401, "请先登录")
        if paper["user_id"] != current_user.id and not current_user.is_admin:
             raise HTTPException(403, "无权访问此论文")
    
    return PaperDetail(
        id=paper["id"],
        filename=paper["filename"],
        title=paper.get("title"),
        category=paper.get("category"),
        status=paper.get("status", "unknown"),
        markdown_content=paper.get("markdown_content"),
        translated_content=paper.get("translated_content"),
        created_at=paper.get("created_at") or datetime.now(),
        updated_at=paper.get("updated_at") or datetime.now(),
        user_id=paper.get("user_id"),
        error_message=paper.get("error_message"),
    )


@router.get("/{paper_id}/content")
async def get_paper_content(
    paper_id: str,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """获取论文内容 (Markdown)"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")

    # 权限检查
    if paper.get("user_id"):
        if not current_user:
             raise HTTPException(401, "请先登录")
        if paper["user_id"] != current_user.id and not current_user.is_admin:
             raise HTTPException(403, "无权访问此论文")

    return {
        "markdown": paper.get("markdown_content", ""),
        "translated": paper.get("translated_content", "")
    }


@router.get("/{paper_id}/analysis")
async def get_paper_analysis(
    paper_id: str,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """获取论文分析结果 (聚合 Workbench 数据)"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")

    # 权限检查
    if paper.get("user_id"):
        if not current_user:
             raise HTTPException(401, "请先登录")
        if paper["user_id"] != current_user.id and not current_user.is_admin:
             raise HTTPException(403, "无权访问此论文")

    # 从 Workbench 获取数据
    from app.core.workbench_store import workbench_store
    items = workbench_store.get_items_by_paper(paper_id)
    
    methods = []
    datasets = []
    code_refs = []
    
    for item in items:
        # Avoid crash if item structure varies
        title = item.get("title", "Unknown")
        desc = item.get("description", "")
        data = item.get("data", {})
        
        # 构造 Location 对象
        loc_text = data.get("location", "")
        location = {
            "start_line": 0,
            "end_line": 0,
            "text_snippet": loc_text
        }
        
        if item.get("type") == "method":
            methods.append({
                "name": title,
                "description": desc,
                "location": location
            })
        elif item.get("type") == "dataset":
             datasets.append({
                "name": title,
                "description": desc,
                "location": location,
                "url": data.get("asset", {}).get("url")
             })
        elif item.get("type") == "code":
             code_refs.append({
                "description": desc,
                "repo_url": data.get("asset", {}).get("url"),
                "location": location
             })

    return {
        "paper_id": paper_id,
        "status": paper.get("status", "unknown"),
        "summary": paper.get("summary"), 
        "methods": methods,
        "datasets": datasets,
        "code_refs": code_refs,
        "structure": paper.get("structure"),
        "error_message": paper.get("error_message")
    }



async def run_analysis_pipeline(paper_id: str, user_id: str):
    """
    独立运行分析管道 (Reset Logic)
    """
    import re
    import logging
    from app.core.store import store
    from app.services.workbench_analysis import analyze_method, analyze_asset
    from app.services.classification import suggest_tags

    logger = logging.getLogger(__name__)
    
    # helper
    def update_paper(updates: dict):
        p = store.get(paper_id)
        if p:
            p.update(updates)
            store.set(paper_id, p)

    paper = store.get(paper_id)
    if not paper: return
    
    update_paper({"status": "analyzing"})
    logger.info(f"Re-running analysis for {paper_id}")
    
    markdown_content = paper.get("markdown_content", "")
    if not markdown_content:
        update_paper({"status": "failed", "error_message": "No content to analyze"})
        return

    try:
        # 1. Method Analysis
        res_method = await analyze_method(
            text=markdown_content[:3000],
            paper_id=paper_id,
            paper_title=paper.get("filename", "Untitled")
        )
        
        if res_method.get("success"):
            analysis_data = res_method.get("analysis", {})
            core_idea = analysis_data.get("core_idea") or analysis_data.get("description")
            if core_idea:
                update_paper({"summary": core_idea})

        # 2. Structure
        structure = {"sections": []}
        lines = markdown_content.split('\n')
        for idx, line in enumerate(lines):
            header_match = re.match(r'^(#+)\s+(.+)$', line)
            if header_match:
                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                structure["sections"].append({
                    "title": title,
                    "level": level,
                    "start_line": idx + 1
                })
        update_paper({"structure": structure})

        # 3. Assets
        await analyze_asset(
            text=markdown_content, 
            paper_id=paper_id, 
            paper_title=paper.get("filename", "Untitled")
        )
        
        update_paper({"status": "analyzed"})
        
        # 4. Classification
        await suggest_tags(paper_id)
        
        # Final
        update_paper({"status": "completed"})
        logger.info(f"Analysis re-run completed for {paper_id}")

    except Exception as e:
        logger.error(f"Re-analysis failed: {e}")
        update_paper({"status": "failed", "error_message": str(e)})


@router.post("/{paper_id}/analyze")
async def trigger_analysis_endpoint(
    paper_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """手动触发分析"""
    background_tasks.add_task(run_analysis_pipeline, paper_id, current_user.id)
    return {"status": "triggered", "message": "Analysis started in background"}
