# 致主站：Read it DEEP 系列站接入所需改动（P1–P8）

来源：RiD 设计 `docs/plans/2026-10-27-series-site-quota-config-design.md` v0.2（用户 2026-10-27 两轮决定）。
流程：主站按自己的规则（plan + design → 用户确认 → PR）实现；PR 完成后在本 issue 回链，由 RiD 侧（Claude）对齐联调并审查。

## 用户决定（与主站相关的部分）

- 主站只提供论文元数据；全文由用户在 RiD 上传 PDF，或在 RiD 中从开放获取来源抓取。
- 题录可以从 ask 或主站免费带到 RiD；**真正上传 PDF 时才消耗积分，并且按 PDF 篇数计费**（每篇固定价，不按页、不按操作）。
- **篇数在 RiD 计算**，积分在使用后同步给主站。注册用户限 5 篇（默认每自然月），Pro 和机构不限篇数，只受每日 300 分约束。
- 解析、翻译、OCR 全部使用校内模型，在 RiD 主机上执行。主站不接收 PDF。

## P1 read client 的操作上限与 scope

目前 `connect.clients.read` 的 scopes 和 operations 都是空的，只能做身份核验。请为 read 增加一份类似 `ASK_OPERATIONS` 的固定上限（`READ_OPERATIONS`），首批操作如下：

| 操作（method, route name） | scope | RiD 用途 |
|---|---|---|
| GET `self_entitlements` | 无 | 判定档位 |
| GET `self_credit_balance` | 无 | 显示余额 |
| GET `get_paper`（`/api/v1/papers/{id}`） | `read:paper` | 按 paper_id 导入题录 |
| GET `list_my_saves`（`/api/v1/me/saves`） | `read:contrib` | 浏览收藏 |
| GET 个人库列表 `/api/v1/me/library`（**请命名**，例如 `library_list`，并确认支持按合集筛选；不支持请新增 `collection` 参数） | `read:contrib` | 导入合集 |
| GET 合集列表 `/api/v1/me/library/collections`（**请命名**，例如 `library_collections`） | `read:contrib` | 合集选择 |
| GET `self_query_history`、`self_query_history_detail` | `read:history` | 导入综述（问题、答案、cited_paper_ids） |
| POST `read_job_create`；GET `read_job_status`；POST `read_job_cancel` | `write:reading` / `read:reading` | 按篇计费 |

- 新增 scope 后，用户在下次登录时重新同意（主站设计 §3.5）。RiD 将请求的 scope 设为 `read:paper read:contrib read:history read:reading write:reading`（部署变量 `PAPERDAILY_SCOPES`）。
- 不需要 `read:resources`：主站没有全文。资源桥接以后再开。

## P2 开放给所有已验证账号

`allowed_account()` 目前只有 ask 支持 `allow_verified_accounts`。请让 read 也支持这一项，这样 RiD 才能对所有已验证邮箱的注册用户开放，不再只靠白名单。上线前保持 `false` 加白名单，联调完成后由用户决定何时打开。

## P3 开启 read-jobs，按篇定价

RiD 只使用 `read.parse` 一个操作，每个 PDF 一个作业。自动翻译和分析包含在这一篇的价格里。

- `credits.rules.read_jobs`：
  - `price_version`：如 `"read-per-pdf-v1"`；
  - `prices["read.parse"]`：`{base_credits: P, per_page_credits: 0, base_units: U, per_page_units: 0, model: "campus-vlm+llm", prompt_version: "rid-v1", funding_source: "personal"}`；
  - P 的候选值是 30，用户签字前不上线。
- `read.bridge`：
  - 四个门槛 `e2_ready / e3_ready / capacity_approved / authorization_approved` 均为 true，`jobs_enabled` 为 true；
  - `concurrency` 建议 4；`max_pages` 建议 80（与 RiD 的 `VLM_MAX_PAGES` 一致）；`max_bytes` 为 50 MB；
  - `max_seconds` 建议 3600：一篇 80 页的论文，VLM 逐页 OCR 加全文翻译可能要几十分钟；
  - `max_output_bytes` 建议 20 MB；`resource_units_daily`；
  - `host: "10.6.64.6"`，`queue: "rid"`，`policy_version`；
  - `runners.rid`：`{enabled: true, operations: ["read.parse"], secret_env: "PD_READ_RUNNER_RID"}`；
  - `client_assertion`：`{enabled: true, secret_env: "PD_READ_CLIENT_ASSERTION"}`。
- `synthesis.budget.source_units_daily.read`。
- 两个签名密钥由运维生成并放进保险库（RiD 侧的条目为 `readitdeep.paperdaily.runner_secret` 和 `readitdeep.paperdaily.assertion_secret`），主站以环境变量注入。请告知密钥名称是否沿用上面的写法。

## P4 「使用后同步」的语义确认

RiD 的做法：
1. 上传时调用 `read_job_create`（hold）；
2. RiD worker 依次执行 `claim`、`heartbeat`，解析完成后 `complete`；
3. 主站结算；失败、取消、未开始的作业全额冲正。

请确认这能满足「积分使用后同步主站」，并确认 hold 在 `max_seconds` 内不会被通用的 15 分钟 stale-hold 自动冲正（主站设计 §5.3 说已排除，请在 PR 里附测试）。

## P5 权益里的稳定档位字段

请在 `/api/v1/me/entitlements` 里增加 `plan_tier`，取值为 `"registered" | "pro" | "institution" | "admin"`；未验证邮箱的账号为 `"unverified"`。RiD 据此决定 5 篇上限是否适用。
在此之前，RiD 退而解析 `limits["credits.daily_grant"].source` 的前缀（`plan:`、`institution:`、`account:verified`）。请确认这些前缀在 PR 合并前不会改。

## P6 主站页面的深链按钮

在论文详情页、收藏页、合集页和综述历史页，加「到 Read it DEEP 深度阅读」按钮，链接格式为：

```
https://read.paperdaily.org/open?paper=<paper_id>&from=library
https://read.paperdaily.org/open?collection=<collection_id>&from=library
https://read.paperdaily.org/open?review=<query_history_id>&from=daily
```

- paper_id 用 `encodeURIComponent`；多篇时重复 `paper=` 参数，最多 50 个。
- 链接里不要带任何 token 或元数据，RiD 会用服务端委托 key 回主站取数据。

## P7 部署 read 推送 worker

把撤销和删号事件主动推给 RiD：`PD_READ_WEBHOOK_SECRET` 用保险库的 `readitdeep.paperdaily.webhook_secret`，RiD 接收端是 `POST https://read.paperdaily.org/api/auth/paperdaily/events`，已经实现。

## P8（可选）下发显示名

在 token 或 introspect 响应里可选增加 `display_name`（用户在主站设置的昵称，不含邮箱），供 RiD 小组成员列表显示。不做的话，RiD 让用户在本站自己设置昵称。

## 验收与对齐

- 每项 PR 合并后在本 issue 回复 PR 链接和生产配置读回（脱敏）。
- RiD 侧用模拟主站完成测试后，在生产上用一个**非管理员**测试账号走全链路，因为管理员在主站零扣费，无法验证真实扣分；并与 `credit_ledger` 对账。
