#!/bin/bash
# =============================================================================
# Read it DEEP - Docker 一键启动脚本 (GHCR 版)
# =============================================================================
# 使用 GitHub Container Registry 预构建镜像，无需本地构建
#
# 用法:
#   ./docker-start.sh                    # 默认端口 (Frontend: 3000, Backend: 8080)
#   ./docker-start.sh 8000               # 自定义前端端口
#   ./docker-start.sh 8000 9000          # 自定义前后端端口
#   ./docker-start.sh 8000 9000 v1.0.0   # 指定镜像标签
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 固定仓库地址
GHCR_REPO="ghcr.io/omygpt/readitdeep"

# 解析参数
FRONTEND_PORT=${1:-3000}
BACKEND_PORT=${2:-8080}
IMAGE_TAG=${3:-latest}
REDIS_PORT=6379

echo -e "${BLUE}🐳 Read it DEEP - Docker 部署 (GHCR)${NC}"
echo ""
echo "  镜像仓库: ${GHCR_REPO}"
echo "  镜像标签: ${IMAGE_TAG}"
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
    if [ -f ".env.docker.example" ]; then
        echo -e "${YELLOW}⚠️  未找到 .env 文件，正在从 .env.docker.example 复制...${NC}"
        cp .env.docker.example .env
        echo -e "${YELLOW}   请编辑 .env 文件配置必要的 API Keys${NC}"
    else
        echo -e "${YELLOW}⚠️  未找到 .env 文件，请创建配置文件${NC}"
    fi
fi

# 创建持久化数据目录
echo -e "${GREEN}▶ 创建数据目录...${NC}"
mkdir -p readit_data/{db,uploads,redis,logs}

# 设置目录权限 (确保容器内可写)
chmod -R 755 readit_data

# 迁移现有数据 (如果存在)
if [ -d "backend/data" ] && [ ! -f "readit_data/db/readitdeep.db" ]; then
    echo -e "${YELLOW}▶ 检测到现有数据，正在迁移...${NC}"
    
    # 迁移数据库文件
    [ -f "backend/data/readitdeep.db" ] && cp backend/data/readitdeep.db readit_data/db/
    [ -f "backend/data/papers.json" ] && cp backend/data/papers.json readit_data/db/
    [ -f "backend/data/workbench.json" ] && cp backend/data/workbench.json readit_data/db/
    [ -f "backend/data/token_stats.json" ] && cp backend/data/token_stats.json readit_data/db/
    
    # 迁移用户上传
    if [ -d "backend/data/uploads" ]; then
        cp -r backend/data/uploads/* readit_data/uploads/ 2>/dev/null || true
    fi
    
    echo -e "${GREEN}   数据迁移完成${NC}"
fi

# 设置环境变量
export FRONTEND_PORT
export BACKEND_PORT
export REDIS_PORT
export IMAGE_TAG

# 拉取最新镜像
echo -e "${GREEN}▶ 拉取镜像...${NC}"
echo "   - ${GHCR_REPO}-backend:${IMAGE_TAG}"
echo "   - ${GHCR_REPO}-frontend:${IMAGE_TAG}"
docker compose -f docker-compose.ghcr.yml pull

# 启动 Docker Compose
echo -e "${GREEN}▶ 启动 Docker 容器...${NC}"
docker compose -f docker-compose.ghcr.yml up -d

# 等待服务启动
echo ""
echo -e "${GREEN}⏳ 等待服务就绪...${NC}"
sleep 5

# 检查服务状态
if docker compose -f docker-compose.ghcr.yml ps | grep -q "running"; then
    echo ""
    echo -e "${GREEN}✅ Read it DEEP 已启动!${NC}"
    echo ""
    echo "  📖 Frontend: http://localhost:$FRONTEND_PORT"
    echo "  🔧 Backend:  http://localhost:$BACKEND_PORT"
    echo "  📚 API Docs: http://localhost:$BACKEND_PORT/docs"
    echo ""
    echo "  📁 数据目录: ./readit_data/"
    echo "     ├── db/       数据库和配置"
    echo "     ├── uploads/  用户上传文件"
    echo "     ├── redis/    Redis 数据"
    echo "     └── logs/     分析日志"
    echo ""
    echo "  🐳 镜像来源: ${GHCR_REPO}-*:${IMAGE_TAG}"
    echo ""
    echo "使用 ./docker-stop.sh 停止服务"
    echo "使用 docker compose -f docker-compose.ghcr.yml logs -f 查看日志"
else
    echo -e "${YELLOW}⚠️  部分服务可能未正常启动，请检查日志:${NC}"
    docker compose -f docker-compose.ghcr.yml logs --tail=50
fi
