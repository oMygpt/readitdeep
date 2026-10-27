# Read it DEEP 改造验收

每个阶段的验收标准与证据。证据写明日期、提交、命令与结果摘要；失败如实记录。

## 通用（每个 PR）
- `pytest` 全绿，CI 通过；
- 独立模式回归：`docker compose up` 冷启动，注册 → 上传（打桩或真实 MinerU）→ 阅读 → 工作台 → 翻译入口可用；
- 不引入新的无鉴权路由（R1.3 清单测试）。

## R0
| 项 | 标准 | 证据 |
|---|---|---|
| 数据移除 | HEAD 中不存在 `backend/data/*.json`；`.gitignore` 生效 | 2026-10-25 R0 PR：`git rm` 删除 backend/data、jiejian、一次性脚本；`.gitignore` 增 `backend/data/`、`/data/`。原数据另存本机私有目录供 R2 迁移演练，不入库 |
| 历史清除 | `git log --all -- backend/data` 为空；GitHub 上旧 blob 链接 404 或已请求清除缓存 | 2026-10-25：先做完整 mirror 备份（本机 `readitdeep-mirror-backup-20261025`，含原数据，不外传）；`git filter-repo --invert-paths --path backend/data/` 重写 main / multi-user / single-user 并强制推送；三个分支的最终文件树与重写前逐一比对一致（main 树哈希相同）。仓库 .git 由 116MB 降到 1.1MB。旧 raw 链接已 404。**未尽事项**：GitHub 的 PR 引用（#1、#2）和 1 个 fork（htynkn/readitdeep，2026-01-10 之前 fork，含数据）仍保留旧对象，API 仍能按旧 SHA 查到提交；彻底清除需仓库所有者向 GitHub Support 提交敏感数据清除请求，fork 需联系其所有者 |
| 测试地基 | `uv run pytest` 在干净环境可跑，CI 有 test job | 2026-10-25 本地 `uv run pytest -q` → 9 passed（认证 4、论文上传/访问/列表 5）；CI 结果见 R0 PR |

## R1
| 项 | 标准 | 证据 |
|---|---|---|
| 鉴权矩阵 | 每条论文相关路由：未登录 401、他人 403、所有者 2xx（参数化测试） | 2026-10-25 `tests/test_access_matrix.py`：8 条读路由 × (匿名/他人/所有者/管理员)、4 条写路由、团队成员可读不可改、无主论文仅管理员、任务列表/标签/工作台按用户隔离、旧工作台条目归属回落；`tests/test_route_auth_inventory.py` 遍历全部路由，未在公开清单中的无鉴权路由即失败 |
| 文件 | `/uploads/...` 不再可访问；新文件路由同样遵守鉴权矩阵 | `tests/test_files.py`：静态挂载已移除（404）；正文中的图片链接被改写为签名地址并可取回；篡改签名、过期、挪用到其他论文均 403；`..` 文件名拒绝 |
| 启动检查 | 默认 secret 时非 debug 启动失败 | `tests/test_security_settings.py`：空/示例/过短密钥抛错，debug 只警告；部署脚本自动生成随机密钥 |
| SSRF | 普通用户无法设置端点地址；开关打开时内网地址被拒 | 同上：默认 403、仍可只填 key；开关打开时 127/10/192.168/169.254/::1 与非 http(s) 被拒（保存与测试接口都拦）；已存的用户地址在未开放时不生效 |

## R2
| 项 | 标准 | 证据 |
|---|---|---|
| 迁移演练 | 用历史 `papers.json`（45 篇）/`workbench.json`（620 条）副本迁移，条数、正文长度逐条一致，二次运行无变化 | 2026-10-26 本机私有副本演练（不入库）：45 篇全部插入，逐字段比对 0 差异（1 篇旧数据标签为 JSON 字符串，读出为列表，属预期修正）；620 条工作台全部插入，字段 0 差异，355 条有归属、265 条无主（151 条来源论文已不在 JSON 中，其余来自 7 篇无主论文）；第二次导入 0 插入、全部覆盖、内容 0 变化。真实启动流程（uvicorn + 旧 papers.json）自动建库并导入 45 篇。CI 中以合成数据跑同样断言（`tests/test_data_import.py`） |
| 并发 | 两个 worker 并发上传/编辑工作台不丢数据 | `tests/test_store.py::test_concurrent_processes_do_not_lose_updates`：两个独立进程各对同一论文的不同字段写 30 次，两个字段都保留最终值（修复前 SQLite 下会丢）；旧快照覆盖场景 `test_update_merges_and_does_not_clobber` |
| 重启恢复 | 解析中途重启后任务继续或明确失败，不卡在 parsing | `test_recover_stuck`：超时的中间状态按有无正文恢复为 completed / failed，翻译标为 failed，未超时的不动。持久化续跑并入 R3.4 |

| 迁移体系 | 空库升级后与模型一致；旧库补齐后 stamp | `tests/test_migrations.py`：空库 `upgrade head` 后 autogenerate 对比 0 差异；模拟旧库（缺 2 表、5 列、1 索引，含存量用户）升级后无缺失且数据保留，再次升级无报错 |

| PostgreSQL | 关联部署用 PostgreSQL，同一套测试必须通过 | 本机 PostgreSQL 17 与 CI postgres:16 均 65 passed（含空库迁移一致性）。期间发现并修复原有隐患：数据库读出的带时区时间与 `utcnow()` 比较在 PostgreSQL 上抛 TypeError（团队邀请、会员到期、邀请码、分享链接、配额重置），会话时区固定 UTC 并统一 `as_utc()` |

R2 测试：SQLite 64 passed + PostgreSQL 65 passed（CI 矩阵）。

R3 测试：SQLite 92 passed + PostgreSQL 93 passed。

## R3
| 项 | 标准 | 证据 |
|---|---|---|
| GROBID | 无 MinerU key 时可用 GROBID 完成解析 | `tests/test_parsing.py`：TEI → Markdown 结构（分级标题、公式编号、图表与表格、脚注、致谢、原始引文优先的参考文献）、解析器顺序默认值、MinerU 失败回退 GROBID、全部失败逐个列出原因、GROBID HTTP 调用、上传流水线端到端 `parser=grobid`。校内实测见下 |
| LLMPool | 一个端点故障时请求转移；并发上限生效 | R3a `tests/test_llm.py`：连接失败转移并冷却、5xx 重试且最后一个端点的 5xx 原样返回、批量通道 2 个在途时交互通道不受影响、流式响应在流关闭前占用名额、经 OpenAI SDK 真实请求格式走故障转移；配置解析（翻译/智能分析专用地址不借主 Key）。2026-10-26 校内实测：`LLM_BASE_URL=10.6.64.13:8999(关闭端口),10.6.64.14:8000`，首个地址失败后自动转到 .14，Qwen3.6-35B-A3B 1.16 秒返回 |
| 实测 | 一篇 arXiv 论文解析/翻译/提炼耗时记录 | 2026-10-26，本机起服务，`GROBID_URL=10.6.64.6:8070`，`LLM_BASE_URL`=4 台 vLLM（Qwen3.6-35B-A3B，`enable_thinking=false`），批量并发 2，论文 arXiv 1706.03762（2.2MB，15 页）：GROBID 解析约 7s（单独调用 10.8s），产出 39k 字 Markdown；自动分析（速读摘要 + 方法/资产提炼）约 59s；分类 4s；上传到可读共 70s。全文翻译 14 个分块顺序执行 152s，译文 20.7k 字，公式还原为 LaTeX，无思考内容泄漏，服务日志无错误。已知限制：该论文 GROBID 识别的标题混入了首页版权声明（GROBID 自身问题）；GROBID 结果不含图片 |
| 任务队列 | 重启后排队与运行中的任务继续；多进程不重复执行 | `tests/test_jobs.py`：同类任务去重、两个独立进程并发认领 20 条任务每条恰好一次、心跳超时重排与 3 次后放弃并标记论文、处理函数崩溃标记失败、worker 按类型限并发、上传/重新分析/翻译入队、本机孤儿任务启动即接管（含容器重启 pid 复用）。2026-10-26 校内实测：翻译进行到 4/14 时 `kill -9` 进程，重启后日志「Requeued 1 jobs」，从第 5 块续译，118 秒完成 14/14 |
| 用量统计 | 多进程累加不丢；覆盖全部模型调用 | `tests/test_token_usage.py`：累加与旧接口结构一致、流式 usage_metadata 与非流式 llm_output 都能记、旧 JSON 只导入一次、每个模型实例都挂了统计回调且开启流式用量 |
| 视觉解析 | 公式、表格、图片可用；失败可回退 | `tests/test_parsing_vlm.py`。2026-10-26 校内 API（`10.9.254.83`，Qwen3-VL-32B-Instruct 解析 + Qwen3.6-35B-A3B 分析）实测 arXiv 1706.03762：15 页视觉解析 24s，标题正确，42k 字，6 张图裁出且位置准确，公式为 LaTeX；上传到可读共 48s。模型对比（同一 3000 字分块翻译）：Qwen3.6-35B-A3B 3.5s、Qwen3.8-27B 3.4s、DeepSeek-V4-Flash 16s、GLM-5.2 35s、Qwen3.8-Flash-Next 73s |
| 容量参考 | — | 单篇论文完整流程约 20 次模型调用、3.7 分钟（其中翻译 2.5 分钟）。批量通道 2 并发时单进程约每小时 30–40 篇「上传 + 分析」，翻译另计；与入库抽取共用 GPU 时建议保持批量并发 ≤2 |

## R4a 关联登录（RiD 侧）
| 项 | 标准 | 证据 |
|---|---|---|
| 登录链路 | 授权码 + PKCE S256；state 绑定浏览器 cookie；return_to 只接受站内相对路径 | `tests/test_paperdaily_linked.py`（按契约实现的模拟主站）：完整登录与重复登录复用账号、换浏览器的回调被拒、PKCE 篡改与用户拒绝、return_to 绕过样例（`//host`、编码、反斜杠、控制字符）全部回落 `/` |
| 本地登录关闭 | linked 下注册、密码登录、refresh 均 403 | 同上 |
| 核验 | 读 60 秒缓存、写实时；主站不可用 503；auth_version 变化失效 | 主站撤销后读取在缓存内仍可、写入 401 且会话作废；主站 503 时写入与续签 503；改密后续签 401 |
| 事件 | 签名、±300 秒、去重、先落库后 ack；轮换期双签名 | 签名错误/过期 401，重投幂等；`grant.revoked` 作废会话；`account.deleted` 经游标对账删除数据并以墓碑拦截重新登录 |
| 密钥 | AES-GCM 绑定会话，可轮换 | 密文挪到别的会话无法解密；新增密钥后旧密文仍可解 |
| 联调 | 与主站真实实现对接 | 2026-10-27 生产：主站 `connect.clients.read`（白名单仅站长 `u-c1ac8333e87e`、空 scope/operations、secret 仅存哈希，经 `just paperdaily-security-run` 写入，ask 配置读回不变）；RiD 切 `RID_MODE=linked`。切换前备份并列资产清单（1 用户 / 1 论文 / 6 工作台），本地管理员经 `scripts/link_paperdaily_account.py` 显式绑定该 subject。服务端：真实 client 凭证调 introspect（假 token → inactive）、token（假 code → invalid_grant）、events（空列表）；本地密码登录/注册 403；登录跳转参数通过主站 `/request` 校验规则；伪造 state 回登录页；无 cookie 换 token 401。站长浏览器真实登录：22:04:41 跳主站 → 22:04:51 回调 → 22:04:53 换取本地 token 200；本站 provider session 映射到原管理员（role admin），主站 read grant 有效、scope 为空、11-26 到期 |
| 撤销 | 退出/改密等在本站生效 | 待验证（R4a.8）；当前靠每 60 秒拉取事件，主站尚未部署 read 推送 worker |

R4a 测试：SQLite 114 passed，PostgreSQL 115 passed。

## R5 部署（2026-10-26）
- read.paperdaily.org 上线（standalone、自助注册关闭）；公网实测上传 15 页论文 54s 可读、6 张图经签名链接 200、注册 403、`/uploads` 404。
- 每日备份到 RGW，恢复演练：备份恢复到临时库后论文/用户数与线上一致。

| 配额 | 触发 LLM 的路由按调用者扣 AI 配额，用完 403 且不调用模型 | `tests/test_ai_quota.py`；他人论文上调用 AI 403 且不扣配额 |
| 前端 | 编译通过；所有直连 fetch / EventSource 带凭证 | `tsc -b` 通过；Vite 构建（编程接口）2.7s 完成。本机 `vite build` CLI 无输出挂起，与改动无关（编程接口同配置可构建），以 CI 的 Docker 构建为准 |

R1 本地测试：`uv run pytest -q` → 53 passed。

## R6 系列站（设计 2026-10-27 v0.2）

| 项 | 标准 | 证据 |
|---|---|---|
| 配置分层 | linked 下数据库里的 key/地址不生效；写入返回 400；用户只能写偏好白名单；模型名必须在 ALLOWED_MODELS | `tests/test_series_config.py`（5 项）：数据库 Key/地址与未允许模型被忽略、用户模型覆盖不生效、偏好生效；用户/测试 Key/管理员写入 400；偏好校验；提示词含目标语言/风格/术语表；`parse_quality=fast` 跳过 VLM |
| 题录与 PDF | 导入题录不扣分、幂等；补传/抓取 PDF 后才进入解析；抓取只走白名单且拒内网、非 PDF、超 50MB | `tests/test_series_billing.py`：单篇/合集/综述导入、幂等、余额不变；arXiv 跳转到白名单外被拒且不跟随；https 与子域伪装被拒；非 PDF 拒收 |
| 按篇计费 | 同一用户同一内容哈希只计 1 次；失败冲正不占篇；注册第 6 篇被拒；付费不限篇；402/409 状态正确 | 模拟主站（校验 assertion/preflight 签名）：409 报价确认 → `/process` 预扣；同一 PDF 换题录不再扣；失败冲正且不占篇；注册达限 403 且不去主站预扣，Pro 不限；402 保留 pdf_pending，补发后可继续；`READ_BILLING=off` 只计篇；前端 `tests/series-charge.test.ts`（确认、取消不扣、达限提示） |
| 与主站同步 | hold → claim → heartbeat → complete；重复提交幂等；重启后补交 complete | 模拟主站：claim/heartbeat/complete 走 runner 签名，结算后状态 settled；complete 时主站不可达 → 落库，`reconcile_pending` 补交成功。生产联调待主站 P1/P3/P9/P10 |
| 深链 | `/open` 三种形式；未登录先登录后继续；不信任链接里的元数据 | 前端实现（paper 可重复、collection、review；单篇已可读直接进阅读器；title 只作标签）；端到端待主站 P1 后在生产验证 |
| 组内共享 | 组员阅读不扣分、不占篇 | 待测 |

R6 测试：后端 SQLite 140 passed + 1 skipped、PostgreSQL 141 passed；前端 vitest 15 passed、`tsc -b` 通过、Vite 构建通过。

2026-10-27 生产部署 R6（`deploy/r6-20261027` = 395661c，即 #14 + 构建镜像参数，未含 #15）：迁移到 0005；`RID_MODE=linked`、`READ_BILLING=off`、`PAPERDAILY_SCOPES` 为空、`PARSE_PROVIDERS=vlm,grobid`、`ALLOWED_MODELS` 为两个校内模型；公网 `/`、`/open` 200，`/billing/status` 与 `/preferences` 未登录 401。部署主机到 GitHub/PyPI/Debian 官方源不稳定，构建改用 USTC（apt）与 TUNA（PyPI）镜像，代码经本地 git bundle 传送（`RID_SRC=… just readitdeep-deploy`）。
