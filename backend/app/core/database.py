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
    if db_url.startswith("sqlite"):
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


async def init_db() -> None:
    """初始化数据库 (创建表)"""
    # 导入所有模型以确保它们被注册
    from app.models.user import User  # noqa
    from app.models.system_config import SystemConfig  # noqa
    from app.models.user_config import UserConfig  # noqa
    from app.models.team import Team, TeamMember, TeamInvitation, PaperShare  # noqa
    from app.models.share_link import ShareLink  # noqa
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✅ 数据库表已创建")


