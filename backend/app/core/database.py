"""
Read it DEEP - 数据库配置

支持:
- SQLite (本地开发): sqlite+aiosqlite:///data/readitdeep.db
- PostgreSQL (生产环境): postgresql+asyncpg://...
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import create_engine

from app.config import get_settings

settings = get_settings()


def get_database_url() -> tuple[str, dict]:
    """获取数据库 URL 和连接参数"""
    db_url = settings.database_url
    connect_args = {}
    
    # SQLite 配置
    if db_url.startswith("sqlite") and ":///" in db_url:
        # 显式路径 (测试 / 自定义位置): sqlite:///path 或 sqlite+aiosqlite:///path
        if not db_url.startswith("sqlite+aiosqlite"):
            db_url = db_url.replace("sqlite", "sqlite+aiosqlite", 1)
        connect_args = {"check_same_thread": False}

    elif db_url.startswith("sqlite"):
        # 确保数据目录存在
        data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
        os.makedirs(data_dir, exist_ok=True)
        
        db_path = os.path.join(data_dir, "readitdeep.db")
        db_url = f"sqlite+aiosqlite:///{db_path}"
        connect_args = {"check_same_thread": False}
        print(f"📦 使用 SQLite 数据库: {db_path}")
    
    # PostgreSQL 配置
    elif db_url.startswith("postgres"):
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        # 会话时区固定为 UTC：代码写入的不带时区时间（utcnow）按 UTC 解释
        connect_args = {"server_settings": {"timezone": "UTC"}}
        print(f"📦 使用 PostgreSQL 数据库")
    
    return db_url, connect_args


# 获取配置
DATABASE_URL, CONNECT_ARGS = get_database_url()

# 创建异步引擎
engine = create_async_engine(
    DATABASE_URL,
    echo=settings.debug,
    connect_args=CONNECT_ARGS,
    pool_pre_ping=True if "postgresql" in DATABASE_URL else False,
)

# 会话工厂
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """声明式基类"""
    pass


async def get_db() -> AsyncSession:
    """获取数据库会话 (FastAPI 依赖注入)"""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


def sync_database_url() -> str:
    """同步驱动的连接串（store / Alembic 使用）：aiosqlite → sqlite，asyncpg → psycopg。"""
    url = DATABASE_URL
    if url.startswith("sqlite+aiosqlite"):
        return url.replace("sqlite+aiosqlite", "sqlite", 1)
    if url.startswith("postgresql+asyncpg"):
        return url.replace("postgresql+asyncpg", "postgresql+psycopg", 1)
    return url


def import_all_models() -> None:
    """注册全部模型到 Base.metadata（建表、迁移、一致性校验都依赖完整的元数据）。"""
    import app.models  # noqa: F401
    from app.models.system_config import SystemConfig  # noqa: F401
    from app.models.user_config import UserConfig  # noqa: F401
    from app.models.prompt import PromptVersion  # noqa: F401


async def init_db() -> None:
    """创建全部表（测试与本地快速启动用；正式部署走 Alembic，见 app/core/migrations.py）"""
    import_all_models()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
