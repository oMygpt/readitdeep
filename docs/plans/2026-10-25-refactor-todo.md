# Read it DEEP 改造 TODO

对应计划 `2026-10-25-refactor-plan.md`。完成一项勾一项并写上 PR 号；验收证据记在 `2026-10-25-refactor-acceptance.md`。

## R0 仓库卫生与测试地基
- [x] R0.1 删除 `backend/data/*.json(.bak)`、`.pids*`、空 `backend.md`、一次性脚本；`.gitignore` 增 `backend/data/`
- [x] R0.2 删除 `jiejian/`（作者决定直接删除，不留分支）
- [x] R0.3 `backend/tests/` + pytest 配置 + 临时 SQLite / 临时存储目录 fixture
- [x] R0.4 GitHub Actions：ruff（宽松规则起步）+ pytest
- [x] R0.5 首批测试：注册、登录、上传（MinerU 打桩）、论文访问控制
- [ ] R0.6 重写 git 历史清除 `backend/data/`（先做本地 mirror 备份）

## R1 安全基线
- [ ] R1.1 统一依赖 `require_paper_access`，覆盖全部论文相关路由
- [ ] R1.2 workbench 全部路由要求登录（R2 前按 source_paper 归属过滤）
- [ ] R1.3 路由鉴权清单测试：新增无鉴权路由即失败（白名单：health、auth 登录注册、share 公开读取）
- [ ] R1.4 取消 `/uploads` 静态挂载，鉴权文件路由 + 图片链接改写
- [ ] R1.5 启动安全检查（默认 secret、CORS * + credentials）
- [ ] R1.6 端点地址仅管理员可配；`ALLOW_USER_ENDPOINTS` + 内网地址拦截
- [ ] R1.7 无 user_id 论文不再公开
- [ ] R1.8 LLM 触发路由计入 AI 配额

## R2 单一存储
- [ ] R2.1 Alembic 基线
- [ ] R2.2 新表/新列：`paper_contents`、`workbench_items`、状态机与子状态、`source_provider/source_id`
- [ ] R2.3 `scripts/migrate_json_to_db.py`（幂等 + 对账输出）
- [ ] R2.4 移除 JSONStore / WorkbenchStore
- [ ] R2.5 `jobs` 表 + worker，重启恢复

## R3 可插拔后端
- [ ] R3.1 ParseProvider：mineru_cloud / grobid / paperdaily_markdown + 回退
- [ ] R3.2 LLMPool：分任务、多端点、并发上限
- [ ] R3.3 校内 GROBID + vLLM 实测记录

## R4 PaperDaily 关联（依赖主站 E2/E3）
- [ ] R4.1 `RID_MODE=linked` 登录与身份映射
- [ ] R4.2 `/open` 深链 + 幂等导入
- [ ] R4.3 context-bundle 左栏、回传研究记忆、删号 webhook
- [ ] R4.4 credits 计量对接
- [ ] R4.5 端到端验收

## R5 部署
- [ ] R5.1 校内主机 compose + PostgreSQL + cloudflared → read.paperdaily.org
- [ ] R5.2 备份与监控
