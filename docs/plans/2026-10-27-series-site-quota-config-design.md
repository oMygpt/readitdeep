# RiD 作为 PaperDaily 系列站：来源、额度与配置 — 设计 v0.2

日期：2026-10-27　状态：**v0.2 已按用户第二轮决定修订**；§8 两项小决定在执行中按默认值推进，可随时改。
关联：主站设计 v2.2 §2.2/§4/§5，本仓库 `2026-10-25-refactor-design.md` §2.7，主站 issue（P 项）、ask issue（A 项）。

## 0. 用户决定

**第一轮（2026-10-27）**
1. 主站基本没有全文，只有论文的详细元数据。用户在主站或 ask 检索、保存论文、合集、综述后，进入 RiD 精读、分析，并与组内成员共享。
2. 主站 Pro 和机构用户能用每天 300 积分做解析和翻译；注册用户也能用，但限 5 篇。
3. 开源版的解析和翻译是「管理员配置 + 个人配置」都能用。成为 PaperDaily 系列站后，要重新设计最佳配置方式。

**第二轮（同日）**
4. **篇数在 RiD 计算**，积分在使用后同步给主站。
5. **论文数据和 PDF 分开**。用户可以先把题录从 ask 或主站带过来，不花积分；**真正上传 PDF 时才消耗积分**。
6. **积分按 PDF 篇数计算**：每篇固定价格，不按页计，也不按操作计。
7. 部署层面，解析、翻译、OCR 都用校内模型。VLM 负责 pdf2md 的 OCR。
8. 主站和 ask 需要改的部分，由我写文档、提 issue，各自的 agent 开 PR，完成后与我对齐。ask 的改动是在搜索结果的论文卡片上、以及导出综述论文的地方，加「到 RiD 深度阅读」按钮。

## 1. 结论摘要

| 问题 | 方案 |
|---|---|
| 题录与全文 | 题录随时免费导入（单篇、批量、主站收藏/合集、综述引文）。全文要由用户上传 PDF，或在用户点击后从开放获取来源抓取；这一步才计费 |
| 计费单位 | **每个用户每个 PDF（按内容 SHA-256）计费一次**，价格为 `P` 分（候选 30 分），覆盖这篇的 OCR/解析、全文翻译和自动分析。同一篇重新解析、换语言翻译、问答都不再扣分 |
| 篇数 | RiD 用 `read_charges` 表计数，每个用户每个 PDF 内容记一行，同一篇只算 1 篇。注册用户上限 5 篇（周期见 §8，默认每自然月）；Pro、机构、管理员不限，只受积分约束 |
| 同步主站 | 用主站已有的 `read-jobs`：上传时预扣（hold），RiD 作为受信 runner 解析完成后提交 `complete`，主站结算；失败或取消时全额冲正。主站不收 PDF |
| 模型 | 部署层固定用校内 API：VLM（Qwen3-VL-32B）做逐页 OCR/pdf2md；主 LLM（Qwen3.6-35B-A3B）做翻译和分析；GROBID 兜底。外部云默认关闭 |
| 配置分层 | 部署层（保险库，只有运维能改）→ 站点运营层（管理员只选模型和开关，不填 key）→ 用户层（只有偏好）。linked 模式不开放自带 key；开源独立模式保持原样 |
| 组内共享 | 组员阅读共享论文不扣分、不占篇数；组员要把同一份 PDF 收进自己的库并处理时，按自己的一篇计 |

## 2. 闭环

```
ask 搜索卡片 / ask 导出综述论文 / 主站论文页 / 主站收藏与合集 / 综述历史
        │  https://read.paperdaily.org/open?paper=…（可重复）| ?collection=… | ?review=…
        ▼
RiD：导入题录 → status=metadata（免费，可批量，幂等）
     ├─ 用户上传 PDF ┐
     └─ 用户点「获取开放获取 PDF」（白名单域名） ┘→ 计费确认（P 分；注册用户显示已用 n/5 篇）
        → 主站 read-job hold → 解析（VLM OCR → GROBID 兜底）→ 自动翻译（偏好）→ 分析
        → complete → 主站结算 → ready
     → 精读、批注、问答、工作台 → 共享给小组（阅读免费）
     → 可选：阅读记忆回传主站（不回传全文或译文）
```

## 3. 题录与 PDF 分离（RiD 数据模型）

- 论文新增状态 `metadata`：只有题录（标题、作者、摘要、DOI、arXiv id、主站 paper_id、来源链接），没有文件。
  - 列表和详情页清楚显示「仅题录」，并提供两个按钮：「上传 PDF」「获取开放获取 PDF」（后者只在有可用链接时出现）。
- 字段 `source_provider='paperdaily'`、`source_id=<主站 paper_id>` 已经存在（迁移 0001）。导入按 `(user_id, source_provider, source_id)` 幂等。
- 给已有论文补 PDF：`POST /api/v1/papers/{id}/pdf`（multipart）。新上传、不带题录的 PDF 沿用 `POST /papers/upload`，两者走同一条计费 + 解析路径。
- 开放获取抓取：`POST /api/v1/papers/{id}/fetch-pdf`。
  - 只在服务端抓取，域名白名单（部署层 `OA_PDF_HOSTS`，默认 `arxiv.org,export.arxiv.org`）。
  - 复用 `url_guard`：禁内网地址，限制 3 次重定向；限制 ≤50 MB，必须是 PDF（看 magic bytes）。
  - arXiv 的 abs 链接改写为 pdf 链接。
- PDF 内容哈希、页数、字节数在保存时计算，存进论文的 `extra.pdf`，作为计费和缓存身份。

## 4. 计费

### 4.1 规则

- **计费事件**：某用户第一次为某个内容哈希启动处理（上传或抓取后进入解析）。
  - 以下情况不计：同一用户重复上传同一文件、重新分析、重新翻译。
  - 同一份 PDF 被同一用户挂到另一条题录上，也不再计（按用户 + 哈希去重）。
- **价格**：主站 `credits.rules.read_jobs.prices["read.parse"] = {base_credits: P, per_page_credits: 0, …}`。RiD 不写死价格，以主站报价为准，并缓存最近一次的价格和版本供界面显示。
- **篇数上限**：
  - 注册用户每周期 5 篇，周期由部署配置 `READ_FREE_PAPER_LIMIT=5`、`READ_FREE_PAPER_PERIOD=month|lifetime` 决定。
  - Pro、机构、管理员不限篇数。档位按主站 `/me/entitlements` 判定（主站 issue P5 提供稳定的 `plan_tier`；在此之前退而读 `limits["credits.daily_grant"].source` 的前缀 `plan:`、`institution:`）。
  - 失败或冲正的作业不占篇数。
- **其余 AI**（问答、划词翻译、解释、工作台提炼）不扣积分，由 RiD 按用户限速：部署配置 `READ_CHAT_DAILY_LIMIT`，默认注册 50 次/天、付费 300 次/天。

### 4.2 与主站同步（read-jobs，已在主站实现）

| 步骤 | RiD | 主站 |
|---|---|---|
| 1 预检 | 算出 sha256、页数、字节数，用 runner 密钥对 `read-preflight-v1` 回执做 HMAC 签名（signer=`rid`，15 分钟有效） | — |
| 2 建作业 | 用户在场时，用其委托 key（Bearer）加 client assertion（`X-Read-Actor: read`，HMAC 覆盖 method/path/body 摘要/时间戳/nonce），带 `Idempotency-Key=sha256(user\|content)` 调 `POST /api/v1/me/read-jobs` | 核验权益与价目，预扣积分（hold），返回 `job_id` |
| 2a 报价变化 | 409 `read_quote_confirmation_required` → 论文标记为 `awaiting_confirmation` 并显示新价，用户确认后重试 | — |
| 2b 余额不足 | 402 → 论文停在 `metadata` 态，显示「今日积分不足，明天补发」 | — |
| 3 执行 | 后台 worker 调 `claim` 拿到 fence，每 30 秒 `heartbeat`，收到 `stop: true` 就中止 | 并发闸门、租约 |
| 4 结算 | 解析成功 → `complete{status: succeeded, output_sha256, …}`；失败 → `failed` | 成功则结算，失败则全额冲正 |
| 5 对账 | `read_charges` 记录 `pd_job_id`、状态、价格版本；启动时和每 5 分钟补交未完成的 complete | unknown 超过 15 分钟报警 |

- 「使用后同步」的实现方式：上传时只是**预扣**，解析成功后才**结算**为消耗；失败退还。之所以先预扣，是因为主站规则不允许事后出现负余额（主站 §5.3）。
- 自动翻译与分析算在同一篇的价格里，不另建作业。
- 部署开关 `READ_BILLING`：
  - `paperdaily`：linked 模式的正式值；主站门槛未开时返回 503「精读计费尚未开通」。
  - `off`：不计费。用于独立模式，以及主站计费开通前的白名单内测。目前只有站长一人，且主站对管理员本来就零扣费。
- 独立模式：沿用 RiD 自带 `PLAN_LIMITS`，不接主站。

## 5. 配置分层

| 层 | 谁改 | 存在哪 | 内容 |
|---|---|---|---|
| **部署层** | 运维（`just readitdeep-env-render`） | 保险库 → `.env` | 校内模型端点和 key：`LLM_*`、`VLM_*`、`TRANSLATION_*`、`EMBEDDING_*`、`GROBID_URL`；`PARSE_PROVIDERS=vlm,grobid`；`ALLOWED_MODELS`；`OA_PDF_HOSTS`；`READ_BILLING`；`READ_FREE_PAPER_*`；`READ_CHAT_DAILY_LIMIT`；MinerU 云为空（即关闭） |
| **站点运营层** | RiD 管理员 | `system_configs`，只存非密钥字段 | 每个任务（翻译、问答、分析、各类 smart_*）从 `ALLOWED_MODELS` 里选模型；解析器顺序只能在部署层已配置的解析器中调整；单篇页数上限；功能开关 |
| **用户层** | 用户本人 | `user_configs`，键名白名单 | `translate_target_lang`（默认 zh）、`translate_style`（literal/fluent）、`glossary`（≤200 条）、`parse_quality`（vlm/fast）、`auto_translate`（默认开） |

规则（只在 linked 模式下生效）：
- `ConfigManager` 忽略数据库里所有 `*_api_key`、`*_base_url`、`*_api_url`、`*_url` 的值（系统级和用户级都忽略），只用部署层。
- 用户配置只认白名单里的偏好键；系统配置里的模型名必须在 `ALLOWED_MODELS` 内，否则忽略并告警。
- 写接口同样拒绝：`PUT /auth/config` 与管理员配置接口收到上述键时返回 400「由部署配置」。前端隐藏 key 和地址输入框，改为只读展示「由部署配置：校内模型 xxx」。
- 价目一致性：管理员换模型不影响主站的「每篇 P 分」价目，因为价格只与篇数有关，不与模型绑定。容量变化由运维评审。

## 6. 组内共享

- 小组现在用邀请码加入（`POST /teams/join/{code}`），linked 模式直接可用，不依赖邮箱。
- 主站 token 不下发显示名，组员目前都显示为「PaperDaily 用户」。主站 issue P8 请求下发显示名；在此之前允许用户在 RiD 设置自己的昵称。
- 共享论文时，组员阅读原文、解析、译文、公开批注都不扣分、不占篇数。

## 7. 主站与 ask 的配合（另见各自 issue）

**主站（P 项）**：
- P1：read client 授权上限加入以下操作（含新 scope，需用户重新同意）：
  - 权益、余额；
  - `get_paper`；
  - 收藏、个人库、合集列表与按合集筛选；
  - 综述历史与详情；
  - read-jobs 的创建、状态、取消。
- P2：read client 支持 `allow_verified_accounts`，即开放给所有已验证账号，不再只是白名单。
- P3：开启 read-jobs，按篇定价：只用 `read.parse`，`base_credits=P`，`per_page=0`；配置 runner `rid` 与 client assertion 的密钥、四个门槛、正数上限、资源预算。
- P4：确认「hold → complete 结算」满足「使用后同步」。
- P5：权益返回稳定的 `plan_tier`。
- P6：主站论文页、收藏页、合集页、综述历史加「到 Read it DEEP 深度阅读」按钮。
- P7：部署 read 推送 worker。
- P8：可选，下发显示名。

**ask（A 项）**：
- A1：搜索结果论文卡片加「RiD 深读」按钮。
- A2：导出菜单（当前列表）和深度综述引文处加「到 RiD 深度阅读（N 篇）」。
- A3：链接格式见下面的深链契约。

### 深链契约 v1（RiD 实现，主站和 ask 只拼链接）

```
https://read.paperdaily.org/open?paper=<主站 paper_id>[&paper=<id2>…最多 50]&from=ask|daily|library|review[&title=<批次名，≤100 字>]
https://read.paperdaily.org/open?collection=<主站合集 id>&from=library
https://read.paperdaily.org/open?review=<主站 query_history id>&from=ask|daily
```

- paper_id 原样做 URL 编码，可以含 `/` 或 `:`。
- 一篇时导入后直接打开这篇论文；多篇时建一个以 `title` 命名的 RiD 文件夹，并打开列表。
- 未登录先走 PaperDaily 登录，回来后继续导入。
- 链接里不得携带任何 token；RiD 一律用服务端委托 key 回主站取题录，不信任链接里的标题或元数据（`title` 只用作文件夹名）。

## 8. 小决定（按默认值推进，可改）

| # | 问题 | 默认 |
|---|---|---|
| D1 | 注册用户 5 篇的周期 | 每自然月（北京时间），部署配置可改为 `lifetime` |
| D5 | 每篇价格 P | 候选 30 分：Pro 和机构每天约 10 篇；注册用户每天 100 分，同时受 5 篇上限约束。主站上线前由你签字定版 |

（v0.1 的 D2 已由「按篇计费、上传才扣」取代：注册用户同样按篇扣分。D3「首发不开放自带 key」和 D4「GROBID 快速解析」并入 §4、§5：快速档同样按篇计，`parse_quality=fast` 只表示少用 GPU。）

## 9. 计划

| 阶段 | 内容 | 依赖 |
|---|---|---|
| S1 配置分层 | ConfigManager 的 linked 规则；写接口拒绝；`ALLOWED_MODELS`；用户偏好键与翻译提示词接入（目标语言、风格、术语表）；前端只读展示 | 无 |
| S2 题录与 PDF 分离 | `metadata` 状态；主站题录导入服务（委托 key 调 `get_paper`）；`/papers/{id}/pdf`、`/papers/{id}/fetch-pdf`；PDF 哈希、页数 | 导入依赖 P1 的 `get_paper`；其余无依赖 |
| S3 计费 | `read_charges`（迁移 0004）；篇数与周期；`READ_BILLING`；主站 read-jobs 客户端（assertion、preflight、create、claim、heartbeat、complete、对账）；402/409 状态；问答限速；停用 linked 下的本地 `PLAN_LIMITS` | P3、P5 联调；代码与模拟主站测试先行 |
| S4 深链与主站库 | `/open` 页面（paper/collection/review）；「从 PaperDaily 导入」面板（收藏、合集、综述）；批量文件夹 | P1 |
| S5 前端计费体验 | 上传前显示「本篇 P 分 · 今日剩余 X · 本月 n/5 篇」；`metadata` 卡片；`awaiting_confirmation`；余额不足提示；昵称设置 | S3 |
| S6 验收 | 注册与 Pro 测试账号各走一遍：ask 卡片 → `/open` → 题录 → 上传 → hold → 解析 + 翻译 → 结算 → 第 6 篇被拒 → 组员阅读不扣分；与主站 ledger 对账 | 全部 |
