#!/bin/bash
# =============================================================================
# Docker 一键安装脚本
# =============================================================================
# 支持系统: Ubuntu, Debian, CentOS, RHEL, Fedora, Rocky Linux, AlmaLinux
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/oMygpt/readitdeep/main/install-docker.sh | bash
#   或
#   wget -qO- https://raw.githubusercontent.com/oMygpt/readitdeep/main/install-docker.sh | bash
# =============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐳 Docker 一键安装脚本${NC}"
echo ""

# 检查是否以 root 运行
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}⚠️  请使用 sudo 运行此脚本${NC}"
    echo "   sudo bash $0"
    exit 1
fi

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        OS="centos"
    else
        echo -e "${RED}❌ 不支持的操作系统${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ 检测到系统: ${OS} ${VERSION}${NC}"
}

# 检查 Docker 是否已安装
check_docker() {
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version)
        echo -e "${GREEN}✓ Docker 已安装: ${DOCKER_VERSION}${NC}"
        
        # 检查 Docker Compose
        if docker compose version &> /dev/null; then
            COMPOSE_VERSION=$(docker compose version --short)
            echo -e "${GREEN}✓ Docker Compose 已安装: v${COMPOSE_VERSION}${NC}"
        fi
        
        read -p "是否重新安装 Docker? (y/N): " REINSTALL
        if [[ ! "$REINSTALL" =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}跳过安装${NC}"
            exit 0
        fi
    fi
}

# 卸载旧版本
remove_old_docker() {
    echo -e "${YELLOW}▶ 移除旧版本 Docker...${NC}"
    
    case $OS in
        ubuntu|debian)
            apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
            ;;
        centos|rhel|fedora|rocky|almalinux)
            yum remove -y docker docker-client docker-client-latest docker-common \
                docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true
            ;;
    esac
}

# 安装依赖
install_dependencies() {
    echo -e "${GREEN}▶ 安装依赖...${NC}"
    
    case $OS in
        ubuntu|debian)
            apt-get update
            apt-get install -y \
                ca-certificates \
                curl \
                gnupg \
                lsb-release
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y yum-utils
            ;;
        fedora)
            dnf install -y dnf-plugins-core
            ;;
    esac
}

# 添加 Docker 官方源
add_docker_repo() {
    echo -e "${GREEN}▶ 添加 Docker 官方源...${NC}"
    
    case $OS in
        ubuntu)
            mkdir -p /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
                $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
                tee /etc/apt/sources.list.d/docker.list > /dev/null
            apt-get update
            ;;
        debian)
            mkdir -p /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
                $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
                tee /etc/apt/sources.list.d/docker.list > /dev/null
            apt-get update
            ;;
        centos|rhel|rocky|almalinux)
            yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            ;;
        fedora)
            dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
            ;;
    esac
}

# 安装 Docker
install_docker() {
    echo -e "${GREEN}▶ 安装 Docker Engine...${NC}"
    
    case $OS in
        ubuntu|debian)
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        fedora)
            dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
    esac
}

# 启动 Docker 服务
start_docker() {
    echo -e "${GREEN}▶ 启动 Docker 服务...${NC}"
    systemctl start docker
    systemctl enable docker
}

# 配置用户组 (可选)
configure_user() {
    SUDO_USER=${SUDO_USER:-$USER}
    if [ "$SUDO_USER" != "root" ]; then
        echo -e "${GREEN}▶ 将用户 ${SUDO_USER} 添加到 docker 组...${NC}"
        usermod -aG docker $SUDO_USER
        echo -e "${YELLOW}   注意: 请重新登录或运行 'newgrp docker' 使组权限生效${NC}"
    fi
}

# 配置镜像加速 (中国)
configure_mirror() {
    read -p "是否配置 Docker 镜像加速? (适用于中国用户) (y/N): " CONFIGURE_MIRROR
    if [[ "$CONFIGURE_MIRROR" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}▶ 配置镜像加速...${NC}"
        mkdir -p /etc/docker
        cat > /etc/docker/daemon.json <<EOF
{
    "registry-mirrors": [
        "https://docker.1ms.run",
        "https://docker.xuanyuan.me"
    ]
}
EOF
        systemctl daemon-reload
        systemctl restart docker
        echo -e "${GREEN}✓ 镜像加速已配置${NC}"
    fi
}

# 验证安装
verify_installation() {
    echo ""
    echo -e "${GREEN}▶ 验证安装...${NC}"
    
    DOCKER_VERSION=$(docker --version)
    COMPOSE_VERSION=$(docker compose version --short)
    
    echo -e "${GREEN}✓ Docker: ${DOCKER_VERSION}${NC}"
    echo -e "${GREEN}✓ Docker Compose: v${COMPOSE_VERSION}${NC}"
    
    echo ""
    echo -e "${GREEN}▶ 运行测试容器...${NC}"
    docker run --rm hello-world 2>/dev/null | head -5
}

# 主流程
main() {
    detect_os
    check_docker
    remove_old_docker
    install_dependencies
    add_docker_repo
    install_docker
    start_docker
    configure_user
    configure_mirror
    verify_installation
    
    echo ""
    echo -e "${GREEN}✅ Docker 安装完成!${NC}"
    echo ""
    echo "  常用命令:"
    echo "    docker ps              # 查看运行中的容器"
    echo "    docker compose up -d   # 启动应用"
    echo "    docker compose down    # 停止应用"
    echo ""
    echo "  快速部署 Read it DEEP:"
    echo "    git clone https://github.com/oMygpt/readitdeep.git"
    echo "    cd readitdeep"
    echo "    ./docker-start.sh"
    echo ""
}

main "$@"
