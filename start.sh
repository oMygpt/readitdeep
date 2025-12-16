#!/bin/bash

# Read it DEEP - 启动脚本
# 启动前端和后端开发服务器
# 使用 uv 作为后端包管理器

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Read it DEEP...${NC}"

# 创建必要目录
mkdir -p uploads/papers uploads/images

# 检查是否已有进程在运行
if [ -f .pids ]; then
    echo "⚠️  服务可能已在运行，先停止..."
    ./stop.sh 2>/dev/null || true
fi

# 检查 uv 是否安装
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}📦 Installing uv...${NC}"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 启动后端
echo -e "${GREEN}▶ Starting Backend (FastAPI + uv)...${NC}"
cd backend

# 使用 uv 同步依赖 (自动创建虚拟环境)
echo "  Syncing dependencies with uv..."
# uv sync 2>/dev/null || uv pip install -e . 2>/dev/null || true

# 启动 uvicorn (使用 uv run)
# 使用 --no-sync 跳过网络检查
uv run --no-sync uvicorn app.main:app --reload --host 0.0.0.0 --port 8080 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"

cd ..

# 启动前端
echo -e "${GREEN}▶ Starting Frontend (Vite)...${NC}"
cd frontend

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo "  Installing npm dependencies..."
    npm install
fi

# 启动 vite dev server
npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"

cd ..

# 保存 PID
echo "$BACKEND_PID" > .pids
echo "$FRONTEND_PID" >> .pids

echo ""
echo -e "${GREEN}✅ Read it DEEP 已启动!${NC}"
echo ""
echo "  📖 Frontend: http://localhost:5173"
echo "  🔧 Backend:  http://localhost:8080"
echo "  📚 API Docs: http://localhost:8080/docs"
echo ""
echo "使用 ./stop.sh 停止服务"
echo ""

# 等待任意进程结束
wait
