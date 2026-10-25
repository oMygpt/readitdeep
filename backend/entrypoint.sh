#!/bin/bash
# Read it DEEP - Docker 入口脚本
# 先运行数据库迁移，再启动服务器

set -e

echo "=== Read it DEEP Backend 启动 ==="

# 数据库升级、旧 JSON 数据导入在应用启动时自动完成（app/main.py lifespan）

# 启动服务器
echo "🚀 启动 API 服务..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
