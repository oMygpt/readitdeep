#!/bin/bash
# =============================================================================
# Read it DEEP - Docker 停止脚本
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🛑 停止 Read it DEEP Docker 服务...${NC}"

# 停止所有容器
docker compose down

echo ""
echo -e "${GREEN}✅ 服务已停止${NC}"
echo ""
echo "  📁 数据已保留在 ./readit_data/ 目录"
echo ""
echo "  重新启动: ./docker-start.sh"
echo "  完全清理: docker compose down -v (⚠️ 会删除 Redis 数据)"
