# Read it DEEP 改造计划

设计见 `docs/plans/2026-10-25-refactor-design.md`。每个阶段一个或数个 PR，合并前测试通过；独立模式回归是每个 PR 的必检项。

## R0 仓库卫生与测试地基
1. 从 HEAD 删除 `backend/data/*.json(.bak)`、`.pids*`、空 `backend.md`、根目录一次性脚本（`debug_*`、`check_*`、`fix_*`、`test_*` 手工脚本）；`.gitignore` 增 `backend/data/`。历史重写按作者决定另做。
2. `backend/tests/` + pytest + httpx AsyncClient + 临时 SQLite；GitHub Actions 增 `ruff` 与 `pytest`（现有 docker-build 不动）。
3. 首批测试：注册/登录、上传（MinerU 打桩）、论文访问控制。

验收：CI 绿；`docker compose up` 冷启动可用。

## R1 安全基线
4. 所有路由加鉴权与归属校验（`require_paper_access(paper_id)` 统一依赖：所有者 / 管理员 / 团队共享）；workbench、translate、analysis、graph、monitor、authors、classification 全覆盖。为每个路由写「未登录 401 / 他人 403」参数化测试，新增路由不加测试则 CI 失败（路由清单比对）。
5. 取消 `/uploads` 静态挂载，改鉴权文件路由；改写 Markdown 图片链接（迁移脚本处理存量）。
6. 启动检查：非 debug 模式下 `secret_key` 为默认值或 CORS 为 `*` 时拒绝启动。
7. 端点地址仅管理员可配；`ALLOW_USER_ENDPOINTS` 开关 + 内网地址拦截。
8. 无 user_id 论文归属管理员。
9. LLM 触发路由计入现有 AI 配额。

验收：鉴权矩阵测试全绿；手工用另一账号逐一尝试读取他人论文、译文、文件、工作台均失败。

## R2 单一存储（细化见设计 §2.5）
10. 引入 Alembic：`0001` 基线 + `0002` 新表新列；启动脚本处理「旧库补列 → stamp → upgrade」；测试校验迁移结果与模型一致。
11. `store` / `workbench_store` 改为数据库实现，接口不变；新增 `update()` 合并写、`list_light()` 轻量列表；所有 `set(id, {**旧快照, …})` 改为 `update`。
12. `migrate_json_to_db.py`（幂等 + 对账输出），启动时自动执行一次并记录。
13. 启动时把超时卡在中间状态的论文/翻译标为可重试的失败。（持久化任务队列并入 R3；状态机扩展并入 R4）

验收：用历史 `papers.json`/`workbench.json` 副本做迁移演练，条数与内容一致、二次运行无变化；两个进程并发写同一论文的不同字段不互相覆盖；重启后不再有永久卡在 parsing 的论文。

## R3 可插拔后端
14. `ParseProvider`：mineru_cloud、grobid、paperdaily_markdown；回退顺序可配。
15. `LLMPool`：按任务分组、多端点、并发上限、交互与批量分开限流；token 统计迁入 DB。
16. 用校内 GROBID + 内部 vLLM 跑通一篇 arXiv 论文的解析、翻译、方法提炼；记录耗时与并发，供容量评审。

## R4 PaperDaily 关联（依赖主站 E2/E3 上线 connect 与收藏入口）
17. `RID_MODE=linked`：connect 登录、外部身份映射、委托 key 加密存储、401 清会话。
18. `/open` 深链与幂等导入；无全文时的上传引导。
19. 左栏 context-bundle；「保存到研究记忆」回传；删号 webhook。
20. credits 计量对接（待主站提供 client `read` 预扣/结算接口）。
21. 端到端：ask 收藏 → 深读 → 登录 → 导入 → 阅读 → 回传 → 主站可见；同一论文重复打开不重复导入；独立模式回归。

## R5 部署 read.paperdaily.org
22. 校内主机 docker compose（PostgreSQL 独立库、Redis）+ cloudflared 隧道；`docs/deploy-linked.md`。
23. 监控与备份：DB 每日备份、上传文件目录备份、健康检查接入。

## 回滚
- R1–R3 均为向后兼容迁移；R2 保留 JSON 文件只读备份一个版本周期。
- `RID_MODE` 切回 standalone 即关闭全部 PaperDaily 逻辑。
