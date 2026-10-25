# Read it DEEP Backend

FastAPI 后端服务

## 开发环境设置

```bash
# 安装依赖（含测试工具）
uv sync --extra dev

# 启动开发服务器
uv run uvicorn app.main:app --reload --port 8080

# 运行测试（使用临时 SQLite 与临时目录，不会碰本地数据）
uv run pytest -q
```

运行数据（`data/`：SQLite、papers.json、workbench.json、上传文件）只在本地，已被 `.gitignore` 排除，**不要提交**。

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
