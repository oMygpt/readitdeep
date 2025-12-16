
# 测试数据库连接
import sys
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.config import get_settings

async def test_connection():
    settings = get_settings()
    url = settings.database_url
    print(f"Testing connection to: {url.split('@')[1] if '@' in url else 'Invalid URL'}")
    
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    # 尝试不同配置
    configs = [
        {"name": "Standard", "opts": {}},
        {"name": "Asyncpg Driver Fix", "opts": {}}, # Will be handled by URL fix
        {"name": "No Verify SSL", "opts": {"connect_args": {"ssl": ctx}}},
    ]
    
    # URL 修正逻辑
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    for conf in configs:
        print(f"\nTrying config: {conf['name']}")
        try:
            engine = create_async_engine(url, **conf['opts'])
            async with engine.connect() as conn:
                result = await conn.execute(text("SELECT 1"))
                print(f"✅ Success! Result: {result.scalar()}")
            await engine.dispose()
            return
        except Exception as e:
            print(f"❌ Failed: {e}")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        
    try:
        asyncio.run(test_connection())
    except KeyboardInterrupt:
        pass
