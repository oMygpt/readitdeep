# Read it DEEP Backend

FastAPI 后端服务

## 开发环境设置

```bash
# 安装 Poetry (如果未安装)
pip install poetry

# 安装依赖
poetry install

# 激活虚拟环境
poetry shell

# 启动开发服务器
uvicorn app.main:app --reload --port 8080
```

## 项目结构

```
backend/
├── app/
│   ├── main.py           # FastAPI 应用入口
│   ├── config.py         # 配置管理
│   ├── api/              # API 路由
│   │   ├── v1/
│   │   │   ├── papers.py
│   │   │   ├── library.py
│   │   │   └── translate.py
│   ├── models/           # SQLAlchemy 模型
│   ├── schemas/          # Pydantic schemas
│   ├── services/         # 业务逻辑
│   │   ├── mineru.py
│   │   ├── llm.py
│   │   └── embedding.py
│   └── core/             # 核心功能
│       ├── database.py
│       └── security.py
├── tests/
└── pyproject.toml
```
