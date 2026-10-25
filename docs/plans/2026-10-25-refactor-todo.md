# Read it DEEP 改造 TODO

对应计划 `2026-10-25-refactor-plan.md`。完成一项勾一项并写上 PR 号；验收证据记在 `2026-10-25-refactor-acceptance.md`。

## R0 仓库卫生与测试地基
- [x] R0.1 删除 `backend/data/*.json(.bak)`、`.pids*`、空 `backend.md`、一次性脚本；`.gitignore` 增 `backend/data/`
- [x] R0.2 删除 `jiejian/`（作者决定直接删除，不留分支）
- [x] R0.3 `backend/tests/` + pytest 配置 + 临时 SQLite / 临时存储目录 fixture
- [x] R0.4 GitHub Actions：ruff（宽松规则起步）+ pytest
- [x] R0.5 首批测试：注册、登录、上传（MinerU 打桩）、论文访问控制
- [x] R0.6 重写 git 历史清除 `backend/data/`（先做本地 mirror 备份）

## R1 安全基线
- [x] R1.1 统一依赖 `require_paper_access`，覆盖全部论文相关路由
- [x] R1.2 workbench 全部路由要求登录（R2 前按 source_paper 归属过滤）
- [x] R1.3 路由鉴权清单测试：新增无鉴权路由即失败（白名单：health、auth 登录注册、share 公开读取）
- [x] R1.4 取消 `/uploads` 静态挂载，鉴权文件路由 + 图片链接改写
- [x] R1.5 启动安全检查（默认 secret、CORS * + credentials）
- [x] R1.6 端点地址仅管理员可配；`ALLOW_USER_ENDPOINTS` + 内网地址拦截（用户自己的 API Key 仍可填）
- [x] R1.7 无 user_id 论文不再公开
- [x] R1.8 LLM 触发路由计入 AI 配额

## R2 单一存储（设计 §2.5）
- [x] R2.1 Alembic：0001 基线、0002 新表新列、启动升级脚本、迁移=模型一致性测试
- [x] R2.2 `store` 改为数据库实现（固定列 + extra JSON），`update()` 合并写、`list_light()`
- [x] R2.3 存量 `set(id, {**旧快照, …})` 全部改为 `update()`；修正 embedding 原地修改未写回
- [x] R2.4 `workbench_store` 改为 `workbench_items` 表实现
- [x] R2.5 `scripts/migrate_json_to_db.py`（幂等 + 对账），启动自动执行一次
- [x] R2.6 启动时恢复卡住的论文/翻译状态
- [x] R2.7 迁移演练（历史 45 篇 / 620 条）与并发写测试

## R3 可插拔后端（设计 §2.6）
- [x] R3a.1 `get_chat_model(task, user_id)` 统一入口；翻译、引用分析、@AI、提示词预览改用管理员配置
- [x] R3a.2 模型配置按触发者取（与 AI 配额一致）
- [x] R3a.3 多端点故障转移传输层（冷却、仅响应头前重试）
- [x] R3a.4 交互 / 批量两个并发通道
- [x] R3a.5 `LLM_EXTRA_BODY`（校内 Qwen3 关闭思考输出）
- [ ] R3b.1 ParseProvider 接口 + mineru / grobid / paperdaily_markdown 占位
- [ ] R3b.2 `parse_providers` / `grobid_url` 配置与回退；`parser` 字段；MinerU Key 缺失不再失败
- [ ] R3c.1 `jobs` 表 + worker（认领、心跳、重试）；上传 / 重新分析 / 翻译入队
- [ ] R3c.2 `token_usage` 表取代 token_stats.json
- [ ] R3.3 校内 GROBID + vLLM 实测记录

## R4 PaperDaily 关联（依赖主站 E2/E3）
- [ ] R4.1 `RID_MODE=linked` 登录与身份映射
- [ ] R4.2 `/open` 深链 + 幂等导入；状态机扩展 metadata_imported / file_available（自 R2 移入）
- [ ] R4.3 context-bundle 左栏、回传研究记忆、删号 webhook
- [ ] R4.4 credits 计量对接
- [ ] R4.5 端到端验收

## R5 部署
- [ ] R5.1 校内主机 compose + PostgreSQL + cloudflared → read.paperdaily.org
- [ ] R5.2 备份与监控

## R1 期间顺带处理
- [x] `ai_assist` 两个接口把 AsyncSession 当同步用（实际不可用）→ 改为 async，并补论文/批注访问校验与配额
- [x] 删除被 papers 路由遮蔽的 `api/v1/analysis.py`（同路径同方法，从未生效）
- [x] 上传文件名去路径成分；`get_current_user` 不再把 token 内容写日志；缺凭证统一 401
- [x] nginx `location ^~ /api`（否则带图片扩展名的 API 地址被静态规则截走）；SSE 关闭代理缓冲
- [x] 前端 `authFetch` / `AuthEventSource`：原生 EventSource 无法带 Authorization 头
- [x] `docs/UPGRADING.md` 记录对自托管用户的行为变化

## R2 期间顺带处理
- [x] 删除死代码 `services/analysis.py`、`get_all_categories`（跨用户读取分类名）
- [x] 删除论文时一并删除解析出的图片目录
- [x] 写入时间统一 UTC（原来混用本地时间与 UTC，影响「卡住任务」判断和排序）
- [x] SQLite 合并写使用 `BEGIN IMMEDIATE`（无 FOR UPDATE 时防止跨进程丢更新）
- [x] 旧数据里存成 JSON 字符串的标签，读取时统一为列表
- [x] PostgreSQL 时区：会话 UTC、模型比较统一 `as_utc()`；CI 增加 PostgreSQL 矩阵
