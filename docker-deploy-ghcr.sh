#!/bin/bash
# =============================================================================
# Read it DEEP - GHCR 部署脚本
# =============================================================================
# 使用 GitHub Container Registry 的预构建镜像快速部署
#
# 用法:
#   ./docker-deploy-ghcr.sh [IMAGE_TAG]
#
# 示例:
#   ./docker-deploy-ghcr.sh          # 使用 latest 标签
#   ./docker-deploy-ghcr.sh v1.0.0   # 使用指定版本标签
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 固定仓库地址
GHCR_REPO="ghcr.io/omygpt/readitdeep"
IMAGE_TAG=${1:-latest}

echo -e "${BLUE}🐳 Read it DEEP - GHCR 镜像部署${NC}"
echo ""
echo "  镜像仓库: ${GHCR_REPO}"
echo "  镜像标签: ${IMAGE_TAG}"
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
    if [ -f ".env.docker.example" ]; then
        echo -e "${YELLOW}⚠️  未找到 .env 文件，正在从模板复制...${NC}"
        cp .env.docker.example .env
        echo -e "${YELLOW}   请编辑 .env 文件配置必要的 API Keys${NC}"
    fi
fi

# 创建数据目录
echo -e "${GREEN}▶ 创建数据目录...${NC}"
mkdir -p readit_data/{db,uploads,redis,logs}

# 设置环境变量
export IMAGE_TAG

# 拉取镜像
echo -e "${GREEN}▶ 拉取镜像...${NC}"
echo "   - ${GHCR_REPO}-backend:${IMAGE_TAG}"
echo "   - ${GHCR_REPO}-frontend:${IMAGE_TAG}"
docker compose -f docker-compose.ghcr.yml pull

# 启动服务
echo -e "${GREEN}▶ 启动服务...${NC}"
docker compose -f docker-compose.ghcr.yml up -d

echo ""
echo -e "${GREEN}✅ Read it DEEP 已启动!${NC}"
echo ""
echo "  📖 Frontend: http://localhost:${FRONTEND_PORT:-3000}"
echo "  🔧 Backend:  http://localhost:${BACKEND_PORT:-8080}"
echo "  📚 API Docs: http://localhost:${BACKEND_PORT:-8080}/docs"
echo ""
echo "  镜像来源: ${GHCR_REPO}-*:${IMAGE_TAG}"
echo ""
echo "停止服务: docker compose -f docker-compose.ghcr.yml down"
echo "查看日志: docker compose -f docker-compose.ghcr.yml logs -f"
