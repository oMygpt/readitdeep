#!/bin/bash

# Read it DEEP - 停止脚本
# 停止前端和后端开发服务器

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}🛑 Stopping Read it DEEP...${NC}"

# 从 PID 文件读取并终止进程
if [ -f .pids ]; then
    while read pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "  Stopping PID: $pid"
            kill "$pid" 2>/dev/null || true
        fi
    done < .pids
    rm -f .pids
fi

# 额外清理: 查找并终止可能残留的进程
# 后端 (uvicorn)
pkill -f "uvicorn app.main:app" 2>/dev/null || true

# 前端 (vite)
pkill -f "vite" 2>/dev/null || true

echo -e "${GREEN}✅ 服务已停止${NC}"
