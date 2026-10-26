# PaperDaily connect ↔ Read it DEEP（client `read`）线上接口契约（提案）

> 状态：**提案**，由 Read it DEEP 侧起草（2026-10-26），供主站 E2/E4a 实现者（Codex）审阅采纳或修改。
> 上位设计：`docs/plans/research-suite-accounts-design.md` v2.2 §3.1–3.3、§7。本文只把其中未写死的**线上格式**定下来，
> 不改变 v2.2 的任何语义。双方实现与测试以本文为准；任何一方要改字段，先改本文。

## 0. 约定

- 主站基址 `PD = https://paperdaily.org`；RiD 基址 `RID = https://read.paperdaily.org`。
- client 凭证：`client_id=read`，`client_secret`（≥32 字节随机，主站 `connect.clients` 保存哈希；RiD 放部署 vault）。
  **服务端到服务端的调用一律用 HTTP Basic**（`Authorization: Basic base64(client_id:client_secret)`）。
- 所有时间为 RFC 3339 UTC（`2026-11-25T03:00:00Z`）。错误体统一 `{"error": "<code>", "error_description": "<中文说明>"}`。
- 日志不得记录 code、code_verifier、client_secret、委托 key 明文。

## 1. 授权（浏览器跳转）

RiD → 浏览器 302 到：

```
GET {PD}/connect/read
    ?response_type=code
    &client_id=read
    &redirect_uri=https%3A%2F%2Fread.paperdaily.org%2Fapi%2Fauth%2Fpaperdaily%2Fcallback   # 精确匹配注册值
    &state=<≥32 字节随机，base64url>
    &code_challenge=<base64url(SHA256(code_verifier))>
    &code_challenge_method=S256                                                         # 只接受 S256
    &scope=<空格分隔，可省略=该 client 的默认 scope>
```

- 主站页面完成登录/免邀请注册与授权确认后，302 回 `redirect_uri?code=<一次性 code>&state=<原样>`。
- 用户拒绝：`redirect_uri?error=access_denied&state=…`；参数错误且 redirect_uri 可信时 `error=invalid_request`，
  redirect_uri 不可信时**不跳转**，直接在主站显示错误。
- code：60 秒、一次性，绑定 user/client/code_challenge/redirect_uri/scope。
- `return_to`（站内相对路径）由 RiD 自己与 state 一起保存，**不经主站传递**。

## 2. 换取委托 key

```
POST {PD}/api/auth/connect/token          Authorization: Basic …
Content-Type: application/json
{"grant_type": "authorization_code", "code": "…", "code_verifier": "…", "redirect_uri": "…"}
```

200：

```json
{
  "access_token": "pd_…",                 // 委托 key（Bearer），30 天绝对有效期，无 refresh
  "token_type": "Bearer",
  "expires_at": "2026-11-25T03:00:00Z",   // = min(30 天, grant 到期)
  "grant_id": "grt_…",
  "auth_version": 7,                       // 账户认证版本：改密/找回/全设备退出时 +1
  "scope": "read:paper read:contrib read:reading write:reading read:resources",
  "user": {
    "user_id": "…",                        // 主站稳定用户 ID → RiD external_subject
    "email": "a@b.edu",
    "email_verified": true,
    "display_name": "…",
    "locale": "zh-CN"
  }
}
```

错误：`400 invalid_grant`（code 过期/已用/challenge 不符/redirect_uri 不符）、`400 invalid_request`、`401 invalid_client`。
同一 code 第二次使用必须失败，并且（v2.2 安全要求）撤销第一次签发的 key。

## 3. 在线核验

```
POST {PD}/api/auth/connect/introspect     Authorization: Basic …
{"token": "pd_…"}
```

200（凭证有效时）：

```json
{"active": true, "user_id": "…", "grant_id": "grt_…", "auth_version": 7,
 "expires_at": "2026-11-25T03:00:00Z", "scope": "…"}
```

key 已撤销/过期/不属于该 client：`200 {"active": false}`（不给原因，不泄露是否存在）。
client 凭证错误 `401 invalid_client`。主站故障 `5xx`——**RiD 遇 5xx 或超时一律按「无法确认」处理（敏感操作返回 503）**。

RiD 侧缓存规则（v2.2 §3.3）：普通私有读取 ≤60 秒；上传、写入、AI 入队/执行、导出、文件分段读取前实时核验；短 JWT 续签实时核验。

## 4. 撤销（RiD 退出登录）

```
POST {PD}/api/auth/connect/revoke         Authorization: Basic …
{"token": "pd_…"}
```

始终 `200 {}`（幂等）。主站随后照常向 RiD 推送 `grant.revoked`。

## 5. 事件推送（主站 → RiD webhook）

```
POST {RID}/api/auth/paperdaily/events
Content-Type: application/json
X-PD-Client: read
X-PD-Event-Id: evt_…                       // 稳定，重投不变
X-PD-Timestamp: 1793000000                 // 本次投递的 Unix 秒，重投重新生成
X-PD-Signature: v1=<hex(HMAC_SHA256(webhook_secret, "{timestamp}.{event_id}.{hex(sha256(body))}"))>
```

body：

```json
{"event_id": "evt_…", "type": "grant.revoked", "version": 1,
 "occurred_at": "2026-10-26T03:00:00Z", "cursor": 1234,
 "user_id": "…", "grant_id": "grt_…", "reason": "password_changed"}
```

- `type` ∈ `grant.revoked`（`grant_id` 必填；`reason` ∈ `logout|password_changed|password_reset|logout_all|client_disabled|user_revoked|device_evicted`）、
  `account.deleted`（无 grant_id）、`entitlements.changed`（可选 `policy_version`）。
- `webhook_secret` 与 `client_secret` 分开保管、分开轮换；轮换期内主站可在 `X-PD-Signature` 里并列两个 `v1=` 值（逗号分隔）。
- RiD：签名或时间窗（±300 秒）不符 → `401`；`event_id` 已处理 → `200`（幂等）；**先持久化事件与 tombstone，再返回**
  `200 {"ack": "evt_…"}`。非 2xx 时主站持续重试并报警。

## 6. 游标对账

```
GET {PD}/api/auth/connect/events?after=<cursor>&limit=100     Authorization: Basic …
```

200：`{"events": [ <与 webhook body 相同的对象> … ], "next_cursor": 1300, "has_more": false}`。
`cursor` 在该 client 范围内单调递增。RiD 每 5 分钟从自己记录的最大已处理 cursor 拉取一次，覆盖 webhook 丢失。

## 7. RiD 侧对应行为（供主站验收对照）

| 主站动作 | RiD 必须表现 |
|---|---|
| 授权成功 | 按 `user.user_id` 建或关联本地用户（仅在 `email_verified=true` 时按邮箱关联既有本地账号）；建 provider session（委托 key 以 AES-GCM 加密存储，关联数据 = user/client/grant/session）；签发 ≤15 分钟 JWT |
| JWT 到期 | 浏览器经 RiD 会话 cookie 续签，续签前实时 introspect；`active=false` 或 auth_version 变化 → 会话失效，要求重新登录 |
| `grant.revoked` | 对应 provider session 立即失效；停止该用户新任务与输出写入；**不删除数据** |
| `account.deleted` | 删除该用户在 RiD 的论文、文件、批注、译文、工作台、会话；记 tombstone，拦截迟到的导入与写回 |
| introspect 5xx/超时 | 普通读在 60 秒缓存内照常；敏感操作返回 503「无法确认 PaperDaily 授权」 |
