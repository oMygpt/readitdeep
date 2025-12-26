---
description: 代码修改后检查数据库迁移和 Docker 镜像更新
---

# 数据库和 Docker 镜像更新检查

每次修改代码后，请执行以下检查：

## 1. 数据库模型变更检查

当修改以下文件时，必须检查是否需要数据库迁移：

- `backend/app/models/*.py` - SQLAlchemy 模型定义
- 任何涉及新增、删除或修改数据库字段的代码

### 检查步骤

1. **新增字段**: 确保在 `backend/scripts/migrate_db.py` 中添加对应的迁移逻辑
2. **模型导入**: 确保新模型已在 `database.py` 的 `init_db()` 函数中导入
3. **本地测试**: 运行 `python scripts/migrate_db.py` 验证迁移脚本

### 迁移脚本模板 (SQLite)

```python
# 在 migrate_sqlite() 函数中添加
if "new_column" not in columns:
    cursor.execute("ALTER TABLE table_name ADD COLUMN new_column TEXT")
    migrations_done.append("table_name.new_column")
```

## 2. Docker 镜像更新考虑

当修改以下内容时，需要触发 GHCR 镜像重新构建：

- `backend/**` 或 `frontend/**` 目录下的任何文件
- `Dockerfile` 或 `docker-compose*.yml` 文件
- `.github/workflows/docker-build.yml`

### 触发构建

推送到 `main` 分支会自动触发 GitHub Actions 构建并发布到 GHCR：

```bash
git push origin main
```

### 部署更新

在服务器上执行：

```bash
# 拉取新镜像
docker pull ghcr.io/omygpt/readitdeep-backend:latest
docker pull ghcr.io/omygpt/readitdeep-frontend:latest

# 重启服务
docker compose -f docker-compose.ghcr.yml up -d --force-recreate
```

## 3. 关键文件清单

| 文件 | 用途 |
|------|------|
| `backend/scripts/migrate_db.py` | 数据库迁移脚本 |
| `backend/entrypoint.sh` | Docker 启动入口，自动执行迁移 |
| `backend/app/core/database.py` | 数据库初始化，导入所有模型 |
| `.github/workflows/docker-build.yml` | GHCR 镜像构建 Action |
