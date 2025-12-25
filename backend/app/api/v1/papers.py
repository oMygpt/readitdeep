"""
Read it DEEP - Papers API
处理论文上传和解析
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends, status
from pydantic import BaseModel
from sqlalchemy import select

from app.config import get_settings
from app.core.store import store
from app.core.database import async_session_maker
from app.models.user import User
from app.models.paper import Paper
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


async def sync_paper_to_db(paper_id: str, updates: dict):
    """
    同步论文状态到数据库 (用于团队分享功能)
    
    只同步 Paper 模型已定义的字段
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Paper 模型包含的字段
    valid_fields = {
        'filename', 'file_path', 'title', 'category', 'authors', 
        'abstract', 'doi', 'arxiv_id', 'markdown_content', 
        'translated_content', 'status', 'error_message'
    }
    
    try:
        async with async_session_maker() as db:
            result = await db.execute(select(Paper).where(Paper.id == paper_id))
            db_paper = result.scalar_one_or_none()
            if db_paper:
                for key, value in updates.items():
                    if key in valid_fields and hasattr(db_paper, key):
                        setattr(db_paper, key, value)
                await db.commit()
    except Exception as e:
        logger.warning(f"Failed to sync paper {paper_id} to DB: {e}")


async def check_paper_access(paper_id: str, paper: dict, current_user: Optional[User]) -> None:
    """
    检查用户是否有权限访问论文
    
    允许访问的情况：
    1. 论文无 user_id (公开论文)
    2. 是论文所有者
    3. 是管理员
    4. 是论文所分享团队的成员
    
    如果无权访问，抛出 HTTPException
    """
    if not paper.get("user_id"):
        return  # 公开论文，允许访问
    
    if not current_user:
        raise HTTPException(401, "请先登录")
    
    is_owner = paper["user_id"] == current_user.id
    is_admin = current_user.is_admin
    
    if is_owner or is_admin:
        return  # 所有者或管理员，允许访问
    
    # 检查是否为团队成员 (通过 paper_shares 表)
    from app.models.team import PaperShare, TeamMember
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(PaperShare)
            .join(TeamMember, PaperShare.team_id == TeamMember.team_id)
            .where(
                PaperShare.paper_id == paper_id,
                TeamMember.user_id == current_user.id
            )
        )
        has_team_access = result.scalar_one_or_none() is not None
    
    if not has_team_access:
        raise HTTPException(403, "无权访问此论文")


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
    from app.services.classification import suggest_tags
    from app.services.workbench_analysis import analyze_method, analyze_asset, analyze_summary

    # 获取配置
    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
        
    settings = get_settings()
    logger = logging.getLogger(__name__)

    # 辅助更新函数 (同时更新 store 和 DB)
    import asyncio
    
    def update_paper(updates: dict):
        paper = store.get(paper_id)
        if paper:
            paper.update(updates)
            paper["updated_at"] = datetime.utcnow()
            store.set(paper_id, paper)
            # 异步同步到数据库 (用于团队分享)
            asyncio.create_task(sync_paper_to_db(paper_id, updates))

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
                    # 兼容新模板结构: paper_type, methods[], hypotheses_or_goals[]
                    if "methods" in analysis_data and isinstance(analysis_data["methods"], list) and len(analysis_data["methods"]) > 0:
                        first_method = analysis_data["methods"][0]
                        core_idea = first_method.get("description", "")
                        paper_type = analysis_data.get("paper_type", "")
                        if paper_type and core_idea:
                            core_idea = f"[{paper_type}] {core_idea}"
                        elif paper_type:
                            core_idea = paper_type
                    else:
                        # 兼容旧格式
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
                
                # Summary Analysis (v1.1.0) - 此处覆盖 Method 中提取的简短 summary
                res_summary = await analyze_summary(
                    text=markdown_content[:8000],
                    paper_id=paper_id,
                    paper_title=filename
                )
                if res_summary.get("success"):
                    update_paper({"summary": res_summary.get("summary")})
                
                update_paper({"status": "analyzed"})
            except Exception as e:
                 logger.error(f"Analysis failed: {e}")
        
        await do_analysis()
        
        # 5. Classification
        update_paper({"status": "classifying"})
        
        # v1.1.0: suggest_tags now returns category + tags from LLM directly
        from app.services.classification import suggest_tags
        
        await suggest_tags(paper_id)  # category is saved inside this function

        # Finalize
        update_paper({"status": "completed"})
        
        # ================== 更新用户配额使用量 ==================
        if user_id:
            try:
                async with async_session_maker() as db:
                    result = await db.execute(select(User).where(User.id == user_id))
                    user = result.scalar_one_or_none()
                    if user:
                        user.increment_paper_usage()
                        await db.commit()
                        logger.info(f"Paper {paper_id}: Updated quota for user {user_id}")
            except Exception as quota_err:
                logger.error(f"Failed to update user quota: {quota_err}")

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
    
    # 鉴权检查
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
        )
    
    # ================== 配额检查 ==================
    # 重置每日/每月配额（如果需要）
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one_or_none()
        if user:
            daily_reset = user.reset_daily_quota_if_needed()
            monthly_reset = user.reset_monthly_quota_if_needed()
            if daily_reset or monthly_reset:
                await db.commit()
            
            # 检查配额
            if not user.can_parse_paper:
                quota_status = user.get_quota_status()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "quota_exceeded",
                        "message": "论文解析配额已用完，请升级或等待配额重置",
                        "quota": quota_status,
                    }
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
    
    # 同步到数据库 (用于团队分享功能)
    async with async_session_maker() as db:
        db_paper = Paper(
            id=paper_id,
            user_id=current_user.id if current_user else None,
            filename=file.filename,
            file_path=file_path,
            status="uploading",
        )
        db.add(db_paper)
        await db.commit()
    
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
    
    # 权限检查 (包括团队成员权限)
    await check_paper_access(paper_id, paper, current_user)
    
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


class UpdateTagsRequest(BaseModel):
    tags: list[str]


@router.put("/{paper_id}/tags")
async def update_paper_tags(
    paper_id: str,
    request: UpdateTagsRequest,
    current_user: User = Depends(get_current_user),
):
    """更新论文标签"""
    import json
    
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 只有论文所有者可以修改标签
    if paper.get("user_id") != current_user.id:
        raise HTTPException(403, "只能修改自己的论文标签")
    
    # 更新 store
    tags_json = json.dumps(request.tags)
    store.update(paper_id, {"tags": tags_json})
    
    # 同步到数据库
    await sync_paper_to_db(paper_id, {"tags": tags_json})
    
    return {"message": "标签已更新", "tags": request.tags}


@router.get("/{paper_id}/content")
async def get_paper_content(
    paper_id: str,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """获取论文内容 (Markdown)"""
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")

    # 权限检查 (包括团队成员权限)
    await check_paper_access(paper_id, paper, current_user)

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

    # 权限检查 (包括团队成员权限)
    await check_paper_access(paper_id, paper, current_user)

    # 获取论文内容用于定位
    markdown_content = paper.get("markdown_content", "")
    content_lines = markdown_content.split('\n') if markdown_content else []
    
    def find_text_location(text_snippet: str, prefer_url: str = None) -> dict:
        """在论文内容中查找文本片段的位置"""
        if not text_snippet or not content_lines:
            return {"start_line": 0, "end_line": 0, "text_snippet": text_snippet or ""}
        
        snippet_clean = text_snippet.strip()[:100]  # 取前100字符
        
        # 如果有 URL，优先搜索包含 URL 的行
        if prefer_url:
            url_pattern = prefer_url.replace("https://", "").replace("http://", "")[:30]
            for i, line in enumerate(content_lines):
                if url_pattern in line:
                    return {
                        "start_line": i + 1,
                        "end_line": min(i + 3, len(content_lines)),
                        "text_snippet": snippet_clean
                    }
        
        # 搜索时跳过前10行（通常是标题/作者信息）
        skip_first_n = 10
        
        # 尝试在正文中查找（跳过标题行）
        for i, line in enumerate(content_lines):
            # 跳过标题行（以 # 开头）
            if line.strip().startswith('#'):
                continue
            # 跳过前几行（避免匹配到标题区域）
            if i < skip_first_n:
                continue
            # 模糊匹配
            if snippet_clean[:30] in line:
                return {
                    "start_line": i + 1,
                    "end_line": min(i + 3, len(content_lines)),
                    "text_snippet": snippet_clean
                }
        
        # 宽松匹配（小写+去除空格），同样跳过头部
        snippet_normalized = snippet_clean.replace(" ", "").lower()[:30]
        for i, line in enumerate(content_lines):
            if line.strip().startswith('#') or i < skip_first_n:
                continue
            line_normalized = line.replace(" ", "").lower()
            if snippet_normalized in line_normalized:
                return {
                    "start_line": i + 1,
                    "end_line": min(i + 3, len(content_lines)),
                    "text_snippet": snippet_clean
                }
        
        # 最后尝试全文搜索（包括头部）
        for i, line in enumerate(content_lines):
            if snippet_clean[:20] in line and not line.strip().startswith('#'):
                return {
                    "start_line": i + 1,
                    "end_line": min(i + 3, len(content_lines)),
                    "text_snippet": snippet_clean
                }
        
        return {"start_line": 0, "end_line": 0, "text_snippet": snippet_clean}

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
        asset = data.get("asset", {})
        
        # 根据类型获取不同的定位文本
        item_type = item.get("type")
        analysis = data.get("analysis", {})
        asset = data.get("asset", {})
        
        if item_type == "method":
            # 方法：从 analysis 获取 text_snippet
            loc_text = (
                analysis.get("text_snippet") or  # LLM 返回的原文片段
                analysis.get("method_name") or  # 方法名称
                title
            )
            resource_url = None
        else:
            # 资产（数据集/代码）：从 asset 获取
            loc_text = (
                asset.get("text_snippet") or  # LLM 返回的原文片段
                asset.get("name") or  # 资源名称
                data.get("location") or
                title
            )
            resource_url = asset.get("url")
        
        # 实际在内容中查找位置
        location = find_text_location(loc_text, prefer_url=resource_url)
        
        if item_type == "method":
            methods.append({
                "name": title,
                "description": desc,
                "location": location
            })
        elif item_type == "dataset":
             datasets.append({
                "name": title,
                "description": desc,
                "usage": asset.get("usage_in_paper", ""),
                "location": location,
                "url": asset.get("url")
             })
        elif item_type == "code":
             code_refs.append({
                "description": desc,
                "repo_url": asset.get("url"),
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
    from app.services.workbench_analysis import analyze_method, analyze_asset, analyze_summary
    from app.services.classification import suggest_tags

    logger = logging.getLogger(__name__)
    
    # helper (同步到 store 和 DB)
    import asyncio
    def update_paper(updates: dict):
        p = store.get(paper_id)
        if p:
            p.update(updates)
            store.set(paper_id, p)
            asyncio.create_task(sync_paper_to_db(paper_id, updates))

    paper = store.get(paper_id)
    if not paper: return
    
    update_paper({"status": "analyzing"})
    logger.info(f"Re-running analysis for {paper_id}")
    
    # 同步更新 analysis.status 以便前端轮询能感知到状态变化
    paper_data = store.get(paper_id)
    if paper_data:
        analysis_data = paper_data.get("analysis") or {}
        analysis_data["status"] = "analyzing"
        analysis_data["started_at"] = datetime.utcnow().isoformat()
        update_paper({"analysis": analysis_data})
    
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
            # 兼容新模板结构: paper_type, methods[], hypotheses_or_goals[]
            # 旧模板结构: core_idea, description
            if "methods" in analysis_data and isinstance(analysis_data["methods"], list) and len(analysis_data["methods"]) > 0:
                first_method = analysis_data["methods"][0]
                core_idea = first_method.get("description", "")
                paper_type = analysis_data.get("paper_type", "")
                if paper_type and core_idea:
                    core_idea = f"[{paper_type}] {core_idea}"
                elif paper_type:
                    core_idea = paper_type
            else:
                # 兼容旧格式
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

        # 4. Summary Analysis (v1.1.0)
        res_summary = await analyze_summary(
            text=markdown_content[:8000],
            paper_id=paper_id,
            paper_title=paper.get("filename", "Untitled")
        )
        if res_summary.get("success"):
            update_paper({"summary": res_summary.get("summary")})
        
        update_paper({"status": "analyzed"})
        
        # 同步更新 analysis.status
        paper_data = store.get(paper_id)
        if paper_data:
            analysis_data = paper_data.get("analysis") or {}
            analysis_data["status"] = "completed"
            analysis_data["completed_at"] = datetime.utcnow().isoformat()
            # 同时也把 summary 存入 analysis (可选)
            if res_summary.get("success"):
                analysis_data["summary"] = res_summary.get("summary")
            update_paper({"analysis": analysis_data})
        
        # 4. Classification - v1.1.0: category is now handled inside suggest_tags
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
    """
    手动触发分析
    
    - 如果论文已有内容，只重新运行分析流程
    - 如果论文没有内容（解析失败），重新解析 PDF
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 权限检查
    if paper.get("user_id") != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作此论文")
    
    # 检查是否有内容
    if paper.get("markdown_content"):
        # 有内容，只重新分析
        background_tasks.add_task(run_analysis_pipeline, paper_id, current_user.id)
        return {"status": "triggered", "message": "分析任务已启动"}
    else:
        # 没有内容，需要重新解析 PDF
        file_path = paper.get("file_path")
        if not file_path:
            raise HTTPException(400, "找不到原始文件路径")
        
        import os
        if not os.path.exists(file_path):
            raise HTTPException(400, "原始文件已删除，无法重新解析")
        
        # 读取文件内容
        with open(file_path, "rb") as f:
            file_content = f.read()
        
        # 重新解析
        background_tasks.add_task(
            parse_paper_task,
            paper_id,
            file_path,
            file_content,
            paper.get("filename", "unknown.pdf"),
            current_user.id
        )
        return {"status": "triggered", "message": "PDF 重新解析任务已启动"}


# ==================== Reference Analysis ====================

class ReferenceAnalysisResponse(BaseModel):
    """引用分析响应"""
    paper_id: str
    references: list[dict]
    ai_summary: str
    status: str
    error: Optional[str] = None


@router.post("/{paper_id}/references/analyze", response_model=ReferenceAnalysisResponse)
async def analyze_paper_references(
    paper_id: str,
    limit: int = 5,
    current_user: User = Depends(get_current_user),
):
    """
    用户触发的引用论文分析
    
    - 调用 OpenAlex 获取该论文引用的 top N 论文
    - LLM 生成"相关工作总结"
    - 结果缓存在 store 中
    
    Args:
        paper_id: 论文 ID
        limit: 获取的引用数量 (默认 5，最大 10)
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 权限检查
    if paper.get("user_id") != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权访问此论文")
    
    # 限制数量
    limit = min(limit, 10)
    
    from app.services.reference_analysis import analyze_references
    
    result = await analyze_references(paper_id, limit=limit)
    
    return ReferenceAnalysisResponse(
        paper_id=result.paper_id,
        references=result.references,
        ai_summary=result.ai_summary,
        status=result.status,
        error=result.error
    )


@router.get("/{paper_id}/references/analysis")
async def get_paper_reference_analysis(
    paper_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    获取已缓存的引用分析结果
    
    如果没有缓存，返回 null
    """
    paper = store.get(paper_id)
    if not paper:
        raise HTTPException(404, "论文不存在")
    
    # 权限检查
    if paper.get("user_id") != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权访问此论文")
    
    from app.services.reference_analysis import get_cached_reference_analysis
    
    cached = get_cached_reference_analysis(paper_id)
    if cached:
        return {
            "paper_id": paper_id,
            "references": cached.get("references", []),
            "ai_summary": cached.get("ai_summary", ""),
            "status": cached.get("status", "completed"),
            "cached": True
        }
    
    return {"paper_id": paper_id, "cached": False, "message": "未找到缓存的分析结果"}
