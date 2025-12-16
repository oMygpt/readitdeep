# Read it DEEP

AI 驱动的深度阅读与知识资产管理平台

## 项目结构

```
readitdeep/
├── backend/          # FastAPI 后端
├── frontend/         # React + Vite 前端
├── docs/             # 项目文档
├── PRD.md            # 产品需求文档
└── implementation_plan.md  # 实施计划
```

## 快速开始

### 一键启动

```bash
# 启动前端和后端
./start.sh

# 停止服务
./stop.sh
```

启动后访问:
- 📖 **前端**: http://localhost:5173
- 🔧 **后端**: http://localhost:8080
- 📚 **API 文档**: http://localhost:8080/docs

### 手动启动

**后端 (使用 uv)**
```bash
cd backend
uv sync              # 安装依赖
uv run uvicorn app.main:app --reload --port 8080
```

**前端**
```bash
cd frontend
npm install
npm run dev
```

## 技术栈

- **后端**: Python 3.11+, FastAPI, LangGraph, SQLAlchemy
- **前端**: React 18, Vite, TypeScript, Tailwind CSS
- **数据库**: PostgreSQL + pgvector
- **LLM**: vLLM (OpenAI 兼容) / 火山引擎

## 文档

- [实施计划](./implementation_plan.md)
- [产品需求](./PRD.md)
