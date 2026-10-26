"""
主站 connect 接口客户端（服务端到服务端，HTTP Basic client 凭证）。
5xx / 超时 / 网络错误统一抛 PaperDailyUnavailable —— 调用方据此在敏感操作上返回 503。
"""

from __future__ import annotations

import base64
from typing import Any, Optional

import httpx

from app.config import get_settings

TIMEOUT = 10.0


class PaperDailyUnavailable(RuntimeError):
    pass


class PaperDailyError(RuntimeError):
    def __init__(self, status: int, error: str, description: str = ""):
        super().__init__(f"{status} {error} {description}".strip())
        self.status, self.error, self.description = status, error, description


def _basic() -> str:
    s = get_settings()
    raw = f"{s.paperdaily_client_id}:{s.paperdaily_client_secret}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _url(path: str) -> str:
    return get_settings().paperdaily_base_url.rstrip("/") + path


# 测试替换这个工厂即可接入模拟主站
def http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT)


async def _call(method: str, path: str, *, json: Optional[dict] = None, params: Optional[dict] = None) -> Any:
    try:
        async with http_client() as c:
            r = await c.request(method, _url(path), json=json, params=params, headers={"Authorization": _basic()})
    except httpx.HTTPError as e:
        raise PaperDailyUnavailable(f"PaperDaily 不可达: {type(e).__name__}") from e
    if r.status_code >= 500:
        raise PaperDailyUnavailable(f"PaperDaily 返回 {r.status_code}")
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400:
        raise PaperDailyError(r.status_code, body.get("error", "error"), body.get("error_description", ""))
    return body


def authorize_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode

    s = get_settings()
    params = {
        "response_type": "code",
        "client_id": s.paperdaily_client_id,
        "redirect_uri": redirect_uri(),
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if s.paperdaily_scopes:
        params["scope"] = s.paperdaily_scopes
    return s.paperdaily_web_url.rstrip("/") + f"/connect/{s.paperdaily_client_id}?" + urlencode(params)


def redirect_uri() -> str:
    return get_settings().public_base_url.rstrip("/") + "/api/auth/paperdaily/callback"


async def exchange_code(code: str, verifier: str) -> dict:
    return await _call("POST", "/api/auth/connect/token", json={
        "grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": redirect_uri(),
    })


async def introspect(token: str) -> dict:
    return await _call("POST", "/api/auth/connect/introspect", json={"token": token})


async def revoke(token: str) -> None:
    await _call("POST", "/api/auth/connect/revoke", json={"token": token})


async def events_after(cursor: int, ack_event_ids: Optional[list[str]] = None, limit: int = 100) -> dict:
    """拉取 cursor 之后的事件，同时确认（ack）上一批已处理的事件"""
    return await _call("POST", "/api/auth/connect/events",
                       json={"after_cursor": cursor, "limit": limit, "ack_event_ids": ack_event_ids or []})
