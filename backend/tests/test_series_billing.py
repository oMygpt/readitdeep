"""题录/PDF 分离与按篇计费（设计 2026-10-27 v0.2 §3–§4）。

模拟主站按其真实实现（alonegg/new_paperdaily api/read_jobs.py、api/v1/read_bridge.py）校验：
client/runner assertion 签名、preflight 回执签名、报价确认 409、预扣 402、claim/heartbeat/complete 与结算冲正。
"""

import hashlib
import hmac
import json
import time

import httpx
import pytest

from app.config import get_settings
from app.core import jobs
from app.core.store import store
from app.services import billing, pdf_intake
from app.services.paperdaily import client as pd_client
from tests.test_paperdaily_linked import KEY_V1, KEY_V2, FakePaperDaily, https_client, login, token  # noqa: F401

RUNNER_SECRET = "r" * 40
ASSERTION_SECRET = "a" * 40
PRICE, VERSION = 25, "read-per-pdf-25-v1"


def canonical(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def make_pdf(text="hello", pages=2) -> bytes:
    import fitz

    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"{text} page {i}")
    data = doc.tobytes()
    doc.close()
    return data


class FakePD(FakePaperDaily):
    """在 connect 之上加 v1 用户接口与 read-jobs（含签名校验）"""

    def __init__(self):
        super().__init__()
        self.auth_version.update({"pd-u2": 1})
        self.tiers = {"pd-u1": "account:verified", "pd-u2": "plan:p1"}
        self.balance = {"pd-u1": 100, "pd-u2": 300}
        self.papers = {
            "W1": {"id": "W1", "title": "Attention Is All You Need", "authors": [{"name": "A. Vaswani"}],
                   "abstract": "abs", "arxiv_id": "1706.03762", "external_full_text_url": "https://arxiv.org/abs/1706.03762"},
            "doi:10.1/x": {"id": "doi:10.1/x", "title": "Paywalled", "doi": "10.1/x"},
        }
        self.jobs = {}
        self.admissions = {}
        self.nonces = set()
        self.down_v1 = False

    def _user(self, request):
        auth = request.headers.get("authorization", "")
        t = self.tokens.get(auth.removeprefix("Bearer ")) if auth.startswith("Bearer ") else None
        return (auth.removeprefix("Bearer "), t) if t and t["active"] else (None, None)

    def _verify(self, request, actor, secret, key_id):
        h = request.headers
        nonce = h.get("x-read-nonce", "")
        payload = canonical({"version": "read-assertion-v1", "actor": actor, "method": request.method,
                             "path": request.url.path, "body_sha256": hashlib.sha256(request.content).hexdigest(),
                             "timestamp": h.get("x-read-timestamp", ""), "nonce": nonce, "key_id": key_id})
        ok = (h.get("x-read-actor") == actor and abs(int(h.get("x-read-timestamp", "0")) - time.time()) <= 300
              and nonce not in self.nonces
              and hmac.compare_digest(hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest(), h.get("x-read-signature", "")))
        self.nonces.add(nonce)
        return ok

    def handler(self, request):
        path = request.url.path
        if path == "/api/auth/connect/token":
            r = super().handler(request)
            if r.status_code == 200:
                body = json.loads(r.content)
                body["scope"] = "read:paper"
                body["key_id"] = "k-" + body["access_token"][-6:]
                self.tokens[body["access_token"]]["key_id"] = body["key_id"]
                return httpx.Response(200, json=body)
            return r
        if path.startswith("/api/internal/read-jobs/"):
            return self._runner(request)
        if not path.startswith("/api/v1/"):
            return super().handler(request)
        if self.down_v1:
            return httpx.Response(503)
        tok, t = self._user(request)
        if not t:
            return httpx.Response(401, json={"detail": "invalid key"})
        uid = t["user_id"]
        if path == "/api/v1/me/entitlements":
            return httpx.Response(200, json={"limits": {"credits.daily_grant": {"value": 100, "source": self.tiers[uid]}}})
        if path == "/api/v1/me/credits/balance":
            return httpx.Response(200, json={"grant_remaining": self.balance[uid], "earned_balance": 0})
        if path.startswith("/api/v1/papers/"):
            from urllib.parse import unquote

            p = self.papers.get(unquote(path.removeprefix("/api/v1/papers/")))
            return httpx.Response(200, json=p) if p else httpx.Response(404, json={"detail": "paper not found"})
        if path == "/api/v1/me/library/collections":
            return httpx.Response(200, json=[{"id": "c1", "name": "Transformers", "n_papers": 2}])
        if path == "/api/v1/me/library/items":
            assert request.url.params.get("collection_id") == "c1"
            return httpx.Response(200, json={"items": [{"paper_id": "W1"}, {"paper_id": "doi:10.1/x"}]})
        if path == "/api/v1/me/query-history/7":
            return httpx.Response(200, json={"id": 7, "question": "What is attention?", "answer": "It is [1].",
                                             "cited_paper_ids": ["W1"], "status": "done"})
        if path == "/api/v1/me/read-jobs" and request.method == "POST":
            return self._create(request, tok, t)
        return httpx.Response(404, json={"detail": "not found"})

    def _create(self, request, tok, t):
        if not self._verify(request, "read", ASSERTION_SECRET, t["key_id"]):
            return httpx.Response(401, json={"detail": "read_assertion_invalid"})
        body = json.loads(request.content)
        idem = request.headers["idempotency-key"]
        if idem in self.admissions:
            old_body, old_result = self.admissions[idem]
            if old_body != request.content:
                return httpx.Response(409, json={"detail": "read_idempotency_body_conflict"})
            return httpx.Response(200, json=old_result)
        asset = body["asset"]
        expected = hmac.new(RUNNER_SECRET.encode(), canonical({"version": "read-preflight-v1",
                            **{k: v for k, v in asset.items() if k != "signature"}}), hashlib.sha256).hexdigest()
        if (expected != asset["signature"] or asset["owner_id"] != t["user_id"] or asset["grant_id"] != t["grant_id"]
                or asset["paper_id"] is not None or asset["signer"] != "rid"
                or not time.time() < asset["expires_at"] <= time.time() + 900):
            return httpx.Response(403, json={"detail": "invalid_preflight_binding"})
        if body["confirmed_price"] != PRICE or body["confirmed_price_version"] != VERSION:
            return httpx.Response(409, json={"detail": {"code": "read_quote_confirmation_required", "price": PRICE, "price_version": VERSION}})
        uid = t["user_id"]
        if self.balance[uid] < PRICE:
            return httpx.Response(402, json={"detail": "insufficient credits"})
        self.balance[uid] -= PRICE
        job_id = f"rj_{len(self.jobs) + 1}"
        self.jobs[job_id] = {"user": uid, "status": "queued", "fence": 0, "asset": asset, "stop": False, "price": PRICE}
        result = {"job_id": job_id, "status": "queued", "price": PRICE, "price_version": VERSION}
        self.admissions[idem] = (request.content, result)
        return httpx.Response(200, json=result)

    def _runner(self, request):
        if not self._verify(request, "rid", RUNNER_SECRET, "-"):
            return httpx.Response(401, json={"detail": "read_actor_denied"})
        job_id = request.url.path.split("/")[4]
        op = request.url.path.split("/")[5]
        job = self.jobs[job_id]
        if op == "claim":
            if job["status"] != "queued":
                return httpx.Response(409, json={"detail": "read_job_not_claimable"})
            job.update(status="running", fence=1)
            return httpx.Response(200, json={"job_id": job_id, "fence": 1, "lease_until": "x"})
        body = json.loads(request.content)
        assert body["fence"] == job["fence"]
        if op == "heartbeat":
            return httpx.Response(200, json={"job_id": job_id, "stop": job["stop"]})
        assert body["asset_sha256"] == job["asset"]["content_sha256"] and body["execution_stopped"] is True
        ok = body["status"] == "succeeded" and body["output_sha256"]
        if not ok:
            self.balance[job["user"]] += job["price"]  # 冲正
        job["status"] = "succeeded" if ok else body["status"]
        return httpx.Response(200, json={"accepted": True, "disposition": "accepted", "job": {"job_id": job_id, "status": job["status"]}})


@pytest.fixture
def pd(monkeypatch):
    s = get_settings()
    for k, v in {
        "rid_mode": "linked", "public_base_url": "https://read.test", "paperdaily_base_url": "https://pd.test",
        "paperdaily_web_url": "https://pd.test", "paperdaily_scopes": "read:paper", "paperdaily_client_id": "read", "paperdaily_client_secret": "client-secret",
        "paperdaily_token_keys": f"v2:{KEY_V2},v1:{KEY_V1}", "read_billing": "paperdaily",
        "paperdaily_runner_secret": RUNNER_SECRET, "paperdaily_assertion_secret": ASSERTION_SECRET,
        "read_free_paper_limit": 2,
    }.items():
        monkeypatch.setattr(s, k, v)
    fake = FakePD()
    monkeypatch.setattr(pd_client, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    billing._tier_cache.clear()
    billing._price_cache.update(price=None, price_version=None)
    monkeypatch.setattr(billing, "HEARTBEAT_SECONDS", 0.05)
    return fake


@pytest.fixture
def fake_parse(monkeypatch):
    """解析结果由测试决定：outcome[0] = True 成功 / False 失败；可加 delay 让心跳跑起来"""
    outcome = {"ok": True, "delay": 0}

    async def parse(paper_id, file_path, content, filename, user_id=None):
        import asyncio

        await asyncio.sleep(outcome["delay"])
        if outcome["ok"]:
            store.update(paper_id, {"status": "completed", "markdown_content": f"# T\n{len(content)}"})
        else:
            store.update(paper_id, {"status": "failed", "error_message": "boom"})

    async def translate(paper_id, user_id=None):
        store.update(paper_id, {"translation_status": "completed", "translated_content": "translated fixture"})
    monkeypatch.setattr("app.services.translation._translate_paper_background", translate)
    monkeypatch.setattr("app.api.v1.papers.parse_paper_task", parse)
    return outcome


async def _session(c, pd, uid="pd-u1"):
    await login(c, pd, user_id=uid)
    h, body = await token(c)
    return h, body["user"]["id"]


async def _import(c, h, ids=("W1",), title=None):
    r = await c.post("/api/v1/papers/import/paperdaily", json={"paper_ids": list(ids), "title": title}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


async def _attach(c, h, paper_id, pdf, price=None):
    data = {"confirm_price": str(price)} if price is not None else {}
    return await c.post(f"/api/v1/papers/{paper_id}/pdf", files={"file": ("p.pdf", pdf, "application/pdf")}, data=data, headers=h)


async def test_metadata_import_is_free_and_idempotent(pd, https_client):
    c = https_client
    h, uid = await _session(c, pd)
    items = await _import(c, h, ["W1", "doi:10.1/x", "missing"], title="ask: attention")
    assert [i["status"] for i in items] == ["metadata", "metadata", "error"]
    assert items[0]["oa_available"] is True and items[1]["oa_available"] is False
    p = store.get(items[0]["paper_id"])
    assert p["title"] == "Attention Is All You Need" and p["authors"] == "A. Vaswani" and p["tags"] == ["ask: attention"]
    again = await _import(c, h, ["W1"])
    assert again[0]["created"] is False and again[0]["paper_id"] == items[0]["paper_id"]
    assert pd.balance["pd-u1"] == 100 and pd.jobs == {}
    # 合集与综述
    r = await c.post("/api/v1/papers/import/paperdaily/collection", json={"collection_id": "c1"}, headers=h)
    assert r.status_code == 200 and r.json()["title"] == "Transformers" and len(r.json()["items"]) == 2
    r = await c.post("/api/v1/papers/import/paperdaily/review", json={"history_id": 7}, headers=h)
    assert r.json()["question"] == "What is attention?" and r.json()["items"][0]["paper_id"] == items[0]["paper_id"]


async def test_pdf_charge_confirm_hold_claim_complete(pd, https_client, fake_parse):
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]["paper_id"]
    pdf = make_pdf("a", pages=3)
    r = await _attach(c, h, pid, pdf)  # 不知道价格 → 主站要求确认
    assert r.status_code == 409 and r.json()["detail"]["error"] == "price_confirmation_required"
    assert r.json()["detail"]["price"] == PRICE and r.json()["detail"]["paper_id"] == pid
    assert store.get(pid)["status"] == "pdf_pending" and pd.balance["pd-u1"] == 100
    st = (await c.get("/api/v1/billing/status", headers=h)).json()
    assert st["price"] == PRICE and st["tier"] == "registered" and st["papers_limit"] == 2 and st["papers_used"] == 0
    r = await c.post(f"/api/v1/papers/{pid}/process", json={"confirm_price": PRICE}, headers=h)
    assert r.status_code == 200 and r.json()["charged"] is True and r.json()["pdf"]["pages"] == 3
    assert pd.balance["pd-u1"] == 100 - PRICE and pd.jobs["rj_1"]["status"] == "queued"
    fake_parse["delay"] = 0.2  # 让心跳至少跑一次
    assert await jobs.drain(["parse"]) == 1
    assert pd.jobs["rj_1"]["status"] == "succeeded" and pd.balance["pd-u1"] == 100 - PRICE
    charge = await billing._charge(uid, hashlib.sha256(pdf).hexdigest())
    assert charge.status == "settled" and charge.price == PRICE and charge.completion is None
    assert jobs.active_paper_ids() == set()
    assert store.get(pid)["translation_status"] == "completed"  # Translation finishes inside the billed lease.
    # 同一 PDF 挂到另一条题录：不再扣费
    pid2 = (await _import(c, h, ["doi:10.1/x"]))[0]["paper_id"]
    r = await _attach(c, h, pid2, pdf)
    assert r.status_code == 200 and r.json()["charged"] is False and pd.balance["pd-u1"] == 100 - PRICE and len(pd.jobs) == 1


async def test_failed_parse_refunds_and_frees_quota(pd, https_client, fake_parse):
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]["paper_id"]
    fake_parse["ok"] = False
    assert (await _attach(c, h, pid, make_pdf("x"), PRICE)).status_code == 200
    await jobs.drain(["parse"])
    assert pd.balance["pd-u1"] == 100 and pd.jobs["rj_1"]["status"] == "failed"
    assert await billing.papers_used(uid) == 0


async def test_paper_limit_for_registered_not_for_pro(pd, https_client, fake_parse):
    c = https_client
    h, uid = await _session(c, pd)
    for n in range(2):
        pid = (await _import(c, h, [f"W1"]))[0]["paper_id"] if n == 0 else (await _import(c, h, ["doi:10.1/x"]))[0]["paper_id"]
        assert (await _attach(c, h, pid, make_pdf(f"p{n}"), PRICE)).status_code == 200
    r = await c.post("/api/v1/papers/upload", files={"file": ("n.pdf", make_pdf("p3"), "application/pdf")},
                     data={"confirm_price": str(PRICE)}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["error"] == "paper_limit_reached" and r.json()["detail"]["limit"] == 2
    assert pd.balance["pd-u1"] == 100 - 2 * PRICE and len(pd.jobs) == 2  # 达限不会去主站预扣
    # Pro 用户不限篇数，只受积分约束
    c.cookies.clear()
    h2, _ = await _session(c, pd, "pd-u2")
    for n in range(3):
        r = await c.post("/api/v1/papers/upload", files={"file": ("n.pdf", make_pdf(f"q{n}"), "application/pdf")},
                         data={"confirm_price": str(PRICE)}, headers=h2)
        assert r.status_code == 200, r.text
    assert pd.balance["pd-u2"] == 300 - 3 * PRICE


async def test_insufficient_credits_keeps_pdf_pending(pd, https_client):
    c = https_client
    h, _ = await _session(c, pd)
    pd.balance["pd-u1"] = 10
    pid = (await _import(c, h))[0]["paper_id"]
    r = await _attach(c, h, pid, make_pdf(), PRICE)
    assert r.status_code == 402 and r.json()["detail"]["error"] == "insufficient_credits"
    assert store.get(pid)["status"] == "pdf_pending" and store.get(pid)["billing_block"] == "insufficient_credits"
    pd.balance["pd-u1"] = 100  # 第二天补发
    assert (await c.post(f"/api/v1/papers/{pid}/process", json={"confirm_price": PRICE}, headers=h)).status_code == 200


async def test_complete_deferred_when_paperdaily_down(pd, https_client, fake_parse, monkeypatch):
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]["paper_id"]
    pdf = make_pdf("d")
    assert (await _attach(c, h, pid, pdf, PRICE)).status_code == 200
    original = pd._runner

    def runner(request):
        if request.url.path.endswith("/complete") and pd.down:
            return httpx.Response(503)
        return original(request)

    pd._runner = runner

    async def parse(paper_id, *a, **k):  # claim 时主站可达；解析完成、提交 complete 时不可达
        store.update(paper_id, {"status": "completed", "markdown_content": "# ok"})
        pd.down = True

    async def translate(paper_id, user_id=None):
        store.update(paper_id, {"translation_status": "completed", "translated_content": "translated fixture"})
    monkeypatch.setattr("app.services.translation._translate_paper_background", translate)
    monkeypatch.setattr("app.api.v1.papers.parse_paper_task", parse)
    await jobs.drain(["parse"])
    charge = await billing._charge(uid, hashlib.sha256(pdf).hexdigest())
    assert charge.status == "running" and charge.completion["status"] == "succeeded"
    pd.down = False
    assert await billing.reconcile_pending() == 1
    charge = await billing._charge(uid, hashlib.sha256(pdf).hexdigest())
    assert charge.status == "settled" and pd.jobs["rj_1"]["status"] == "succeeded"


async def test_billing_off_counts_without_paperdaily(pd, https_client, fake_parse, monkeypatch):
    monkeypatch.setattr(get_settings(), "read_billing", "off")
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]["paper_id"]
    r = await _attach(c, h, pid, make_pdf())
    assert r.status_code == 200 and r.json()["billing"] == "off" and r.json()["charged"] is False
    await jobs.drain(["parse"])
    assert pd.jobs == {} and await billing.papers_used(uid) == 1 and store.get(pid)["status"] == "completed"


async def test_open_access_fetch_allowlist(pd, https_client, fake_parse, monkeypatch):
    c = https_client
    h, _ = await _session(c, pd)
    pid = (await _import(c, h))[0]["paper_id"]
    pdf = make_pdf("oa")
    seen = []

    def oa(request):
        seen.append(str(request.url))
        if request.url.path == "/pdf/1706.03762":
            return httpx.Response(302, headers={"location": "https://evil.example/x.pdf"})
        return httpx.Response(200, content=pdf)

    monkeypatch.setattr(pdf_intake, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(oa)))
    monkeypatch.setattr("app.core.url_guard.validate_public_url", lambda url: None)
    r = await c.post(f"/api/v1/papers/{pid}/fetch-pdf", json={"confirm_price": PRICE}, headers=h)
    assert r.status_code == 502 and "白名单" in r.json()["detail"]
    assert seen == ["https://arxiv.org/pdf/1706.03762"]  # 没有跟随到白名单外
    seen.clear()

    def oa_ok(request):
        seen.append(str(request.url))
        if request.url.host == "arxiv.org":
            return httpx.Response(301, headers={"location": "https://export.arxiv.org/pdf/1706.03762"})
        return httpx.Response(200, content=pdf)

    monkeypatch.setattr(pdf_intake, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(oa_ok)))
    r = await c.post(f"/api/v1/papers/{pid}/fetch-pdf", json={"confirm_price": PRICE}, headers=h)
    assert r.status_code == 200, r.text
    assert store.get(pid)["pdf"]["sha256"] == hashlib.sha256(pdf).hexdigest() and pd.balance["pd-u1"] == 100 - PRICE
    # 没有 OA 的论文
    pid2 = (await _import(c, h, ["doi:10.1/x"]))[0]["paper_id"]
    assert (await c.post(f"/api/v1/papers/{pid2}/fetch-pdf", json={}, headers=h)).status_code == 404


def test_oa_candidates_and_inspect():
    assert pdf_intake.oa_candidates({"external_full_text_url": "https://arxiv.org/abs/2101.00001v2"}) == ["https://arxiv.org/pdf/2101.00001"]
    assert pdf_intake.oa_candidates({"external_full_text_url": "http://arxiv.org/pdf/1"}) == []  # 非 https
    assert pdf_intake.oa_candidates({"external_full_text_url": "https://arxiv.org.evil.com/pdf/1"}) == []
    assert pdf_intake.oa_candidates({"doi": "10.1/x", "external_full_text_url": "https://doi.org/10.1/x"}) == []
    with pytest.raises(pdf_intake.IntakeError):
        pdf_intake.inspect_pdf(b"<html>")
    meta = pdf_intake.inspect_pdf(make_pdf(pages=4))
    assert meta["pages"] == 4 and len(meta["sha256"]) == 64


async def test_chat_limit_by_tier(pd, https_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "read_chat_daily_limit_free", 2)
    from app.api.deps import charge_ai_quota
    from app.services.paperdaily import sessions

    c = https_client
    h, uid = await _session(c, pd)
    await c.get("/api/v1/billing/status", headers=h)  # 缓存档位
    await charge_ai_quota(uid)
    await charge_ai_quota(uid)
    with pytest.raises(Exception) as e:
        await charge_ai_quota(uid)
    assert e.value.status_code == 403


async def test_research_metadata_pdf_attachment_keeps_question_workspace(pd, https_client, fake_parse):
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]['paper_id']
    workspace = f'/api/v1/papers/{pid}/reading-workspace'
    assert (await c.put(workspace, headers=h, json={'version':0,'focus':'Preserve my research focus'})).status_code == 200
    attached = await _attach(c, h, pid, make_pdf('attached in place'), PRICE)
    assert attached.status_code == 200, attached.text
    assert attached.json()['paper_id'] == pid
    assert (await c.get(workspace, headers=h)).json()['focus'] == 'Preserve my research focus'
    assert store.get(pid)['source_id'] == 'W1'


async def test_admission_http_failure_keeps_pdf_retryable(pd, https_client, fake_parse, monkeypatch):
    from fastapi import HTTPException
    c = https_client
    h, uid = await _session(c, pd)
    pid = (await _import(c, h))[0]['paper_id']
    original = billing.admit
    async def unavailable(*args, **kwargs):
        raise HTTPException(503, 'entitlements temporarily unavailable')
    monkeypatch.setattr(billing, 'admit', unavailable)
    result = await _attach(c, h, pid, make_pdf('retry admission'), PRICE)
    assert result.status_code == 503
    assert store.get(pid)['status'] == 'pdf_pending' and store.get(pid)['file_path']
    assert pd.jobs == {}
    monkeypatch.setattr(billing, 'admit', original)
    retry = await c.post(f'/api/v1/papers/{pid}/process', headers=h, json={'confirm_price': PRICE})
    assert retry.status_code == 200, retry.text


async def test_lost_admission_reply_replays_exact_body_and_key(pd, https_client, fake_parse, monkeypatch):
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyUnavailable
    c = https_client
    headers, user = await _session(c, pd)
    paper_id = (await _import(c, headers))[0]['paper_id']
    original = api.create_read_job
    lost = False
    requests = []

    async def flaky(token, key_id, body, idem):
        nonlocal lost
        result = await original(token, key_id, body, idem)
        if body['confirmed_price_version'] == VERSION:
            requests.append((canonical(body), idem))
            if not lost:
                lost = True
                raise PaperDailyUnavailable('lost response after commit')
        return result
    monkeypatch.setattr(api, 'create_read_job', flaky)
    first = await _attach(c, headers, paper_id, make_pdf('lost admission'), PRICE)
    assert first.status_code == 503
    assert len(pd.jobs) == 1 and pd.balance['pd-u1'] == 100 - PRICE
    retry = await c.post(f'/api/v1/papers/{paper_id}/process', headers=headers, json={'confirm_price': PRICE})
    assert retry.status_code == 200, retry.text
    assert len(pd.jobs) == 1 and pd.balance['pd-u1'] == 100 - PRICE
    assert len(requests) == 2 and requests[0] == requests[1]


async def test_heartbeat_failure_cancels_work_and_prevents_success(pd, https_client, fake_parse, monkeypatch):
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyUnavailable
    c = https_client
    headers, user = await _session(c, pd)
    paper_id = (await _import(c, headers))[0]['paper_id']
    fake_parse['delay'] = 1
    assert (await _attach(c, headers, paper_id, make_pdf('heartbeat loss'), PRICE)).status_code == 200

    async def unavailable(*args):
        raise PaperDailyUnavailable('offline')
    monkeypatch.setattr(api, 'heartbeat', unavailable)
    await jobs.drain(["parse"])
    assert store.get(paper_id)['status'] == 'failed'
    assert not store.get(paper_id).get('translated_content')
    assert pd.balance['pd-u1'] == 100


async def test_unknown_charge_never_executes_unmetered_work(pd, https_client, fake_parse):
    c = https_client
    headers, user = await _session(c, pd)
    paper_id = (await _import(c, headers))[0]['paper_id']
    assert (await _attach(c, headers, paper_id, make_pdf('unknown'), PRICE)).status_code == 200
    charge = await billing.charge_of_paper(paper_id)
    await billing._update(charge.id, status='unknown')
    called = False
    async def work():
        nonlocal called
        called = True
    with pytest.raises(billing.BillingBlocked):
        await billing.run_billed(paper_id, work)
    assert called is False
    retry = await c.post(f'/api/v1/papers/{paper_id}/process', headers=headers, json={'confirm_price': PRICE})
    assert retry.status_code == 409
    assert len(pd.jobs) == 1


async def test_capacity_rejection_waits_without_repeating_hold(pd, https_client, fake_parse, monkeypatch):
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyError
    headers, user = await _session(https_client, pd)
    paper_id = (await _import(https_client, headers))[0]['paper_id']
    assert (await _attach(https_client, headers, paper_id, make_pdf('capacity retry'), PRICE)).status_code == 200
    original = api.claim
    attempts = 0
    async def busy_once(job_id):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise PaperDailyError(429, 'read_runner_capacity')
        return await original(job_id)
    monkeypatch.setattr(api, 'claim', busy_once)
    monkeypatch.setattr(billing, 'CLAIM_BACKOFF_SECONDS', 0.01)
    await jobs.drain(['parse'])
    assert attempts == 2 and len(pd.jobs) == 1
    assert pd.balance['pd-u1'] == 100 - PRICE
    assert pd.jobs['rj_1']['status'] == 'succeeded'
