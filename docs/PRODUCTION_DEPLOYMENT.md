# Read it DEEP - 生产环境部署指南

本文档描述如何将 Read it DEEP 从开发环境迁移到生产环境，包括 Redis、PostgreSQL (含向量扩展)、以及备选 OCR 服务的配置。

---

## 目录

1. [环境差异概述](#环境差异概述)
2. [PostgreSQL + pgvector 生产配置](#postgresql--pgvector-生产配置)
3. [Redis 生产配置](#redis-生产配置)
4. [OCR 服务 (MinerU) 配置](#ocr-服务-mineru-配置)
5. [Embedding 服务配置](#embedding-服务配置)
6. [完整生产环境变量模板](#完整生产环境变量模板)
7. [Docker Compose 生产配置](#docker-compose-生产配置)
8. [数据迁移注意事项](#数据迁移注意事项)

---

## 环境差异概述

| 组件 | 开发环境 | 生产环境 |
|------|----------|----------|
| **数据库** | SQLite (本地文件) | PostgreSQL + pgvector |
| **缓存** | 无/内存 | Redis Cluster/Sentinel |
| **OCR** | MinerU Cloud API | MinerU Cloud / 自建部署 |
| **Embedding** | 本地 vLLM (bge-m3) | 火山引擎 / 自建 vLLM |
| **文件存储** | 本地 `./uploads` | S3 / OSS / MinIO |

---

## PostgreSQL + pgvector 生产配置

### 1. 数据库要求

- **PostgreSQL 版本**: 14+ (推荐 15 或 16)
- **pgvector 扩展**: 0.5.0+ (支持 1024+ 维向量)

### 2. 安装 pgvector

```sql
-- 使用 superuser 连接数据库
CREATE EXTENSION IF NOT EXISTS vector;
```

对于云数据库:
- **Supabase**: 默认已启用 pgvector
- **AWS RDS**: 需手动启用扩展 (Aurora 原生支持)
- **阿里云 RDS**: 选择支持 pgvector 的版本

### 3. 环境变量配置

```bash
# PostgreSQL 连接 URL
# 格式: postgresql://user:password@host:port/database
DATABASE_URL=postgresql://readitdeep_user:your_secure_password@db.example.com:5432/readitdeep

# Supabase (可选, 用于 Supabase 特有功能)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

### 4. 代码适配说明

当前代码 (`backend/app/core/database.py`) 已自动处理:
- `postgres://` → `postgresql+asyncpg://` 转换
- `postgresql://` → `postgresql+asyncpg://` 转换
- 开启 `pool_pre_ping` 用于连接保活

```python
# database.py 关键逻辑
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
```

### 5. 向量存储使用

当前 embedding 存储在内存 Store 中。生产环境如需持久化，需扩展 Paper 模型:

```python
# 未来扩展: 在 Paper 模型添加 vector 字段
from pgvector.sqlalchemy import Vector

class Paper(Base):
    # ... 现有字段 ...
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1024), nullable=True)
```

---

## Redis 生产配置

### 1. 使用场景

| 功能 | 说明 |
|------|------|
| 会话缓存 | 用户登录状态 (可选) |
| 任务队列 | 后台解析任务 (当前使用 FastAPI BackgroundTasks) |
| 缓存层 | LLM 响应缓存、元数据缓存 |

### 2. 环境变量

```bash
# Redis 连接 URL
REDIS_URL=redis://readonly:password@redis.example.com:6379/0

# 带密码的格式
REDIS_URL=redis://:your_redis_password@redis.example.com:6379/0

# Redis Sentinel 格式 (高可用)
REDIS_URL=redis+sentinel://sentinel1:26379,sentinel2:26379,sentinel3:26379/mymaster/0
```

### 3. Docker Compose Redis 配置

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
    interval: 10s
    timeout: 5s
    retries: 3
```

### 4. 代码集成建议

当前项目尚未深度集成 Redis，生产环境可添加:

```python
# backend/app/core/cache.py (建议新增)
import aioredis
from app.config import get_settings

settings = get_settings()

async def get_redis():
    return await aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True
    )
```

---

## OCR 服务 (MinerU) 配置

### 1. 当前实现

项目使用 MinerU Cloud API (`https://mineru.net/api/v4`) 进行 PDF 解析。

| 配置项 | 说明 |
|--------|------|
| `MINERU_API_URL` | API 地址 (代码中硬编码为官方地址) |
| `MINERU_API_KEY` | 官网申请的 Token |

### 2. 生产环境选项

#### 选项 A: 继续使用 MinerU Cloud

```bash
MINERU_API_KEY=your_mineru_api_token
```

**注意事项**:
- 每个账号每天 2000 页最高优先级
- 单文件最大 200MB，600 页
- 国外 URL (GitHub, AWS) 可能超时

#### 选项 B: 自建 MinerU 服务

MinerU 开源了核心解析能力，可自建部署:

```bash
# 拉取 MinerU 镜像
docker pull opendatalab/mineru:latest

# 运行自建服务
docker run -d \
  --name mineru \
  -p 8765:8765 \
  --gpus all \
  opendatalab/mineru:latest
```

修改配置:
```bash
MINERU_SELF_HOSTED_URL=http://your-mineru-server:8765
```

**代码修改** (如需支持自建):

```python
# backend/app/services/mineru.py - 修改建议
class MineruService:
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        settings = get_settings()
        self.api_key = api_key or settings.mineru_api_key
        # 支持自建 URL 覆盖
        self.base_url = base_url or settings.mineru_self_hosted_url or "https://mineru.net/api/v4"
```

#### 选项 C: 备选 OCR 服务

如需替换 MinerU，可考虑以下替代方案:

| 服务 | 特点 | 部署难度 |
|------|------|----------|
| **Marker** | Meta 开源，GPU 加速 | ⭐⭐⭐ |
| **pdf2image + Tesseract** | 经典方案，无 GPU 要求 | ⭐⭐ |
| **Azure Document Intelligence** | 商业方案，高精度 | ⭐ (云服务) |
| **Google Document AI** | 商业方案 | ⭐ (云服务) |
| **Nougat** | Meta 开源，学术论文优化 | ⭐⭐⭐⭐ |

整合新 OCR 服务需实现 `OCRServiceInterface`:

```python
# backend/app/services/ocr_interface.py (建议新增)
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class OCRResult:
    markdown_content: str
    images: dict[str, bytes]
    success: bool
    error: Optional[str] = None

class OCRServiceInterface(ABC):
    @abstractmethod
    async def parse_file(self, filename: str, content: bytes) -> OCRResult:
        pass

# 然后各 OCR 服务继承实现
class MineruOCRService(OCRServiceInterface):
    ...

class MarkerOCRService(OCRServiceInterface):
    ...
```

---

## Embedding 服务配置

### 1. 当前实现

支持两种 Provider:

| Provider | 说明 |
|----------|------|
| `local` | 本地 vLLM/Ollama (OpenAI 兼容) |
| `volcengine` | 火山引擎 Ark API |

### 2. 开发环境 (本地 vLLM)

```bash
EMBEDDING_PROVIDER=local
EMBEDDING_BASE_URL=http://localhost:8000/v1
EMBEDDING_API_KEY=dummy  # 本地 vLLM 通常不需要
EMBEDDING_MODEL=bge-m3
```

### 3. 生产环境 (火山引擎)

```bash
EMBEDDING_PROVIDER=volcengine
EMBEDDING_API_KEY=your_ark_api_key
EMBEDDING_MODEL=doubao-embedding-text-240715
```

**API 端点**: `https://ark.cn-beijing.volces.com/api/v3/embeddings` (代码中硬编码)

### 4. 生产环境 (自建集群)

部署 vLLM 或 TEI (Text Embeddings Inference) 集群:

```bash
# vLLM 部署示例
docker run --gpus all \
  -p 8000:8000 \
  vllm/vllm-openai:latest \
  --model BAAI/bge-m3 \
  --served-model-name bge-m3

# 或使用 HuggingFace TEI
docker run --gpus all \
  -p 8080:80 \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-m3
```

配置:
```bash
EMBEDDING_PROVIDER=local
EMBEDDING_BASE_URL=http://embedding-cluster:8000/v1
EMBEDDING_MODEL=bge-m3
```

---

## 完整生产环境变量模板

```bash
# ==================== 应用配置 ====================
APP_NAME="Read it DEEP"
DEBUG=false
SECRET_KEY=your-super-secret-key-change-in-production
CORS_ORIGINS=https://readitdeep.com,https://www.readitdeep.com

# ==================== 数据库 ====================
DATABASE_URL=postgresql://readitdeep:password@db.example.com:5432/readitdeep_prod
# Supabase (可选)
SUPABASE_URL=
SUPABASE_ANON_KEY=

# ==================== Redis ====================
REDIS_URL=redis://:password@redis.example.com:6379/0

# ==================== LLM 配置 ====================
LLM_BASE_URL=https://your-llm-endpoint/v1
LLM_API_KEY=your_llm_api_key
LLM_MODEL=qwen2.5-72b

# ==================== 翻译 LLM ====================
TRANSLATION_BASE_URL=https://your-llm-endpoint/v1
TRANSLATION_API_KEY=your_translation_api_key
TRANSLATION_MODEL=qwen2.5-72b

# ==================== Embedding ====================
EMBEDDING_PROVIDER=volcengine
EMBEDDING_BASE_URL=  # volcengine 模式下忽略
EMBEDDING_API_KEY=your_volcengine_ark_key
EMBEDDING_MODEL=doubao-embedding-text-240715

# ==================== MinerU OCR ====================
MINERU_API_URL=https://mineru.net/api/v4
MINERU_API_KEY=your_mineru_token
# 自建服务 (可选)
# MINERU_SELF_HOSTED_URL=http://mineru.internal:8765

# ==================== 文件存储 ====================
STORAGE_TYPE=s3
STORAGE_PATH=  # s3 模式下忽略
S3_ENDPOINT=https://oss-cn-beijing.aliyuncs.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET=readitdeep-prod
```

---

## Docker Compose 生产配置

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - LLM_BASE_URL=${LLM_BASE_URL}
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_MODEL=${LLM_MODEL}
      - MINERU_API_KEY=${MINERU_API_KEY}
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
      - EMBEDDING_API_KEY=${EMBEDDING_API_KEY}
      - EMBEDDING_MODEL=${EMBEDDING_MODEL}
      - STORAGE_TYPE=s3
      - S3_ENDPOINT=${S3_ENDPOINT}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET=${S3_BUCKET}
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  redis_data:
```

---

## 数据迁移注意事项

### 1. SQLite → PostgreSQL 迁移

```bash
# 1. 导出 SQLite 数据
sqlite3 backend/data/readitdeep.db .dump > dump.sql

# 2. 转换 SQL 语法 (使用工具如 pgloader)
pgloader sqlite:///path/to/readitdeep.db postgresql://user:pass@host/db

# 3. 或手动导出 CSV 后导入
```

### 2. 内存 Store → 数据库持久化

当前 Paper 元数据同时存在于:
- SQLite/PostgreSQL (`papers` 表)
- 内存 Store (`app/core/store.py`)

确保数据同步:
```python
# 启动时从数据库加载到 Store
async def sync_store_from_db():
    async with async_session_maker() as db:
        papers = await db.execute(select(Paper))
        for paper in papers.scalars():
            store.set(paper.id, paper_to_dict(paper))
```

### 3. 文件迁移 (Local → S3)

```bash
# 使用 rclone 同步
rclone sync ./uploads s3:readitdeep-prod/uploads

# 或 AWS CLI
aws s3 sync ./uploads s3://readitdeep-prod/uploads
```

---

## 快速检查清单

- [ ] PostgreSQL + pgvector 已部署并启用扩展
- [ ] Redis 已部署并设置密码
- [ ] 所有 API Keys 已更新为生产密钥
- [ ] `SECRET_KEY` 已更换为强随机值
- [ ] `DEBUG=false`
- [ ] CORS 仅允许生产域名
- [ ] S3/OSS 存储已配置
- [ ] 健康检查端点可访问
- [ ] 日志收集已配置

---

> 📝 **维护记录**: 创建于 2025-12-17
