# PaperDaily connect ↔ Read it DEEP（client `read`）线上接口

> **以主站实现为准**：alonegg/new_paperdaily `api/routers/connect.py`、`api/connect.py`（Codex，E2a，2026-10-26 读取）。
> 本仓库起草的提案（主站 PR #131）已由主站关闭，未采纳；下表记录主站实际格式与 RiD 的对应实现。
> 上位设计：主站 `docs/plans/research-suite-accounts-design.md` v2.2 §3、§7。

## 主站接口（服务端调用一律 HTTP Basic：`read:<client_secret>`，secret ≥32 字节）

| 接口 | 请求 | 响应 |
|---|---|---|
| 浏览器授权页 `GET {PAPERDAILY_WEB_URL}/connect/read` | `client_id=read&response_type=code&redirect_uri=https://read.paperdaily.org/api/auth/paperdaily/callback&state=<43–256 位 base64url>&code_challenge=<43 位>&code_challenge_method=S256`；**不能带 scope**（首发为空） | 主站前端调 `GET /api/auth/connect/request` 与 `POST /api/auth/connect/authorize` 后跳回 `callback?code&state` 或 `?error=access_denied&state` |
| `POST /api/auth/connect/token` | `{"grant_type":"authorization_code","code","code_verifier","redirect_uri"}` | `{"access_token":"pd_live_…","token_type":"Bearer","scope":"","expires_in":2592000,"expires_at":"…+00:00","grant_id":"grt_…","auth_version":n,"subject":{"issuer":"https://paperdaily.org","sub":"<主站 user_id>"}}`；错误 `400 invalid_grant`；同一 code 重放会撤销已签发的授权 |
| `POST /api/auth/connect/introspect` | `{"token"}` | `{"active":true,"subject":{…},"grant_id","auth_version","expires_at","scope":""}` 或 `{"active":false}` |
| `POST /api/auth/connect/revoke` | `{"token"}` 或 `{"grant_id"}`（二选一） | `204` |
| `POST /api/auth/connect/events` | `{"after_cursor":n,"limit":≤200,"ack_event_ids":[…]}` | `{"events":[…],"has_more":bool,"next_cursor":n}`；事件 `{event_id, client_id, type, version, cursor, occurred_at, subject:{issuer,sub}, grant_id?, auth_version, reason?}`，`type` ∈ `grant.revoked`、`account.deleted` |

要点：共用样例 `backend/tests/fixtures/paperdaily-connect-v1/`（原样复制自主站）由 `tests/test_paperdaily_fixtures.py` 校验。主站**不下发邮箱或资料**；首发为封闭试点，只有 `connect.clients.read.user_allowlist` 里的主站用户能授权；**没有推送 webhook**，事件只能拉取并在下一次请求里 ack。

## RiD 侧实现

- 登录：`/api/auth/paperdaily/login` → 主站授权页 → `/callback`（校验 state 与浏览器 cookie、PKCE、`subject.issuer`）→ 建/取 `external_subject = subject.sub` 的本地用户 → provider session（委托 key AES-GCM 加密）→ HttpOnly 会话 cookie。
- 只按 subject.sub 映射，**永不按邮箱合并**（主站契约 `identity_link`）。既有本地账号：由运维执行 `scripts/link_paperdaily_account.py --email … --subject <sub>` 绑定；`PAPERDAILY_ADMIN_SUBJECTS` 列出的用户登录即为管理员。
- 本地 JWT ≤15 分钟，只能凭会话 cookie 经 `/api/auth/paperdaily/session` 续签（实时 introspect）；读请求接受 60 秒内的核验，写/上传/AI 实时核验，主站不可用 503；`auth_version` 或 `grant_id` 不符即作废会话。
- 事件：每 60 秒 `POST /events` 拉取，处理（`grant.revoked` 作废会话、不删数据；`account.deleted` 删除数据并留墓碑）落库后在下一次请求 ack。主站另有推送 worker（`scripts/connect_events.py`，格式与本站 `/api/auth/paperdaily/events` 一致：`X-PD-Signature: v1=HMAC(secret, ts.event_id.sha256(body))`，可并列新旧两个签名）；本站配置 `PAPERDAILY_WEBHOOK_SECRET` 后接收推送，拉取照常作为兜底。
- 退出：`POST /api/auth/paperdaily/logout` → 主站 revoke（token）+ 本地作废。
