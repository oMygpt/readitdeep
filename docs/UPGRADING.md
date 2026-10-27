# 升级说明

自托管用户升级时需要注意的行为变化。按版本倒序。

## 系列站：题录/PDF 分离、按篇计费、配置分层（2026-10，R6）

独立模式（`RID_MODE=standalone`）行为基本不变，只新增「阅读与翻译偏好」（目标语言、译文风格、术语表、解析质量、自动翻译，`GET/PUT /api/v1/preferences`）。自动翻译在独立模式下默认关闭，需要用户自己打开。

关联模式（`RID_MODE=linked`）：
1. **配置分层**：数据库里所有 `*_api_key`、`*_url`、`llm_mode / translation_mode / mineru_mode`、嵌入配置一律不生效，写接口返回 400，只认部署层环境变量。管理员只能从 `ALLOWED_MODELS`（逗号分隔）中为各任务选模型。用户只能改偏好。
2. **题录与 PDF 分离**：
   - `POST /api/v1/papers/import/paperdaily`（以及 `/collection`、`/review`）免费导入主站题录，论文状态为 `metadata`；
   - 补传 PDF 用 `POST /papers/{id}/pdf`，抓取开放获取 PDF 用 `POST /papers/{id}/fetch-pdf`；白名单为 `OA_PDF_HOSTS`（默认 arXiv），大小上限为 `OA_PDF_MAX_BYTES`。
3. **按篇计费**：每个用户每个 PDF 内容计费一次，覆盖解析、翻译与分析。
   - `READ_BILLING=off`：只计篇数。这是默认值，用于主站计费开通前。
   - `READ_BILLING=paperdaily`：经主站 read-jobs 预扣、结算，需要 `PAPERDAILY_RUNNER_SECRET`、`PAPERDAILY_ASSERTION_SECRET`（各 ≥32 字符，与主站配置一致），缺任一项拒绝启动。
   - 注册用户每周期 `READ_FREE_PAPER_LIMIT` 篇（默认 5），周期 `READ_FREE_PAPER_PERIOD=month|lifetime`；Pro、机构、管理员不限篇数。
   - 被拦下（待确认价格、积分不足、达到篇数）的 PDF 会保留，论文停在 `pdf_pending`，可以调 `POST /papers/{id}/process` 重试。
4. **交互 AI**（问答、划词等）不扣积分，按档位限制每日次数：`READ_CHAT_DAILY_LIMIT_FREE`（默认 50）、`READ_CHAT_DAILY_LIMIT_PAID`（默认 300）。全文翻译已包含在每篇价格里。
5. `PAPERDAILY_SCOPES` 要等主站 read client 开放对应 scope（主站 issue P1）后再设置为 `read:paper read:contrib read:history read:reading write:reading`。提前设置会导致主站拒绝授权请求，所有人都无法登录。在此之前，导入接口返回 403「授权不包含此操作」。
6. 迁移 `0005`：新增 `read_charges` 表，`provider_sessions` 增加 `key_id` 列。主站 token 响应带 `key_id` 后才能签 read-jobs（主站 issue P9）。

## PaperDaily 关联登录（2026-10，R4a）

默认 `RID_MODE=standalone`，行为不变，自托管用户无需处理。只有与 PaperDaily 关联部署（read.paperdaily.org）时才设 `RID_MODE=linked`：

1. 本地注册、密码登录、refresh token 全部关闭，只能「使用 PaperDaily 账号登录」（授权码 + PKCE）。线上格式见 `docs/plans/paperdaily-connect-contract.md`。
2. 必填：`PUBLIC_BASE_URL`（https）、`PAPERDAILY_CLIENT_SECRET`、`PAPERDAILY_TOKEN_KEYS`（`版本:base64(32 字节)`，逗号分隔可轮换）；缺任何一项拒绝启动。可选：`PAPERDAILY_WEB_URL`（授权页站点）、`PAPERDAILY_ADMIN_SUBJECTS`、`PAPERDAILY_WEBHOOK_SECRET`（主站目前不推送）。
3. 本地 JWT 只有 15 分钟，前端凭 HttpOnly 会话 cookie 自动续签，续签时向主站实时核验。读取接受 60 秒内的核验结果，写入/上传/AI 实时核验，主站不可用时返回 503。
4. 主站不下发邮箱，切换前已有的本地账号要用 `scripts/link_paperdaily_account.py --email … --subject <主站 user_id>` 绑定，之后用 PaperDaily 登录即进入原账号（角色与数据保留）。
5. 每 60 秒向主站拉取事件：`grant.revoked` 使会话失效（不删数据）；`account.deleted` 删除该用户在本站的全部数据并留墓碑，拦截之后的登录与写入。

## 视觉模型解析（2026-10，R3d）

1. 新解析器 `vlm`：PDF 逐页渲染后交给视觉语言模型（OpenAI 兼容，如 Qwen3-VL）转写为 Markdown，公式为 LaTeX、表格为 Markdown 表格，并按模型给出的坐标从页面裁出图片。设置 `VLM_MODEL` 即启用并排在解析器首位；`VLM_BASE_URL` / `VLM_API_KEY` 为空时沿用主模型的地址与 Key。
2. 失败页超过 30% 时整体交给下一个解析器（如 GROBID）；单页失败会在正文中标注。`VLM_MAX_PAGES`（默认 80）限制单篇页数。
3. 页面并发由 `LLM_CONCURRENCY_VLM`（默认 4）控制，与翻译、划词分析的通道分开。
4. 新增依赖 PyMuPDF（AGPL，与本项目许可证一致）。

## 持久化任务与用量统计（2026-10，改造计划 R3c）

1. **上传解析、重新分析、翻译改为持久化任务**（`jobs` 表），由应用进程内的 worker 认领执行。服务重启后：本机上一个进程留下的任务立即重新排队；其他主机上的任务在心跳超时（5 分钟）后重新排队；同一任务最多尝试 3 次。翻译重跑时从已完成的分块继续。
2. 多进程 / 多副本部署安全：任务认领是原子的（PostgreSQL `FOR UPDATE SKIP LOCKED`，SQLite `BEGIN IMMEDIATE`），不会重复执行。若只想让部分副本执行任务，在其他副本上设 `RID_WORKER=0`。
3. 每个进程每类任务的并发：解析 2、分析 2、翻译 1。
4. **模型用量统计改存数据库**（`token_usage` 表，按日期、任务、模型累加），并覆盖全部模型调用（原来只统计划词分析和工作台提炼两处）。旧 `data/token_stats.json` 的按日数据在首次启动时导入为「legacy」。管理后台的用量页面接口不变。

## 可插拔解析（2026-10，改造计划 R3b）

1. **GROBID 作为第二个解析器**：设置 `GROBID_URL`（或后台「论文解析」配置）后，没有 MinerU Key 也能解析 PDF。GROBID 保留章节、公式文本、图表标题、脚注与参考文献，**不含图片**，阅读页会注明。
2. **解析器顺序**：`PARSE_PROVIDERS`（如 `mineru,grobid`）。留空时自动：配了 MinerU Key 用 MinerU、失败再用 GROBID；只配 GROBID 就用 GROBID。所有解析器都失败时，错误信息列出每个解析器的原因。
3. **MinerU Key 缺失不再直接让上传失败**（只要配置了其他解析器）。
4. 所有以 `_url` 结尾的配置项都只能由管理员设置（R1 的出站地址保护扩展到 `grobid_url` 等）。

## 统一模型调用（2026-10，改造计划 R3a）

1. **所有模型调用都使用后台/环境变量里的同一套配置**（`LLM_*`、`TRANSLATION_*`、智能分析独立配置）。此前翻译和引用分析只读环境变量、忽略后台配置；`@AI` 与提示词预览读的是另一套 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL`，升级后这三个变量不再使用。
2. **模型配置按触发者取**：用户在设置页填了自己的 API Key，就用自己的 Key；团队成员在别人的论文上使用 AI，不再花论文所有者的 Key（与 R1 的 AI 配额口径一致）。上传后的自动分析仍按上传者。
3. **多端点**：`LLM_BASE_URL`（及翻译、智能分析的地址）可以填多个等价地址，逗号分隔，自动轮询；某个地址连不上或返回 5xx 时自动换下一个，并让它冷却 30 秒。
4. **并发上限**：`LLM_CONCURRENCY_INTERACTIVE`（默认 8，划词分析/对话/@AI）与 `LLM_CONCURRENCY_BATCH`（默认 2，翻译/自动分析/分类/引用分析），每个进程分别计数。与其他服务共用 GPU 时调小批量通道。
5. **`LLM_EXTRA_BODY`**：透传给 OpenAI 兼容服务的额外参数（JSON），例如 Qwen3 关闭思考输出：`{"chat_template_kwargs": {"enable_thinking": false}}`。
6. 自建模型服务不需要 Key 时，`LLM_API_KEY` 可以留空。

## 单一存储（2026-10，改造计划 R2）

1. **论文与工作台改存数据库**：原来的 `data/papers.json`、`data/workbench.json` 在首次启动新版本时自动导入数据库（SQLite 或 PostgreSQL），日志会打印「已导入旧 JSON 存储」。原文件不会被删除，确认无误后可自行归档。手动导入或查看对账报告：`python scripts/db_upgrade.py --reimport`。
2. **数据库结构由 Alembic 管理**：启动时自动升级。旧版本的库（没有版本记录）会先补齐缺失的表、列和索引，再记录为最新版本；原来的 `scripts/migrate_db.py`、`add_quota_fields.py`、`add_prompt_tables.py` 已移除。如需关闭自动升级（例如多副本部署由单独的步骤执行），设 `RID_AUTO_MIGRATE=0` 并运行 `python scripts/db_upgrade.py`。
3. **导入时的归属规则**：论文的 `user_id` 指向已不存在的用户时置空（只有管理员可见）；工作台条目按「条目自身归属 → 来源论文所有者」写入，两者都找不到的条目保留在库中但不显示给普通用户。
4. **重启不再留下「永远在解析中」的论文**：启动时，停在中间状态超过 60 分钟的论文，有正文的恢复为可读，没有正文的标为失败（可点「重新分析」）；进行中的翻译标为失败，重新翻译会从已完成的分块继续。
5. **新增依赖**：`alembic`、`psycopg[binary]`（PostgreSQL 同步驱动）。使用 Docker 镜像的用户无需处理。
6. **时间统一为 UTC**：接口返回的时间带时区偏移，前端按本地时区显示。

## 安全基线（2026-10，改造计划 R1）

1. **必须设置 `SECRET_KEY`**：为空或仍是示例值时后端拒绝启动（`DEBUG=true` 只警告）。`docker-start.sh` / `docker-deploy-ghcr.sh` 会自动为默认值生成随机密钥。更换密钥会让所有人重新登录，旧的图片签名链接失效（刷新页面即可）。
2. **所有接口都要求登录**：翻译、图谱、作者、分类、任务进度、工作台等之前可匿名调用的接口，现在未登录返回 401，访问他人论文返回 403。公开的只有注册/登录、套餐说明、分享链接和签名图片。
3. **工作台按用户隔离**：原来全站共用一个工作台。升级后每人只看到自己的条目；旧条目按其来源论文的所有者归属，没有来源论文的旧条目只有管理员可见。
4. **`/uploads` 不再公开**：论文图片改由 `/api/v1/files/images/...` 提供，链接带签名、约 24 小时有效，由返回论文正文的接口自动生成，存量数据无需迁移。使用自带 nginx 配置的部署请同步 `frontend/nginx.conf`（`location ^~ /api`）。
5. **用户默认不能自定义服务地址**：设置页中的 LLM / MinerU 服务地址只能由管理员在系统配置里设定，用户仍可填写自己的 API Key。需要恢复旧行为时设 `ALLOW_USER_ENDPOINTS=true`，此时仍会拒绝内网与保留地址。之前用户保存的地址在未开放时不生效。
6. **没有所有者的旧论文只有管理员可见**（旧版本把它们当作公开）。
7. **AI 配额扣在调用者身上**：之前按论文所有者扣，团队成员使用 AI 会消耗所有者的配额。


## Research bridge（2026-10-27，未部署）

迁移保留 R6 `0005_read_charges`，随后执行 `0006_research_bridge`。新 `/research` 私有比较与发布回执、Reader 正式问题快照使用这批表；不要覆盖旧 migration 或清空阅读数据。

`/open` 保留多篇/合集/综述入口，新增逐篇显式导入主站可转移 Markdown 的操作。它复用 canonical 题录 upsert，不启动 PDF parse/read-job。没有资源则仍通过原 `PaperIntakeActions` 为同一题录补传 PDF，价格确认、hold/runner 与原始 gates 保留。

PaperDaily 配套为 [PR #179](https://github.com/alonegg/new_paperdaily/pull/179)，候选 v2.20.0：其 migration 218 须先于 selected-passages 写入。新研究 scope 必须经真实 client policy 配置及用户明确同意；空 scope 登录不自动增权。资源仍受许可、e2/e3、容量和授权开关限制。本轮不配置或启用生产的 billing/runner，也不扩大 R6 其他 API 权限。

完整验收及边界见 [研究桥接实施记录](../plan/2026-10-27-research-bridge-implementation.md)。
