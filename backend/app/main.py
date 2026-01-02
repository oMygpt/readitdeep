"""
Read it DEEP - FastAPI 应用入口

Copyright (C) 2025 CHUNLIN@Readit DEEP

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.api.v1 import router as api_v1_router


def ensure_upload_dirs(storage_path: str) -> Path:
    """确保上传目录存在，返回绝对路径"""
    # 转换为绝对路径
    if not os.path.isabs(storage_path):
        # 相对于项目根目录
        base_dir = Path(__file__).parent.parent
        storage_path = str(base_dir / storage_path)
    
    path = Path(storage_path)
    path.mkdir(parents=True, exist_ok=True)
    (path / "papers").mkdir(exist_ok=True)
    (path / "images").mkdir(exist_ok=True)
    
    return path


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """应用生命周期管理"""
    settings = get_settings()
    print(f"🚀 {settings.app_name} starting...")
    
    # 初始化数据库表
    from app.core.database import init_db
    await init_db()
    
    yield
    
    print(f"👋 {settings.app_name} shutting down...")


def create_app() -> FastAPI:
    """创建 FastAPI 应用"""
    settings = get_settings()
    
    # 确保上传目录存在 (在挂载 StaticFiles 之前)
    upload_path = ensure_upload_dirs(settings.storage_path)
    
    app = FastAPI(
        title=settings.app_name,
        description="AI 驱动的深度阅读与知识资产管理平台",
        version="0.1.0",
        lifespan=lifespan,
    )
    
    # CORS 中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # 挂载静态文件 (上传的图片等)
    app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")
    
    # API 路由
    app.include_router(api_v1_router, prefix="/api/v1")
    
    @app.get("/health")
    async def health_check():
        """健康检查"""
        return {"status": "healthy", "app": settings.app_name}
    
    return app


app = create_app()

