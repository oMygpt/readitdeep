"""关联模式（RID_MODE=linked）端到端测试：按 docs/plans/paperdaily-connect-contract.md 实现的模拟主站。"""

import base64
import hashlib
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.config import get_settings
from app.core.store import store
from app.services.paperdaily import client as pd_client
from app.services.paperdaily import crypto, events, sessions

KEY_V1 = base64.b64encode(b"1" * 32).decode()
KEY_V2 = base64.b64encode(b"2" * 32).decode()
BASIC = "Basic " + base64.b64encode(b"read:client-secret").decode()


class FakePaperDaily:
    """主站 connect 接口的最小实现：授权码 + PKCE、introspect、revoke、事件游标。"""

    def __init__(self):
        self.codes = {}
        self.tokens = {}  # token -> {user, grant_id, auth_version, active}
        self.users = {"pd-u1": {"user_id": "pd-u1", "email": "alice@uni.edu", "email_verified": True, "display_name": "Alice"}}
        self.events = []
        self.down = False
        self.revoked = []
        self.auth_version = {"pd-u1": 3}

    def consent(self, authorize_url, user_id="pd-u1"):
        q = parse_qs(urlparse(authorize_url).query)
        assert q["code_challenge_method"] == ["S256"] and q["client_id"] == ["read"]
        assert q["redirect_uri"] == ["https://read.test/api/auth/paperdaily/callback"]
        code = secrets.token_urlsafe(16)
        self.codes[code] = {"challenge": q["code_challenge"][0], "redirect_uri": q["redirect_uri"][0], "user_id": user_id}
        return code, q["state"][0]

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            return httpx.Response(503)
        if request.headers.get("authorization") != BASIC:
            return httpx.Response(401, json={"error": "invalid_client"})
        path = request.url.path
        body = json.loads(request.content or b"{}")
        if path == "/api/auth/connect/token":
            c = self.codes.pop(body.get("code"), None)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(body.get("code_verifier", "").encode()).digest()).rstrip(b"=").decode()
            if not c or c["challenge"] != challenge or c["redirect_uri"] != body.get("redirect_uri"):
                return httpx.Response(400, json={"error": "invalid_grant"})
            token = "pd_" + secrets.token_urlsafe(16)
            uid = c["user_id"]
            self.tokens[token] = {"user_id": uid, "grant_id": "grt_" + secrets.token_hex(4), "active": True}
            exp = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
            t = self.tokens[token]
            return httpx.Response(200, json={"access_token": token, "token_type": "Bearer", "expires_at": exp,
                                             "grant_id": t["grant_id"], "auth_version": self.auth_version[uid],
                                             "scope": "read:paper", "user": self.users[uid]})
        if path == "/api/auth/connect/introspect":
            t = self.tokens.get(body.get("token"))
            if not t or not t["active"]:
                return httpx.Response(200, json={"active": False})
            return httpx.Response(200, json={"active": True, "user_id": t["user_id"], "grant_id": t["grant_id"],
                                             "auth_version": self.auth_version[t["user_id"]], "expires_at": "2099-01-01T00:00:00Z"})
        if path == "/api/auth/connect/revoke":
            self.revoked.append(body.get("token"))
            if body.get("token") in self.tokens:
                self.tokens[body["token"]]["active"] = False
            return httpx.Response(200, json={})
        if path == "/api/auth/connect/events":
            after = int(request.url.params.get("after", 0))
            page = [e for e in self.events if e["cursor"] > after]
            return httpx.Response(200, json={"events": page, "next_cursor": max([e["cursor"] for e in page] or [after]), "has_more": False})
        return httpx.Response(404, json={"error": "not_found"})

    def grant_of(self, user_id="pd-u1"):
        return next(t["grant_id"] for t in self.tokens.values() if t["user_id"] == user_id)


@pytest.fixture
def pd(monkeypatch):
    s = get_settings()
    for k, v in {
        "rid_mode": "linked", "public_base_url": "https://read.test", "paperdaily_base_url": "https://pd.test",
        "paperdaily_client_id": "read", "paperdaily_client_secret": "client-secret",
        "paperdaily_webhook_secret": "hook-secret", "paperdaily_token_keys": f"v2:{KEY_V2},v1:{KEY_V1}",
    }.items():
        monkeypatch.setattr(s, k, v)
    fake = FakePaperDaily()
    monkeypatch.setattr(pd_client, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    return fake


@pytest.fixture
async def https_client():
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://testserver") as c:
        yield c


async def login(c, pd, return_to="/open?paper=p1", user_id="pd-u1"):
    r = await c.get("/api/auth/paperdaily/login", params={"return_to": return_to})
    assert r.status_code == 302 and r.headers["location"].startswith("https://pd.test/connect/read?")
    code, state = pd.consent(r.headers["location"], user_id)
    return await c.get("/api/auth/paperdaily/callback", params={"code": code, "state": state})


async def token(c):
    r = await c.post("/api/auth/paperdaily/session")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


async def test_full_login_flow(pd, https_client):
    c = https_client
    assert (await c.get("/api/v1/auth/mode")).json() == {"mode": "linked", "login_url": "/api/auth/paperdaily/login", "registration_open": False}
    r = await login(c, pd)
    assert r.status_code == 302 and r.headers["location"] == "/open?paper=p1"
    h, body = await token(c)
    assert body["user"]["email"] == "alice@uni.edu" and body["expires_in"] <= 15 * 60
    assert (await c.get("/api/v1/library/", headers=h)).status_code == 200
    # 本地注册、密码登录、refresh 一律关闭
    assert (await c.post("/api/v1/auth/register", json={"email": "x@y.org", "password": "x1234567"})).status_code == 403
    assert (await c.post("/api/v1/auth/login", json={"email": "alice@uni.edu", "password": "x"})).status_code == 403
    # 再次登录复用同一本地用户
    await login(c, pd)
    _, again = await token(c)
    assert again["user"]["id"] == body["user"]["id"]


async def test_state_must_match_browser_cookie(pd, https_client):
    r = await https_client.get("/api/auth/paperdaily/login")
    code, state = pd.consent(r.headers["location"])
    https_client.cookies.clear()  # 换了浏览器 / 被诱导点击的回调
    r = await https_client.get("/api/auth/paperdaily/callback", params={"code": code, "state": state})
    assert r.status_code == 302 and r.headers["location"].startswith("/login?error=")
    assert (await https_client.post("/api/auth/paperdaily/session")).status_code == 401


async def test_pkce_mismatch_and_denied(pd, https_client):
    r = await https_client.get("/api/auth/paperdaily/login")
    code, state = pd.consent(r.headers["location"])
    pd.codes[code]["challenge"] = "tampered"
    r = await https_client.get("/api/auth/paperdaily/callback", params={"code": code, "state": state})
    assert r.headers["location"].startswith("/login?error=")
    r = await https_client.get("/api/auth/paperdaily/callback", params={"error": "access_denied", "state": "x"})
    assert r.headers["location"].startswith("/login?error=")


async def test_read_cache_write_realtime_and_revocation(pd, https_client):
    c = https_client
    await login(c, pd)
    h, _ = await token(c)
    for t in pd.tokens.values():
        t["active"] = False  # 主站侧撤销了，但还没推事件
    assert (await c.get("/api/v1/library/", headers=h)).status_code == 200  # 60 秒内的读取用缓存
    r = await c.post("/api/v1/workbench/items", json={"type": "note", "title": "t", "description": "d"}, headers=h)
    assert r.status_code == 401  # 写入实时核验
    assert (await c.get("/api/v1/library/", headers=h)).status_code == 401  # 本地会话已作废
    assert (await c.post("/api/auth/paperdaily/session")).status_code == 401


async def test_paperdaily_down_blocks_sensitive_ops(pd, https_client):
    c = https_client
    await login(c, pd)
    h, _ = await token(c)
    pd.down = True
    assert (await c.get("/api/v1/library/", headers=h)).status_code == 200
    r = await c.post("/api/v1/workbench/items", json={"type": "note", "title": "t", "description": "d"}, headers=h)
    assert r.status_code == 503
    assert (await c.post("/api/auth/paperdaily/session")).status_code == 503


async def test_auth_version_change_invalidates(pd, https_client):
    await login(https_client, pd)
    h, _ = await token(https_client)
    pd.auth_version["pd-u1"] += 1  # 改密
    assert (await https_client.post("/api/auth/paperdaily/session")).status_code == 401


def signed(event, secret="hook-secret", ts=None):
    body = json.dumps(event).encode()
    ts = str(int(ts or time.time()))
    return body, {"Content-Type": "application/json", "X-PD-Client": "read", "X-PD-Event-Id": event["event_id"],
                  "X-PD-Timestamp": ts, "X-PD-Signature": "v1=" + events.sign(secret, ts, event["event_id"], body)}


async def test_webhook_grant_revoked(pd, https_client):
    c = https_client
    await login(c, pd)
    h, _ = await token(c)
    event = {"event_id": "evt_1", "type": "grant.revoked", "version": 1, "cursor": 1, "user_id": "pd-u1",
             "grant_id": pd.grant_of(), "reason": "password_changed", "occurred_at": "2026-10-26T00:00:00Z"}
    body, headers = signed(event)
    r = await c.post("/api/auth/paperdaily/events", content=body, headers=headers)
    assert r.status_code == 200 and r.json() == {"ack": "evt_1"}
    assert (await c.get("/api/v1/library/", headers=h)).status_code == 401
    assert (await c.post("/api/auth/paperdaily/events", content=body, headers=headers)).status_code == 200  # 重投幂等
    bad_body, bad = signed({**event, "event_id": "evt_2"}, secret="wrong")
    assert (await c.post("/api/auth/paperdaily/events", content=bad_body, headers=bad)).status_code == 401
    old_body, old = signed({**event, "event_id": "evt_3"}, ts=time.time() - 3600)
    assert (await c.post("/api/auth/paperdaily/events", content=old_body, headers=old)).status_code == 401


async def test_webhook_rotation_accepts_either_signature():
    body = b'{"event_id":"e"}'
    ts = str(int(time.time()))
    s = get_settings()
    old_secret = s.paperdaily_webhook_secret
    try:
        s.paperdaily_webhook_secret = "new"
        headers = {"x-pd-client": s.paperdaily_client_id, "x-pd-event-id": "e", "x-pd-timestamp": ts,
                   "x-pd-signature": f"v1={events.sign('old', ts, 'e', body)}, v1={events.sign('new', ts, 'e', body)}"}
        assert events.verify_signature(headers, body)
    finally:
        s.paperdaily_webhook_secret = old_secret


async def test_account_deleted_removes_data_and_blocks_relogin(pd, https_client):
    c = https_client
    await login(c, pd)
    h, body = await token(c)
    uid = body["user"]["id"]
    store.set("p-del", {"id": "p-del", "filename": "a.pdf", "status": "completed", "user_id": uid})
    await c.post("/api/v1/workbench/items", json={"type": "note", "title": "t", "description": "d", "source_paper_id": "p-del"}, headers=h)
    pd.events.append({"event_id": "evt_del", "type": "account.deleted", "version": 1, "cursor": 7, "user_id": "pd-u1",
                      "occurred_at": "2026-10-26T00:00:00Z"})
    assert await events.pull_once() == 1  # 走游标对账路径
    assert store.get("p-del") is None and store.get_by_user(uid) == []
    from app.core.workbench_store import workbench_store

    assert workbench_store.get_items_for_user(uid) == []
    r = await login(c, pd)
    assert r.headers["location"].startswith("/login?error=")  # tombstone 拦住重新登录
    assert await events.pull_once() == 0  # 已处理的不重复


async def test_email_linking_requires_verified_email(pd, https_client):
    # 切换到关联模式之前就存在的本地管理员（与 PaperDaily 同邮箱）
    from app.core.database import async_session_maker
    from app.models.user import User

    async with async_session_maker() as db:
        admin = User(email="alice@uni.edu", role="admin", is_active=True)
        admin.set_password("x1234567")
        db.add(admin)
        await db.commit()
    pd.users["pd-u1"]["email_verified"] = False
    r = await login(https_client, pd)
    assert r.headers["location"].startswith("/login?error=")
    pd.users["pd-u1"]["email_verified"] = True
    await login(https_client, pd)
    _, body = await token(https_client)
    assert body["user"]["role"] == "admin"  # 关联到既有本地账号，保留角色与数据


async def test_logout_revokes_at_paperdaily(pd, https_client):
    await login(https_client, pd)
    h, _ = await token(https_client)
    r = await https_client.post("/api/auth/paperdaily/logout")
    assert r.status_code == 200 and len(pd.revoked) == 1
    assert (await https_client.get("/api/v1/library/", headers=h)).status_code == 401


def test_safe_return_to():
    ok = ["/", "/open?paper=1", "/reader/abc#x"]
    bad = ["https://evil.com", "//evil.com", "/\\evil.com", "/%2F%2Fevil.com", "%2F%2Fevil.com", "javascript:alert(1)", "/a\nb", "/%252F%252Fevil.com"]
    assert [sessions.safe_return_to(v) for v in ok] == ok
    assert all(sessions.safe_return_to(v) == "/" for v in bad)


def test_token_crypto_binding_and_rotation(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "paperdaily_token_keys", f"v1:{KEY_V1}")
    aad = crypto.associated_data("u", "read", "g", "s1")
    v, nonce, ct = crypto.encrypt("pd_secret", aad)
    assert v == "v1" and crypto.decrypt(v, nonce, ct, aad) == "pd_secret"
    with pytest.raises(Exception):
        crypto.decrypt(v, nonce, ct, crypto.associated_data("u", "read", "g", "s2"))  # 挪到别的会话无法解密
    monkeypatch.setattr(s, "paperdaily_token_keys", f"v2:{KEY_V2},v1:{KEY_V1}")  # 轮换：新密钥加密，旧密文仍可解
    assert crypto.decrypt(v, nonce, ct, aad) == "pd_secret" and crypto.encrypt("x", aad)[0] == "v2"


async def test_linked_mode_startup_requires_secrets(monkeypatch):
    from app.config import Settings
    from app.main import check_security_settings

    with pytest.raises(RuntimeError, match="PAPERDAILY_CLIENT_SECRET"):
        check_security_settings(Settings(secret_key="x" * 32, rid_mode="linked", public_base_url="https://r"))
