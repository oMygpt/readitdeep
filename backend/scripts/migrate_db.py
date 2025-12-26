#!/usr/bin/env python3
"""
Read it DEEP - 数据库迁移脚本

自动检测并添加缺失的列：
- papers.tags (TEXT) - 用户标签

使用方法:
  python scripts/migrate_db.py

该脚本会自动检测数据库类型 (SQLite/PostgreSQL) 并执行相应的迁移。
"""

import os
import sys
import sqlite3

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate_sqlite(db_path: str) -> None:
    """SQLite 数据库迁移"""
    print(f"📦 正在迁移 SQLite 数据库: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 获取 papers 表的列信息
    cursor.execute("PRAGMA table_info(papers)")
    columns = {row[1] for row in cursor.fetchall()}
    
    migrations_done = []
    
    # 检查并添加 tags 列
    if "tags" not in columns:
        try:
            cursor.execute("ALTER TABLE papers ADD COLUMN tags TEXT")
            migrations_done.append("papers.tags")
            print("  ✅ 添加 papers.tags 列")
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e).lower():
                print(f"  ⚠️  添加 papers.tags 失败: {e}")
    else:
        print("  ℹ️  papers.tags 列已存在")
    
    conn.commit()
    conn.close()
    
    if migrations_done:
        print(f"\n✅ 迁移完成，更新了 {len(migrations_done)} 个列: {', '.join(migrations_done)}")
    else:
        print("\n✅ 数据库已是最新状态，无需迁移")


def migrate_postgresql(database_url: str) -> None:
    """PostgreSQL 数据库迁移"""
    try:
        import psycopg2
    except ImportError:
        print("⚠️  需要安装 psycopg2: pip install psycopg2-binary")
        return
    
    print("📦 正在迁移 PostgreSQL 数据库")
    
    # 从 async URL 转换为 sync URL
    sync_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    sync_url = sync_url.replace("postgres://", "postgresql://")
    
    conn = psycopg2.connect(sync_url)
    cursor = conn.cursor()
    
    migrations_done = []
    
    # 检查 papers.tags 列是否存在
    cursor.execute("""
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'papers' AND column_name = 'tags'
    """)
    
    if not cursor.fetchone():
        try:
            cursor.execute("ALTER TABLE papers ADD COLUMN tags TEXT")
            migrations_done.append("papers.tags")
            print("  ✅ 添加 papers.tags 列")
        except Exception as e:
            print(f"  ⚠️  添加 papers.tags 失败: {e}")
    else:
        print("  ℹ️  papers.tags 列已存在")
    
    conn.commit()
    conn.close()
    
    if migrations_done:
        print(f"\n✅ 迁移完成，更新了 {len(migrations_done)} 个列: {', '.join(migrations_done)}")
    else:
        print("\n✅ 数据库已是最新状态，无需迁移")


def main():
    """主函数"""
    print("=" * 50)
    print("Read it DEEP - 数据库迁移")
    print("=" * 50)
    
    # 读取环境变量
    database_url = os.environ.get("DATABASE_URL", "sqlite")
    
    if database_url == "sqlite" or database_url.startswith("sqlite"):
        # SQLite 数据库路径
        data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
        db_path = os.path.join(data_dir, "readitdeep.db")
        
        # 检查 Docker 挂载路径
        docker_path = "/app/data/readitdeep.db"
        if os.path.exists(docker_path):
            db_path = docker_path
        
        if os.path.exists(db_path):
            migrate_sqlite(db_path)
        else:
            print(f"⚠️  数据库文件不存在: {db_path}")
            print("   将在首次启动时自动创建")
    
    elif database_url.startswith("postgres"):
        migrate_postgresql(database_url)
    
    else:
        print(f"⚠️  不支持的数据库类型: {database_url}")


if __name__ == "__main__":
    main()
