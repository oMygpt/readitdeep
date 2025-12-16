"""
Read it DEEP - 数据库配置 (Supabase / PostgreSQL)
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from app.config import get_settings

settings = get_settings()

# 创建异步引擎
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    db_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={
        "server_settings": {
            "timezone": "UTC",
        },
        # "ssl": "require", # asyncpg 默认通常会处理 SSL
    }
)

# 会话工厂
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# 基础模型类
Base = declarative_base()


async def get_db() -> AsyncSession:
    """获取数据库会话 (FastAPI 依赖注入)"""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """初始化数据库 (创建表)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
