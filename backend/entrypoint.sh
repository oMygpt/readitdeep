#!/bin/bash
# Read it DEEP - Docker 入口脚本
# 先运行数据库迁移，再启动服务器

set -e

echo "=== Read it DEEP Backend 启动 ==="

# 运行数据库迁移
echo "🔄 检查数据库迁移..."
python scripts/migrate_db.py

# 启动服务器
echo "🚀 启动 API 服务..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
