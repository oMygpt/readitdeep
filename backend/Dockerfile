# Backend Dockerfile
# =============================================================================
# GHCR 替代方案 (可选):
#   FROM cgr.dev/chainguard/python:latest-dev
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# APT_MIRROR（可选）：Debian 镜像主机名，如 mirrors.ustc.edu.cn；为空时用官方源
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# PIP_INDEX_URL（可选）：PyPI 镜像，如 https://pypi.tuna.tsinghua.edu.cn/simple；为空时用官方 PyPI。
# pip 直接读这个环境变量；poetry 通过在构建副本的 pyproject 里加一个主源来使用它
ARG PIP_INDEX_URL=
ENV PIP_DEFAULT_TIMEOUT=60

# Install Poetry
RUN pip install --retries 5 poetry

# Copy dependency files
COPY pyproject.toml ./

# Install dependencies
RUN poetry config virtualenvs.create false \
    && if [ -n "$PIP_INDEX_URL" ]; then poetry source add --priority=primary mirror "$PIP_INDEX_URL"; fi \
    && poetry install --no-interaction --no-ansi --no-root

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p uploads/papers uploads/images

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Expose port
EXPOSE 8080

# Run the application with migration
CMD ["./entrypoint.sh"]
