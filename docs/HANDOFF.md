# Read it DEEP（RiD）交接说明

最后更新：2026-10-28。接手的人或 agent 先读本文，再按「文档地图」看细节。

## 1. 仓库与协作规则

- 代码：`github.com/oMygpt/readitdeep`，**公开仓库**，默认分支 `main`。
- 只通过 PR 合入 `main`，CI（`.github/workflows/test.yml`：ruff + pytest，SQLite / Postgres 双矩阵）全绿后合并；合并后删除分支。
- 分支前缀：`claude/*`（Claude）、`codex/*`（Codex）。`multi-user` / `single-user` 是开源上游的历史分支，保留不动。
- 公开仓库里**不放**：密钥、内网地址、主机名、账号 ID。生产配置和运维脚本在私有运维仓库 dslab-ops（`just readitdeep-*`），密钥只在其 SOPS 保险库。
- 跨仓库改动不直接改对方代码：主站（`alonegg/new_paperdaily`）和 ask（`alonegg/paperdaily-ask`）的需求写成 issue，由各自 agent 开 PR，RiD 侧审查并对齐联调。
- 身份关联只认主站 `subject.sub`，不按邮箱关联。

## 2. 产品定位（一句话）

PaperDaily（主站）只有论文元数据；用户在主站 / ask 搜索、收藏论文、合集、综述后，进 RiD 上传或获取 PDF 做深读、分析、翻译和组内共享。RiD 是系列站：账号、积分、档位都在主站，RiD 只在**真正处理 PDF 时**按篇扣主站积分。

## 3. 文档地图

| 文档 | 内容 |
|---|---|
| `docs/plans/2026-10-25-refactor-design.md` / `-plan.md` | R0–R5 改造设计与计划（安全、单一存储、可插拔模型/解析、任务队列、关联登录） |
| `docs/plans/2026-10-27-series-site-quota-config-design.md` | R6 系列站设计 v0.2：题录/PDF 分离、按篇计费、配置分层、深链 |
| `docs/plans/2026-10-25-refactor-todo.md` | **总 TODO**，每项带 PR 号；未完成项见第 7 节 |
| `docs/plans/2026-10-25-refactor-acceptance.md` | 验收证据（测试、实测、生产读回） |
| `docs/plans/paperdaily-connect-contract.md` | 与主站的登录/授权契约 |
| `docs/plans/requests/2026-10-27-{paperdaily,ask}-requests.md` | 给主站（P1–P11）、ask（A1–A3）的改动请求原文 |
| `plan/2026-10-27-*.md` | Codex 的研究阅读重构评审、阅读器 UI、研究桥接、25 分计费可靠性修复记录 |
| `docs/UPGRADING.md` | 自托管升级时的行为变化（按版本倒序） |
| `.env.example` | 全部环境变量及说明 |

## 4. 架构要点

- 后端 FastAPI（`backend/app`），前端 React + Vite（`frontend/src`），数据库 Postgres（开发可用 SQLite），Alembic 迁移 `0001`–`0007`。
- **两种模式**（`RID_MODE`）：
  - `standalone`：开源原版行为，本地账号，管理员 + 个人配置都可改模型和 Key。
  - `linked`：生产（read.paperdaily.org）。只能用 PaperDaily 账号登录（授权码 + PKCE，`app/services/paperdaily/`），本地 JWT 15 分钟，续签时向主站实时核验。
- **配置分层**（`app/core/config_policy.py`）：linked 下 Key / 地址只来自部署层环境变量；管理员只能在 `ALLOWED_MODELS` 里为各任务选模型；用户只能改偏好（目标语言、译文风格、术语表、解析质量、自动翻译，`/api/v1/preferences`）。
- **题录与 PDF 分离**（`app/api/v1/intake.py`、`app/services/pdf_intake.py`）：从主站导入论文 / 合集 / 综述免费，论文状态 `metadata`；补传 PDF、抓取开放获取 PDF（`OA_PDF_HOSTS` 白名单）后才计费。深链入口 `/open?paper=…|collection=…|review=…`（`frontend/src/pages/OpenPage.tsx`）。
- **按篇计费**（`app/services/billing.py`，表 `read_charges`）：同一用户同一 PDF（sha256）只扣一次，覆盖解析、全文翻译与分析。
  - `READ_BILLING=paperdaily` 时走主站 read-jobs：hold → claim → heartbeat → complete，请求带 client assertion 与 preflight HMAC 签名；租约丢失立即停止处理。
  - 注册用户每月 `READ_FREE_PAPER_LIMIT`（5）篇；Pro、机构、管理员不限篇数，只受积分约束。
  - 问答、划词等交互 AI 不扣积分，按档位限每日次数。
- **任务队列**（`app/core/jobs.py`）：`jobs` 表 + worker，重启续跑。每类并发由 `JOBS_{PARSE,ANALYZE,TRANSLATE}_CONCURRENCY` 配置（0 = 默认 2/2/1）；关联计费时解析并发不应超过主站 `read.bridge.concurrency`。
- **模型**：全部用校内推理 API。视觉模型（Qwen3-VL）逐页转写 PDF（OCR / pdf2md），GROBID 作回退；翻译与分析用 Qwen3.6-35B-A3B。多端点故障转移、交互 / 批量 / VLM 三个并发通道（`LLM_CONCURRENCY_*`）。
- **研究阅读**（Codex，`research.py`、`reading_workspace.py`，迁移 `0004`、`0006`）：研究问题、证据、主站允许转移的全文资源（需 `read:resources` scope）。

## 5. 本地开发与测试

```bash
cd backend && uv sync --extra dev
uv run ruff check --select E9,F63,F7,F82 app tests scripts migrations
uv run pytest -q                     # 设 RID_TEST_DATABASE_URL 可跑 Postgres 矩阵
cd ../frontend && npm ci && npm run build
```

计费测试用模拟主站（`tests/test_series_billing.py`），共享签名夹具与主站同一份协议向量（TEST-ONLY 价格，不是生产价格）。

## 6. 生产部署（只记流程，细节在运维仓库）

- 生产与主站同机，独立 Postgres 容器与 Ceph RBD 卷，每日备份到 RGW（30 天）。
- 当前发布布局由 Codex 维护（发布目录 + 按 git SHA 打的镜像，`RID_REF` 指定版本，env 来自保险库条目 `readitdeep.env`）。**运维仓库里旧的 `readitdeep-env-render` / `readitdeep-deploy` 已检测到新布局即拒绝执行，不要绕过**，否则会覆盖生产 env。
- 发布顺序：PR 合并 → 固定 main SHA 构建镜像 → 先改主站能力 / 配置，再改 RiD env → 重建 backend → 健康检查与读回。
- 构建机访问 GitHub / PyPI / Debian 官方源不稳定：`backend/Dockerfile` 支持 `APT_MIRROR`、`PIP_INDEX_URL` 构建参数；代码可用 git bundle 传到主机。
- 回滚：主机上保留上一版镜像与 env 备份；主站 read 准入参数有只改 RiD 键的 check/apply 脚本（运维仓库 `readitdeep-pd-read-budget.py`）。

### 当前生产状态（2026-10-28）

- 2026-10-28 PR #25/#27 发布后，运行镜像为 `525ab528818e0a819aa854c576ec6b10918c55c3`，包含 #21/#22 与深链直达知识库/OA获取/来源链接及入口缓存修复，迁移仍为 `0007`，`READ_BILLING=paperdaily`，每篇 25 积分（主站 `read-per-pdf-25-v1`）。
- 所有已验证主站账号可用；机构成员档位为 institution（每日 300 积分）；注册用户每月 5 篇。
- 并发：VLM 4、批量（翻译）4；主站 read.bridge 并发 4。2026-10-28 主站 v2.22.6 已开启 campus_count_only：read 只做独立日计数，不占全站/个人合成预算，也不按日资源数量拒绝。25积分/PDF、注册用户月5篇及单作业资源上界继续执行。旧的20000日资源配置保留用于 shared 模式兼容，当前不作为 read 日资源硬限制。
- #21（研究授权保留默认 scope、主站全文论文可翻译）和 #22（任务并发可配置）已有联合发布回执。解析并发 4 的配置及构造逻辑已核验；分析/翻译任务默认并发仍为 2/1。有效环境已保存到加密保险库，运维 PR #1 已合并。此处修正交接文档遗漏，不代表 2026-10-28 重新部署或完成压力验收。

## 7. 未完成事项与负责方

| 事项 | 负责 | 说明 |
|---|---|---|
| 发布 #21 + #22 | 已完成，2026-10-27 联合发布回执 | 镜像 `3da5e97`；有效环境回存加密保险库，运维 PR #1 已合并。详见验收补记；无需重复部署 |
| 主站 P11：`source=read` 不计入全站 / 个人合成预算 | 已完成，2026-10-28 主站 v2.22.6 | 独立计数模式已上线，实际数据库事务验收通过；没有重跑真实PDF/模型验收，R6.7仍单列 |
| ask A1–A3：搜索卡片、导出综述加「到 RiD 深度阅读」 | ask agent（ask issue #16） | PR 落地后 RiD 侧按深链契约联调 |
| R4a.8 撤销链路生产验证 | RiD | 退出登录 → 主站 grant.revoked → 本站会话失效；主站推送 worker 上线后验证推送 |
| R6.7 生产全链路验收 | RiD | 注册与 Pro 测试账号各走一遍导入 → 上传 → 扣费 → 主站 ledger 对账 |
| 观察注册用户用量 | RiD | 上线一周后看处理量与排队时间，再决定是否收紧免费篇数 |
| R4d context-bundle、阅读记忆回传 | 待排期 | 依赖主站 E4e |


PR #25/#27上线回执与正确性边界见 `docs/plans/2026-10-28-pr25-review.md`。自动OA批次在部分导入失败/OA失败时保留错误，取消后停止后续篇目，离开页面后不再确认/启动处理。旧标签页可能需要刷新一次，后续入口显式要求重新校验。
