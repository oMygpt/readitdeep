"""
数据库迁移脚本 - 添加提示词管理相关表

运行方式:
    cd backend && python -m scripts.add_prompt_tables
"""

import asyncio
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
from sqlalchemy import text
from sqlalchemy.exc import OperationalError


async def migrate():
    """执行数据库迁移"""
    from app.core.database import engine, async_session_maker, init_db
    from app.models.prompt import PromptVersion, PromptActiveVersion, PromptHistory
    from app.agents.prompt_loader import discover_prompts, PROMPTS_DIR
    
    print("""
╔═══════════════════════════════════════════════════════════╗
║     Read it DEEP - 提示词管理表迁移                         ║
╚═══════════════════════════════════════════════════════════╝
""")
    
    # 1. 创建表
    print("📦 创建提示词管理表...")
    await init_db()
    print("   ✅ 表结构已创建/更新")
    
    # 2. 检查并添加缺失字段
    print("\n🔧 检查表结构...")
    
    # 针对 SQLite 的字段检查
    async with engine.begin() as conn:
        # 检查 prompt_versions 表是否存在
        try:
            result = await conn.execute(text("SELECT 1 FROM prompt_versions LIMIT 1"))
            print("   ✅ prompt_versions 表已存在")
        except OperationalError:
            print("   ⚠️  prompt_versions 表不存在，将自动创建")
        
        # 检查 prompt_active_versions 表
        try:
            result = await conn.execute(text("SELECT 1 FROM prompt_active_versions LIMIT 1"))
            print("   ✅ prompt_active_versions 表已存在")
        except OperationalError:
            print("   ⚠️  prompt_active_versions 表不存在，将自动创建")
        
        # 检查 prompt_history 表
        try:
            result = await conn.execute(text("SELECT 1 FROM prompt_history LIMIT 1"))
            print("   ✅ prompt_history 表已存在")
        except OperationalError:
            print("   ⚠️  prompt_history 表不存在，将自动创建")
    
    # 3. 从 md 文件导入现有提示词
    print("\n📥 导入现有提示词文件...")
    
    prompts = discover_prompts(PROMPTS_DIR)
    imported_count = 0
    
    async with async_session_maker() as db:
        for prompt_type, versions in prompts.items():
            for prompt_file in versions:
                # 检查是否已存在
                result = await db.execute(
                    text("""
                        SELECT 1 FROM prompt_versions 
                        WHERE prompt_type = :prompt_type AND version = :version
                    """),
                    {"prompt_type": prompt_type, "version": prompt_file.version}
                )
                
                if result.fetchone():
                    print(f"   ⏭️  {prompt_type}/{prompt_file.version} 已存在，跳过")
                    continue
                
                # 插入新记录
                import uuid
                await db.execute(
                    text("""
                        INSERT INTO prompt_versions 
                        (id, prompt_type, version, description, system_prompt, user_prompt_template, file_path, created_at, updated_at)
                        VALUES (:id, :prompt_type, :version, :description, :system_prompt, :user_prompt_template, :file_path, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """),
                    {
                        "id": str(uuid.uuid4()),
                        "prompt_type": prompt_type,
                        "version": prompt_file.version,
                        "description": prompt_file.description,
                        "system_prompt": prompt_file.system_prompt,
                        "user_prompt_template": prompt_file.user_prompt_template,
                        "file_path": prompt_file.file_path,
                    }
                )
                imported_count += 1
                print(f"   ✅ 导入 {prompt_type}/{prompt_file.version}")
        
        await db.commit()
    
    print(f"\n   共导入 {imported_count} 个提示词版本")
    
    # 4. 设置默认活跃版本 (每个类型的最新版本)
    print("\n🎯 设置默认活跃版本...")
    
    async with async_session_maker() as db:
        for prompt_type, versions in prompts.items():
            if not versions:
                continue
            
            # 获取最新版本
            latest_version = versions[-1].version
            
            # 检查是否已设置
            result = await db.execute(
                text("SELECT version FROM prompt_active_versions WHERE prompt_type = :prompt_type"),
                {"prompt_type": prompt_type}
            )
            existing = result.fetchone()
            
            if existing:
                print(f"   ⏭️  {prompt_type} 已设置活跃版本: {existing[0]}")
                continue
            
            # 插入活跃版本记录
            await db.execute(
                text("""
                    INSERT INTO prompt_active_versions (prompt_type, version, updated_at)
                    VALUES (:prompt_type, :version, CURRENT_TIMESTAMP)
                """),
                {"prompt_type": prompt_type, "version": latest_version}
            )
            print(f"   ✅ {prompt_type} -> {latest_version}")
        
        await db.commit()
    
    print("\n✅ 迁移完成!")
    print("""
下一步:
1. 重启后端服务
2. 访问管理页面测试提示词管理功能
""")


if __name__ == "__main__":
    asyncio.run(migrate())
