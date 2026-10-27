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

# Install Poetry
RUN pip install poetry

# Copy dependency files
COPY pyproject.toml ./

# Install dependencies
RUN poetry config virtualenvs.create false \
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
