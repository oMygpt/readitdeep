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
    
    # 数据库升级 → 导入旧 JSON 存储（仅首次）→ 恢复重启前中断的任务
    if os.getenv("RID_AUTO_MIGRATE", "1") != "0":
        import asyncio
        from app.core.data_import import import_json_if_needed, recover_stuck
        from app.core.migrations import upgrade_database
        from app.core.store import store

        mode = await asyncio.to_thread(upgrade_database, store.engine)
        print(f"✅ 数据库已是最新结构 ({mode})")
        report = await asyncio.to_thread(import_json_if_needed)
        if report:
            print(f"📦 已导入旧 JSON 存储: 论文 {report['papers']['total']} 篇, 工作台 {report['workbench']['total']} 条")
        await asyncio.to_thread(recover_stuck)
        from app.core.token_tracker import import_legacy_stats

        await asyncio.to_thread(import_legacy_stats)

    # 后台任务 worker（解析 / 分析 / 翻译）；RID_WORKER=0 时本进程不执行任务
    from app.core import jobs

    if os.getenv("RID_WORKER", "1") != "0":
        jobs.worker = jobs.Worker()
        jobs.worker.start()

    # 关联模式：每 60 秒按游标向主站拉取事件（主站目前只提供拉取，撤销与删号经此生效）
    pull_task = None
    if settings.rid_mode == "linked":
        import asyncio as _asyncio

        from app.services.paperdaily import events as pd_events

        async def _pull_loop():
            while True:
                try:
                    await pd_events.pull_once()
                except Exception as e:
                    print(f"⚠️  PaperDaily 事件对账失败: {e}")
                await _asyncio.sleep(60)

        pull_task = _asyncio.create_task(_pull_loop())
    
    yield

    if jobs.worker is not None:
        await jobs.worker.stop()
    if pull_task is not None:
        pull_task.cancel()
    print(f"👋 {settings.app_name} shutting down...")


INSECURE_SECRET_KEYS = {"", "change-me-in-production", "your-super-secret-key-change-in-production"}


def check_security_settings(settings) -> None:
    """拒绝用默认/过短的 SECRET_KEY 启动（JWT 与文件签名都依赖它）。DEBUG=true 时只警告。"""
    if settings.secret_key in INSECURE_SECRET_KEYS or len(settings.secret_key) < 16:
        message = (
            "SECRET_KEY 未设置或仍为默认值，任何人都能伪造登录凭证。"
            "请在 .env 中设置至少 16 位的随机值，例如: openssl rand -hex 32"
        )
        if settings.debug:
            print(f"⚠️  {message}")
        else:
            raise RuntimeError(message)

    if settings.rid_mode == "linked":
        missing = [name for name, value in (
            ("PAPERDAILY_CLIENT_SECRET", settings.paperdaily_client_secret),
            ("PAPERDAILY_TOKEN_KEYS", settings.paperdaily_token_keys),
        ) if not value]
        if not settings.public_base_url.startswith("https://") and not settings.debug:
            missing.append("PUBLIC_BASE_URL（必须是 https）")
        if missing:
            raise RuntimeError("RID_MODE=linked 需要配置: " + ", ".join(missing))
        from app.services.paperdaily.crypto import _keys

        _keys()  # 密钥格式错误时启动即失败


def create_app() -> FastAPI:
    """创建 FastAPI 应用"""
    settings = get_settings()
    check_security_settings(settings)
    
    # 确保上传目录存在 (在挂载 StaticFiles 之前)
    ensure_upload_dirs(settings.storage_path)
    
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
        # 鉴权走 Authorization 头而不是 Cookie；通配来源时不允许携带凭证
        allow_credentials="*" not in settings.cors_origins_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # 上传目录不再静态公开；图片经签名路由 /api/v1/files/images/... 访问
    
    # API 路由
    app.include_router(api_v1_router, prefix="/api/v1")
    from app.api.paperdaily_auth import router as paperdaily_auth_router

    app.include_router(paperdaily_auth_router, prefix="/api/auth/paperdaily", tags=["PaperDaily Auth"])
    
    @app.get("/health")
    async def health_check():
        """健康检查"""
        return {"status": "healthy", "app": settings.app_name}
    
    return app


app = create_app()

