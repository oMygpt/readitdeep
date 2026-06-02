# Read it DEEP Platform Introduction

> **"Not just a Reader, but a Cognitive Recorder."**

Welcome to **Read it DEEP**, the AI-driven platform designed to transform how you interact with research papers. Move beyond passive reading into active knowledge construction with our "Deep Read" philosophy.

---

## 🌟 Product Overview

**Read it DEEP** is a dual-engine platform:
1.  **Cognitive Recorder**: It tracks your reading path, highlighting, and thought process.
2.  **Research Asset Factory**: It refines raw papers into structured assets—methods, datasets, and inspirations.

Powered by **LangGraph** and state-of-the-art LLMs, we turn your library into a **Dynamic Knowledge Graph**.

---

## 🚀 Feature Demonstration

### 1. Smart Ingestion (智能导入)
*Efficiently bringing knowledge into your system.*

The journey begins with our **Smart Ingestion** pipeline.
- **Drag & Drop**: Simply drag your PDF into the upload area.
- **Mineru Parsing**: Our integration with Mineru V4 ensures high-fidelity parsing, preserving layout, formulas, and images as Markdown.
- **Real-time Feedback**: Watch as your paper goes from `Uploading` → `Parsing` → `Indexing`.

### 2. The Library (知识库)
*Your organized research headquarters.*

Once ingested, papers appear in your **Library**.
- **Auto-Metadata**: We automatically fetch titles, authors, and publication dates.
- **Visual Cards**: Papers are presented as cards with key details, making retrieval instant.
- **Search & Filter**: Quickly find papers by keywords or topics.

### 3. Zen Reader & Deep Read Mode (沉浸式阅读)
*Focus, connect, and think.*

Clicking "Start Deep Reading" activates our signature **3-Column Layout**:

| **Left: Context** | **Center: Content** | **Right: Workbench** |
| :--- | :--- | :--- |
| **Knowledge Graph** & **Analysis**<br>See how this paper connects to others. | **Zen Reader**<br>Distraction-free Markdown rendering with interactive citations. | **Smart Workbench**<br>Your active workspace for extracting value. |

- **Interactive Citations**: Hover over a citation `[1]` to see the reference instantly without losing your place.
- **Translation**: Seamlessly switch between original and translated text with a single click.

### 4. The Smart Workbench (智能工作台)
*Where information becomes an asset.*

This is the heart of "Deep Reading".
- **Method Alchemy (方法炼金台)**: Select a method description in the text, and the AI extracts parameters, loss functions, and even generates PyTorch pseudocode.
- **Data Warehouse (资产仓库)**: Automatically validates dataset URLs and licenses.
- **Idea Canvas (灵感画板)**: Record your hypotheses and link them directly to the evidence in the text.

### 5. Dynamic Knowledge Graph (动态知识图谱)
*Visualizing your second brain.*

As you read, the graph evolves.
- **Citation Links**: See what influenced this paper.
- **Similarity Connections**: Discover papers in your library with similar concepts, powered by vector embeddings.

---

## 🛠 Technical Highlights

- **Local-First AI**: Powered by local LLMs (vLLM/Ollama compatible) for privacy and speed.
- **LangGraph Agents**: sophisticated loops for self-correcting extraction and verification.
- **Vector Database**: `pgvector` integration for semantic search and graph construction.
- **Modern Stack**: Built with React, Vite, Tailwind, Python FastAPI, and SQLite/PostgreSQL.

---

## 🎬 Experience It

Ready to dive deep?
1. **Upload** your first paper.
2. **Open** it in the Reader.
3. **Activate** the Workbench.
4. **Build** your Knowledge Graph.

---

## 🐳 部署指南

### 本地开发

```bash
# 配置环境变量
cp .env.example .env
# 编辑 .env 填写 API Keys

# 启动开发服务器
./start.sh
```

### Docker 部署

#### 方式 1: 本地构建

```bash
cp .env.docker.example .env
./docker-start.sh              # 默认: Frontend 3000, Backend 8080
./docker-start.sh 80 8080      # 使用 80 端口
```

#### 方式 2: 使用 GHCR 镜像 (推荐)

GitHub Actions 会在每次推送时自动构建镜像到 GHCR。

```bash
# 1. 上传配置到服务器
scp docker-compose.ghcr.yml .env user@server:/opt/readitdeep/

# 2. 在服务器上拉取并启动
cd /opt/readitdeep
docker compose -f docker-compose.ghcr.yml pull
FRONTEND_PORT=80 GITHUB_OWNER=oMygpt docker compose -f docker-compose.ghcr.yml up -d
```

#### 更新部署

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

### 数据持久化

所有数据存储在 `./readit_data/` 目录:
- `db/` - 数据库、papers.json、workbench.json
- `uploads/` - PDF 和解析结果
- `redis/` - 缓存数据

> 📚 详细部署文档: [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md)

---


**Read it DEEP** — *Where reading meets thinking.*


## 📜 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL v3)**.

SPDX-License-Identifier: `AGPL-3.0-only`

- **Open Source**: You are free to use, modify, and distribute this software under the terms of the AGPL v3.
- **Copyleft**: If you modify this software and distribute it (web service included), you must make your modifications open source under the same license.
- **Dual Licensing**: For commercial use cases, proprietary integration, or exemptions from AGPL conditions, please contact **CHUNLIN@Readit DEEP** for a commercial license.

Copyright (C) 2025 CHUNLIN@Readit DEEP.
