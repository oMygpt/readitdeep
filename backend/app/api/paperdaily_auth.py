"""
Read it DEEP - 使用 PaperDaily 账号登录（RID_MODE=linked）

    GET  /api/auth/paperdaily/login?return_to=/open?paper=…   → 302 到主站授权页
    GET  /api/auth/paperdaily/callback?code&state             → 换委托 key、建会话、设 cookie、302 回站内
    POST /api/auth/paperdaily/session                         → 凭会话 cookie 实时核验后签发 ≤15 分钟 JWT
    POST /api/auth/paperdaily/logout                          → 主站 revoke + 本地作废
    POST /api/auth/paperdaily/events                          → 主站签名 webhook

线上格式见 docs/plans/paperdaily-connect-contract.md。
"""

from __future__ import annotations

import json
import logging
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Cookie, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import get_settings
from app.core.database import async_session_maker
from app.models.provider import ProviderSession
from app.models.user import User
from app.services.paperdaily import client, events, sessions

logger = logging.getLogger(__name__)
router = APIRouter()

STATE_COOKIE = "rid_connect"
SESSION_COOKIE = "rid_sid"
COOKIE_PATH = "/api/auth/paperdaily"


def _secure() -> bool:
    return get_settings().public_base_url.startswith("https://")


def _require_linked() -> None:
    if not sessions.is_linked():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "本站未启用 PaperDaily 登录")


def _login_error(message: str) -> RedirectResponse:
    response = RedirectResponse(f"/login?error={quote(message)}", status_code=302)
    response.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
    return response


@router.get("/login")
async def login(return_to: Optional[str] = None):
    _require_linked()
    url, browser_nonce = await sessions.begin_login(return_to)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(STATE_COOKIE, browser_nonce, max_age=600, path=COOKIE_PATH,
                        httponly=True, secure=_secure(), samesite="lax")
    return response


@router.get("/callback")
async def callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    rid_connect: Optional[str] = Cookie(default=None),
):
    _require_linked()
    if error:
        return _login_error("已取消 PaperDaily 授权" if error == "access_denied" else "PaperDaily 授权失败")
    if not code or not state:
        return _login_error("登录参数不完整")
    try:
        pending = await sessions.consume_state(state, rid_connect)
        token = await client.exchange_code(code, pending.code_verifier)
        user, session = await sessions.complete_login(token)
    except HTTPException as e:
        return _login_error(str(e.detail))
    except client.PaperDailyUnavailable:
        return _login_error("PaperDaily 暂时不可用，请稍后重试")
    except client.PaperDailyError as e:
        logger.warning("PaperDaily token exchange rejected: %s", e.error)
        return _login_error("授权已失效，请重新登录")
    response = RedirectResponse(pending.return_to or "/", status_code=302)
    response.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
    max_age = max(60, int((session.expires_at - session.created_at).total_seconds()))
    response.set_cookie(SESSION_COOKIE, session.id, max_age=max_age, path=COOKIE_PATH,
                        httponly=True, secure=_secure(), samesite="strict")
    return response


@router.post("/session")
async def session_token(rid_sid: Optional[str] = Cookie(default=None)):
    """凭会话 cookie 换本地短 JWT。每次实时向主站核验。"""
    _require_linked()
    from app.api.v1.auth import create_access_token

    if not rid_sid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    async with async_session_maker() as db:
        row = await db.get(ProviderSession, rid_sid)
        user = await db.get(User, row.user_id) if row else None
    if row is None or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已失效，请重新登录")
    await sessions.verify(rid_sid, user.id, sensitive=True)
    minutes = min(15, max(1, get_settings().linked_jwt_minutes))
    return {
        "access_token": create_access_token(user.id, user.role, sid=rid_sid, minutes=minutes),
        "token_type": "bearer",
        "expires_in": minutes * 60,
        "user": user.to_dict(),
    }


@router.post("/logout")
async def logout(rid_sid: Optional[str] = Cookie(default=None)):
    _require_linked()
    await sessions.logout(rid_sid)
    response = JSONResponse({"success": True})
    response.delete_cookie(SESSION_COOKIE, path=COOKIE_PATH)
    return response


@router.post("/events")
async def receive_event(request: Request):
    _require_linked()
    body = await request.body()
    if not events.verify_signature({k.lower(): v for k, v in request.headers.items()}, body):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature")
    try:
        event = json.loads(body)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid json") from e
    if str(event.get("event_id")) != request.headers.get("x-pd-event-id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "event_id mismatch")
    await events.handle(event)
    return {"ack": event["event_id"]}
