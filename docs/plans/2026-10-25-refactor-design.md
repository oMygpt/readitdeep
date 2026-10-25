# Read it DEEP 改造设计：安全基线、单一存储、可插拔后端与 PaperDaily 关联

> 状态：**设计稿，待作者确认后实施**。日期 2026-10-25。计划见 `docs/plans/2026-10-25-refactor-plan.md`。
> 上游语境：PaperDaily 三站科研前置方案（alonegg/new_paperdaily PR #120，设计 v2.1 已确认）。其中 Read it DEEP（下称 RiD）负责「读」：全文、批注、翻译、工作台；PaperDaily 主站负责账号、题录、个人库与阅读记忆；ask.paperdaily.org 负责「找」。
> 两条硬约束（作者决定）：**RiD 保持可独立部署**，开源用户不依赖 PaperDaily；与 PaperDaily 关联部署时为 `read.paperdaily.org`，经 Cloudflare Tunnel 发布，校内可用内部 LLM / GROBID 解析论文。

## 1. 现状审读（main `@` 2026-06-02，33 个提交）

结论：功能面丰富（阅读器、翻译、工作台、图谱、团队、分享、配额、提示词管理），但**数据层、鉴权和仓库卫生还停留在原型阶段**，在对外部署前必须先补地基。

### 1.1 安全与隐私（必须先修）

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| S1 | 公开仓库提交了运行数据 | `backend/data/papers.json`（45 篇，38 篇带 user_id，含 Markdown 全文，部分含译文）+ `.bak`；`backend/data/workbench.json`（51 MB，620 条工作台条目）；`token_stats.json` | 用户数据与受版权保护的论文全文公开可下载；克隆慢（历史里每个版本都在） |
| S2 | 大量路由无鉴权 | `workbench.py` 14 条路由 0 个鉴权依赖；`translate.py` 3/3、`analysis.py` 2/2、`graph.py` 2/2、`monitor.py` 3/3、`authors.py` 1/1、`classification.py` 8/10 无鉴权 | 任何人可读任意论文译文全文（`GET /papers/{id}/translation`）、读写全站共享工作台、触发 LLM 调用消耗部署者额度 |
| S3 | 上传目录无鉴权静态挂载 | `main.py` `app.mount("/uploads", StaticFiles(...))` | PDF 与图片凭 URL 即可下载 |
| S4 | 不安全默认值不拦截 | `secret_key="change-me-in-production"`、`cors_origins="*"` 且 `allow_credentials=True` | 忘配即可伪造 JWT |
| S5 | 用户级配置可覆盖模型/解析服务地址 | `ConfigManager.get_effective_config` 第 4 层 `UserConfig` 覆盖 `llm_base_url` 等 | 托管实例上的 SSRF（让服务器去请求内网地址） |
| S6 | 无 user_id 的论文被当作公开 | `check_paper_access` 首行 | 历史数据对所有人可见 |

### 1.2 架构

| # | 问题 | 证据 |
|---|---|---|
| A1 | 双存储，JSON 文件是事实来源 | `core/store.py` 进程内 dict，每次 `set` 整文件重写并复制 `.bak`；DB `papers` 表靠 `asyncio.create_task(sync_paper_to_db)` 异步补写，失败只打 warning。多 worker/多副本不安全，崩溃可丢数据 |
| A2 | 工作台全局共享、无归属 | `core/workbench_store.py` 只有 `global_workbench` 与 `paper_workbenches`，条目无 user_id；51 MB 单文件 |
| A3 | 无迁移体系 | `init_db()` 用 `create_all`，加字段靠 `scripts/add_*.py` 手工脚本 |
| A4 | 无测试 | 没有 `tests/`；根目录 `test_*.py`、`debug_*.py`、`check_*.py`、`fix_*.py` 是一次性脚本 |
| A5 | 解析强依赖 MinerU 云 | `parse_paper_task` 无 MinerU key 直接失败；状态值混杂（`completed` 之后又写 `embedding_done`） |
| A6 | 后台任务在进程内 | `BackgroundTasks` / `create_task`，重启即丢，无排队与并发上限 |
| A7 | 仓库杂项 | `jiejian/`（2025-12 的原型前端）、`.pids`、`.pids 2`、空 `backend.md`、根目录 `implementation_plan.md` |

## 2. 目标架构

```
             ┌──────────── RiD backend (FastAPI) ────────────┐
 identity    │  IdentityProvider: local(默认) | paperdaily     │
 library     │  LibrarySource:   upload(默认) | paperdaily     │
 parsing     │  ParseProvider:   mineru_cloud | grobid | paperdaily_markdown
 llm         │  LLMPool:         按任务(chat/translate/extract)配置，多端点+并发上限
 storage     │  DB（唯一事实来源，PostgreSQL / SQLite）+ BlobStore(local|s3)
 jobs        │  jobs 表 + worker（可重启恢复，按 provider 限并发）
             └───────────────────────────────────────────────┘
```

### 2.1 单一存储
- DB 为唯一事实来源。`papers` 扩展字段；正文与译文拆到 `paper_contents(paper_id, kind[markdown|translation], lang, body, parser, source, created_at)`，避免列表查询拖大字段。
- 工作台迁到 `workbench_items(id, user_id, paper_id, zone, type, title, description, data jsonb, created_at)`；「全局工作台」= 本人所有条目的汇总视图。
- 文件走 `BlobStore`（local / S3），下载经鉴权路由 `GET /api/v1/files/{paper_id}/{name}`，取消 `/uploads` 静态挂载；Markdown 内图片链接改写为该路由。
- Alembic 管理迁移；`init_db` 只在 SQLite 首次启动时建表。
- 一次性迁移脚本 `scripts/migrate_json_to_db.py`：幂等，把自托管用户已有的 `papers.json` / `workbench.json` 导入 DB；无 user_id 的历史条目归属到首个管理员（可配置），不再视为公开。

### 2.2 论文状态机
`metadata_imported → file_available → parsing → ready | failed`，翻译、分析、向量化各有独立子状态（`pending|running|done|failed`），不再复用主状态。上传路径直接从 `file_available` 开始，与现在体验一致。

### 2.3 可插拔后端
- **ParseProvider**：`mineru_cloud`（现有）、`grobid`（校内 `:8070`，TEI → Markdown，图片按页截取可后补）、`paperdaily_markdown`（关联模式下直接使用主站已解析的开放许可全文，附源格式/解析器/覆盖页 manifest）。按顺序回退，配置在系统级。
- **LLMPool**：每类任务一组 OpenAI 兼容端点（可多台，轮询 + 健康检查）和并发上限；校内部署填内部 vLLM（Qwen 系）。交互请求与批量（翻译、整篇提炼）分开限流。
- **配置权限**：模型/解析端点地址与 key 只允许管理员在系统级设置；用户级只保留偏好（语言、提示词版本等）。独立部署可通过开关 `ALLOW_USER_ENDPOINTS=true` 恢复「用户自带 key」，此时地址做内网/保留地址拦截。

### 2.4 部署模式
`RID_MODE=standalone`（默认，行为与现在一致）| `linked`（启用 PaperDaily provider）。两种模式共用同一代码与同一数据模型，差别只在 provider 选择与少量界面开关。

### 2.5 R2 实施细化（2026-10-25，实施前补充）

审读存量代码后对 §2.1/§2.2 的落地方式做如下细化，目标不变（DB 唯一事实来源、多进程安全、不丢数据），改动面收窄：

1. **保留 `store` / `workbench_store` 的调用接口，换掉实现**。全仓 75 处 `store.*` 调用、14 处 `workbench_store.*` 调用不逐一改写，而是把两个类改为基于数据库的实现（同步 SQLAlchemy 引擎：SQLite 用内置驱动，PostgreSQL 用 psycopg；每次调用一个短事务）。原实现是在事件循环里同步重写整个 JSON 文件，换成单行读写只会更快。
2. **论文行 = 固定列 + `extra` JSON**。已有列（标题、正文、译文、状态等）照旧；JSON 里其余几十个字段（structure、summary、analysis、s2_graph、翻译进度、embedding 等）进 `papers.extra`。`get()` 返回与原来形状相同的 dict。正文暂不拆表：列表接口改为只取轻量列（`list_light`），大字段只在详情接口读取。
3. **整条覆盖改为按字段合并**。原代码普遍是 `store.set(id, {**旧快照, 改动})`，长任务（翻译、分析）会用开始时的旧快照覆盖期间别人的修改。新增 `store.update(id, changes)`：在一个事务内读取当前行、合并改动、写回（PostgreSQL 加 `FOR UPDATE` 行锁）；所有存量写回点改用它，`set` 只用于新建。直接修改 `get()` 返回值而不写回的 1 处（embedding）一并修正。
4. **工作台**：新表 `workbench_items`，`user_id` 为显式列；导入时按「条目 user_id → 来源论文所有者」回落规则写入，之后不再需要运行时回落。
5. **迁移体系**：引入 Alembic。`0001` = 现有模型基线；`0002` = `papers.extra`、`papers.source_provider/source_id`（`(user_id, source_provider, source_id)` 唯一）、`workbench_items`、`data_migrations`。启动脚本：已有库但无版本记录 → 先跑旧的补列脚本再 `stamp 0001` → `upgrade head`；空库 → `upgrade head`。测试校验「迁移结果 = 模型定义」。
6. **JSON → DB 导入**：`scripts/migrate_json_to_db.py`，启动时若发现 `data/papers.json` / `data/workbench.json` 且未记录导入，则自动执行；幂等（重复执行结果不变），JSON 字段覆盖 DB 中由旧同步逻辑写入的同名字段；用户不存在的 `user_id` 置空（只有管理员可见）并计入报告；原文件保留不删，作为一个版本周期的只读备份。
7. **状态机推迟到 R4**：`metadata_imported / file_available` 只在从 PaperDaily 导入时出现，现有上传流程的 `status` 取值（uploading → parsing → … → completed / failed）前端与流水线大量依赖，R2 不改，R4 引入导入流程时再扩展。
8. **任务恢复先做「明确失败」**：进程内后台任务保留；启动时把超过 60 分钟仍停在中间状态的论文/翻译标为失败并写明「服务重启中断，请重试」，用户可用现有「重新分析」入口重跑。持久化任务队列与并发上限并入 R3（与 LLMPool 一起做）。

## 3. 与 PaperDaily 关联（`RID_MODE=linked`）

对应 PaperDaily 设计 v2.1 §3.3、§4.2、§4.3、§5；依赖主站 E2（connect，client `read`）与 E3。

1. **身份**：关闭本地注册与密码登录，登录经 `paperdaily.org/connect/read`（授权码 + PKCE，RiD 是服务端 confidential client）。`users` 增 `external_provider`、`external_subject`（唯一）。委托 key 加密存库（30 天、无 refresh，到期重新授权）；遇 401 只清会话。
2. **深链**：`/open?paper=<pd_paper_id>&from=ask|daily|library&ref=` 与 `?collection=<id>`。未登录先登录再回来。按 `(owner, source_provider='paperdaily', source_id)` 唯一约束幂等导入，重复打开直接进阅读器。
3. **全文**：优先 `paperdaily_markdown`（主站对同一用户可见的开放许可解析结果）；否则停在 `metadata_imported`，提示上传本人有权使用的 PDF，上传后走 GROBID / MinerU。
4. **阅读器左栏**：调用主站 `GET /api/v1/papers/{id}/context-bundle`（引文邻域、立场句、版本链），替代 RiD 自建图谱中的同类数据；独立模式保留 Semantic Scholar / OpenAlex 实现。
5. **回传**：「保存到研究记忆」按 §30 协议 `POST /api/v1/me/reading-sessions`（notes / claims / questions，`depth` 如实标注）；不回传 PDF、全文、译文全文。研究问题经用户确认进入问题值班。
6. **计量**：关联模式下 RiD 的解析与 AI 消耗记 PaperDaily credits（主站侧需提供 client `read` 的预扣/结算接口，属主站 E4 范围）；RiD 本地配额在关联模式下只作为并发与滥用保护。
7. **删除**：接收主站签名 webhook（删号），删除映射账户下的论文副本、文件、批注、译文、工作台，回 ack。
8. **其他**：团队、分享链接在关联模式首发关闭，后续与主站合集共享一起设计。

## 4. 开源与许可
- AGPL-3.0：read.paperdaily.org 运行的任何修改都必须对其用户提供源码。所有改造在本公开仓库进行，PaperDaily 专用逻辑以 provider 形式存在，不放私有分支。
- 独立模式是默认，README 与 docker-compose 不出现 PaperDaily 依赖；关联模式另有 `docs/deploy-linked.md`。

## 5. 不做
- 不做通用 OAuth / 第三方 PaperDaily 实例接入（独立部署可选粘贴个人 PaperDaily API key 作为题录来源，另行设计）。
- 首发不改前端视觉与交互框架；只做为状态机、鉴权、深链所需的改动，以及拆分 `ReaderPage.tsx`（80 KB）中被触及的部分。
- 不在本轮实现 PRD 中尚未落地的「思维回放 / 冲突检测 / 播客」。

## 6. 需要作者决定
1. **S1 已公开数据**：本轮从 HEAD 删除并加入 `.gitignore`。是否另外**重写 git 历史**彻底清除（需要强制推送 main，fork 与已有克隆不受影响，GHCR 镜像无关）？
2. `jiejian/` 原型目录是否删除（或移到单独分支）。
3. 关联部署的校内主机与 PostgreSQL 实例（运维评审时定）。
