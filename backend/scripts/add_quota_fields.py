"""
数据库迁移脚本 - 添加会员配额字段

运行方式:
    cd backend && python -m scripts.add_quota_fields
"""

import asyncio
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.exc import OperationalError


async def migrate():
    """执行数据库迁移"""
    from app.core.database import engine, async_session_maker, init_db
    from app.models.user import User
    from app.models.invitation_code import InvitationCode
    
    print("""
╔═══════════════════════════════════════════════════════════╗
║     Read it DEEP - 会员配额字段迁移                        ║
╚═══════════════════════════════════════════════════════════╝
""")
    
    # 1. 创建新表 (invitation_codes)
    print("📦 创建新表...")
    await init_db()
    print("   ✅ invitation_codes 表已创建")
    
    # 2. 添加 User 表新字段 (SQLite 需要逐个添加)
    print("\n📝 添加 User 表新字段...")
    
    new_columns = [
        ("plan", "VARCHAR(20) DEFAULT 'free'"),
        ("plan_expires_at", "DATETIME"),
        ("daily_papers_used", "INTEGER DEFAULT 0"),
        ("daily_ai_used", "INTEGER DEFAULT 0"),
        ("last_daily_reset", "DATETIME"),
        ("monthly_papers_used", "INTEGER DEFAULT 0"),
        ("last_monthly_reset", "DATETIME"),
        ("invited_by", "VARCHAR(36)"),
        ("invitation_count", "INTEGER DEFAULT 0"),
    ]
    
    async with async_session_maker() as db:
        for col_name, col_def in new_columns:
            try:
                await db.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}"))
                await db.commit()
                print(f"   ✅ 添加字段: {col_name}")
            except OperationalError as e:
                if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                    print(f"   ⏭️  字段已存在: {col_name}")
                else:
                    print(f"   ⚠️  添加字段失败 {col_name}: {e}")
    
    # 3. 设置现有用户为 free 计划
    print("\n👥 更新现有用户...")
    async with async_session_maker() as db:
        result = await db.execute(text("UPDATE users SET plan = 'free' WHERE plan IS NULL"))
        await db.commit()
        print(f"   ✅ 已将 {result.rowcount} 个用户设置为 free 计划")
    
    print("\n✅ 迁移完成!")
    print("""
下一步:
1. 重启后端服务
2. 测试配额 API: GET /api/v1/quota/status
3. 测试邀请码功能
""")


if __name__ == "__main__":
    asyncio.run(migrate())
