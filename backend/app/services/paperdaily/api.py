"""
以用户身份（委托 key，Bearer）调用主站 v1 接口，以及 read-jobs 受信 runner 接口。

- 用户接口：权益、余额、论文题录、收藏/个人库/合集、综述历史、read-jobs 创建/状态/取消；
- 签名（主站 api/read_jobs.py）：
  - client assertion（actor=read）与 runner assertion（actor=runner_id）：
    HMAC_SHA256(secret, canonical({version:"read-assertion-v1", actor, method, path, body_sha256, timestamp, nonce, key_id}))
    头：X-Read-Actor / X-Read-Timestamp（10 位秒）/ X-Read-Nonce / X-Read-Signature；runner 的 key_id 为 "-"
  - preflight 回执：HMAC_SHA256(runner_secret, canonical({version:"read-preflight-v1", **asset 除 signature}))
- 错误：5xx/网络 → PaperDailyUnavailable；4xx → PaperDailyError（带 status 与 detail）。
委托 key 只在服务端解密使用，从不下发浏览器。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from app.config import get_settings
from app.services.paperdaily import client
from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

V1 = "/api/v1"


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def assertion_headers(actor: str, secret: str, method: str, path: str, body: bytes, key_id: str = "-") -> dict:
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    payload = canonical({
        "version": "read-assertion-v1", "actor": actor, "method": method, "path": path,
        "body_sha256": hashlib.sha256(body).hexdigest(), "timestamp": timestamp, "nonce": nonce, "key_id": key_id,
    })
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return {"X-Read-Actor": actor, "X-Read-Timestamp": timestamp, "X-Read-Nonce": nonce, "X-Read-Signature": signature}


def sign_preflight(asset: dict) -> dict:
    secret = get_settings().paperdaily_runner_secret
    payload = canonical({"version": "read-preflight-v1", **{k: v for k, v in asset.items() if k != "signature"}})
    return {**asset, "signature": hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()}


def _detail(r: httpx.Response) -> tuple[str, Any]:
    try:
        body = r.json()
    except ValueError:
        return "error", None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict):
        return str(detail.get("code") or "error"), detail
    return str(detail or (body.get("error") if isinstance(body, dict) else "") or "error"), body


async def _request(method: str, path: str, *, token: Optional[str] = None, body: Optional[dict] = None,
                   params: Optional[dict] = None, headers: Optional[dict] = None) -> Any:
    raw = canonical(body) if body is not None else b""
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    if body is not None:
        h["Content-Type"] = "application/json"
    try:
        async with client.http_client() as c:
            r = await c.request(method, client._url(path), content=raw if body is not None else None, params=params, headers=h)
    except httpx.HTTPError as e:
        raise PaperDailyUnavailable(f"PaperDaily 不可达: {type(e).__name__}") from e
    if r.status_code >= 500:
        raise PaperDailyUnavailable(f"PaperDaily 返回 {r.status_code}")
    if r.status_code >= 400:
        code, detail = _detail(r)
        err = PaperDailyError(r.status_code, code)
        err.detail = detail
        raise err
    return r.json() if r.content else {}


def body_bytes(body: dict) -> bytes:
    return canonical(body)


# ---------------- 用户身份（委托 key） ----------------


async def entitlements(token: str) -> dict:
    return await _request("GET", f"{V1}/me/entitlements", token=token)


async def balance(token: str) -> dict:
    return await _request("GET", f"{V1}/me/credits/balance", token=token)


async def get_paper(token: str, paper_id: str) -> dict:
    return await _request("GET", f"{V1}/papers/{quote(paper_id, safe='')}", token=token)


async def saves(token: str, limit: int = 200) -> dict:
    return await _request("GET", f"{V1}/me/saves", token=token, params={"limit": limit})


async def collections(token: str) -> list:
    return await _request("GET", f"{V1}/me/library/collections", token=token)


async def library(token: str, params: Optional[dict] = None) -> dict:
    return await _request("GET", f"{V1}/me/library", token=token, params=params or {})


async def query_history(token: str, history_id: int) -> dict:
    return await _request("GET", f"{V1}/me/query-history/{int(history_id)}", token=token)


async def create_read_job(token: str, key_id: str, job: dict, idempotency_key: str) -> dict:
    s = get_settings()
    path = f"{V1}/me/read-jobs"
    headers = assertion_headers("read", s.paperdaily_assertion_secret, "POST", path, body_bytes(job), key_id or "-")
    headers["Idempotency-Key"] = idempotency_key
    return await _request("POST", path, token=token, body=job, headers=headers)


async def cancel_read_job(token: str, job_id: str) -> dict:
    return await _request("POST", f"{V1}/me/read-jobs/{quote(job_id, safe='')}/cancel", token=token)


# ---------------- 受信 runner ----------------


async def _runner(job_id: str, op: str, body: Optional[dict]) -> dict:
    s = get_settings()
    path = f"/api/internal/read-jobs/{quote(job_id, safe='')}/{op}"
    raw = body_bytes(body) if body is not None else b""
    headers = assertion_headers(s.paperdaily_runner_id, s.paperdaily_runner_secret, "POST", path, raw)
    return await _request("POST", path, body=body, headers=headers)


async def claim(job_id: str) -> dict:
    return await _runner(job_id, "claim", None)


async def heartbeat(job_id: str, fence: int) -> dict:
    return await _runner(job_id, "heartbeat", {"fence": fence})


async def complete(job_id: str, completion: dict) -> dict:
    return await _runner(job_id, "complete", completion)
