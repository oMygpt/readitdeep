"""
Read it DEEP - 数据库迁移脚本

将 VARCHAR(36) ID 字段迁移到 UUID 类型 (PostgreSQL)

使用方法:
    python scripts/migrate_to_uuid.py

注意: 
- 此脚本仅适用于 PostgreSQL
- SQLite 不支持 UUID 类型，会自动跳过
- 请在执行前备份数据库
"""

import asyncio
import os
import sys

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings


async def migrate_to_uuid():
    """执行 UUID 迁移"""
    settings = get_settings()
    db_url = settings.database_url
    
    # 检查数据库类型
    if db_url.startswith("sqlite"):
        print("ℹ️  SQLite 数据库无需迁移 (SQLAlchemy Uuid 类型在 SQLite 上自动使用字符串)")
        return
    
    # PostgreSQL
    if not db_url.startswith("postgres"):
        print(f"⚠️  不支持的数据库类型: {db_url[:20]}...")
        return
    
    # 转换为 asyncpg URL
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    print("🔄 开始 PostgreSQL UUID 迁移...")
    print("=" * 50)
    
    engine = create_async_engine(db_url, echo=True)
    
    async with engine.begin() as conn:
        # 检查哪些表需要迁移
        migrations = []
        
        # 1. 检查 users 表
        result = await conn.execute(text("""
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'id'
        """))
        row = result.fetchone()
        if row and row[0] == 'character varying':
            migrations.append(('users', 'id', None))
            print("📋 users.id 需要迁移")
        
        # 2. 检查 papers 表
        result = await conn.execute(text("""
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'papers' AND column_name = 'id'
        """))
        row = result.fetchone()
        if row and row[0] == 'character varying':
            migrations.append(('papers', 'id', None))
            migrations.append(('papers', 'user_id', 'users'))
            print("📋 papers.id, papers.user_id 需要迁移")
        
        # 3. 检查 paper_analysis 表是否存在
        result = await conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'paper_analysis'
            )
        """))
        table_exists = result.scalar()
        
        if table_exists:
            result = await conn.execute(text("""
                SELECT data_type FROM information_schema.columns 
                WHERE table_name = 'paper_analysis' AND column_name = 'id'
            """))
            row = result.fetchone()
            if row and row[0] == 'character varying':
                migrations.append(('paper_analysis', 'id', None))
                migrations.append(('paper_analysis', 'paper_id', 'papers'))
                print("📋 paper_analysis.id, paper_analysis.paper_id 需要迁移")
        
        # 4. 检查 user_configs 表
        result = await conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'user_configs'
            )
        """))
        table_exists = result.scalar()
        
        if table_exists:
            result = await conn.execute(text("""
                SELECT data_type FROM information_schema.columns 
                WHERE table_name = 'user_configs' AND column_name = 'user_id'
            """))
            row = result.fetchone()
            if row and row[0] == 'character varying':
                migrations.append(('user_configs', 'user_id', 'users'))
                print("📋 user_configs.user_id 需要迁移")
        
        if not migrations:
            print("✅ 所有表已经是 UUID 类型，无需迁移")
            return
        
        print("\n" + "=" * 50)
        print("🔧 开始执行迁移...")
        print("=" * 50)
        
        # 按照外键依赖顺序迁移
        # 1. 先迁移主表 (users)
        for table, column, fk_ref in migrations:
            if table == 'users' and column == 'id':
                print(f"\n🔄 迁移 {table}.{column}...")
                await conn.execute(text(f"""
                    ALTER TABLE {table} 
                    ALTER COLUMN {column} TYPE uuid USING {column}::uuid
                """))
                print(f"✅ {table}.{column} 迁移完成")
        
        # 2. 迁移 papers 表 (依赖 users)
        for table, column, fk_ref in migrations:
            if table == 'papers':
                print(f"\n🔄 迁移 {table}.{column}...")
                if fk_ref:
                    # 先删除外键约束
                    await conn.execute(text(f"""
                        ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_{column}_fkey
                    """))
                
                await conn.execute(text(f"""
                    ALTER TABLE {table} 
                    ALTER COLUMN {column} TYPE uuid USING {column}::uuid
                """))
                
                if fk_ref:
                    # 重新添加外键约束
                    await conn.execute(text(f"""
                        ALTER TABLE {table} 
                        ADD CONSTRAINT {table}_{column}_fkey 
                        FOREIGN KEY ({column}) REFERENCES {fk_ref}(id) ON DELETE CASCADE
                    """))
                
                print(f"✅ {table}.{column} 迁移完成")
        
        # 3. 迁移其他依赖表 (paper_analysis, user_configs)
        for table, column, fk_ref in migrations:
            if table not in ('users', 'papers'):
                print(f"\n🔄 迁移 {table}.{column}...")
                if fk_ref:
                    await conn.execute(text(f"""
                        ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_{column}_fkey
                    """))
                
                await conn.execute(text(f"""
                    ALTER TABLE {table} 
                    ALTER COLUMN {column} TYPE uuid USING {column}::uuid
                """))
                
                if fk_ref:
                    await conn.execute(text(f"""
                        ALTER TABLE {table} 
                        ADD CONSTRAINT {table}_{column}_fkey 
                        FOREIGN KEY ({column}) REFERENCES {fk_ref}(id) ON DELETE CASCADE
                    """))
                
                print(f"✅ {table}.{column} 迁移完成")
        
        print("\n" + "=" * 50)
        print("✅ 所有迁移完成!")
        print("=" * 50)
    
    await engine.dispose()


if __name__ == "__main__":
    print("""
╔═══════════════════════════════════════════════════════════╗
║     Read it DEEP - UUID 数据库迁移工具                      ║
╠═══════════════════════════════════════════════════════════╣
║  将 VARCHAR(36) ID 字段转换为 PostgreSQL UUID 类型          ║
║  ⚠️  请确保已备份数据库!                                    ║
╚═══════════════════════════════════════════════════════════╝
""")
    
    # 确认执行
    confirm = input("是否继续执行迁移? (输入 'yes' 确认): ")
    if confirm.lower() != 'yes':
        print("❌ 迁移已取消")
        sys.exit(0)
    
    asyncio.run(migrate_to_uuid())
