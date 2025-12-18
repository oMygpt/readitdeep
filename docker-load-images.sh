#!/bin/bash
# =============================================================================
# Read it DEEP - Docker 镜像加载脚本
# =============================================================================
# 用于在新服务器上加载预构建的镜像，无需重新构建
#
# 用法:
#   1. 将 docker-images/ 目录上传到目标服务器
#   2. 运行此脚本加载镜像
#   3. 运行 ./docker-start.sh 启动服务
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🐳 Read it DEEP - 加载 Docker 镜像${NC}"
echo ""

# 检查镜像目录
if [ ! -d "docker-images" ]; then
    echo -e "${YELLOW}❌ 未找到 docker-images/ 目录${NC}"
    echo "   请确保以下文件存在:"
    echo "   - docker-images/backend.tar.gz"
    echo "   - docker-images/frontend.tar.gz"
    echo "   - docker-images/redis.tar.gz"
    exit 1
fi

# 加载镜像
echo -e "${GREEN}▶ 加载 Backend 镜像...${NC}"
gunzip -c docker-images/backend.tar.gz | docker load

echo -e "${GREEN}▶ 加载 Frontend 镜像...${NC}"
gunzip -c docker-images/frontend.tar.gz | docker load

echo -e "${GREEN}▶ 加载 Redis 镜像...${NC}"
gunzip -c docker-images/redis.tar.gz | docker load

echo ""
echo -e "${GREEN}✅ 镜像加载完成!${NC}"
echo ""
echo "已加载的镜像:"
docker images | grep -E "readitdeep_antigravity|redis"
echo ""
echo "使用 ./docker-start.sh 启动服务"
