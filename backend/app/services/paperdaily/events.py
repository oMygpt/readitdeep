"""
主站事件：webhook 推送 + 游标对账拉取（契约 §5、§6）。

签名：X-PD-Signature: v1=hex(HMAC_SHA256(webhook_secret, "{timestamp}.{event_id}.{hex(sha256(body))}"))，
轮换期可能并列多个 v1=；时间窗 ±300 秒；event_id 去重；先落库与处理（含 tombstone）再 ack。
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Mapping, Optional

from sqlalchemy import func, select

from app.config import get_settings
from app.core.database import async_session_maker
from app.core.timeutil import utcnow
from app.models.provider import ProviderEvent
from app.services.paperdaily import client, sessions

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 300
KNOWN_TYPES = {"grant.revoked", "account.deleted", "entitlements.changed"}


def sign(secret: str, timestamp: str, event_id: str, body: bytes) -> str:
    msg = f"{timestamp}.{event_id}.{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(headers: Mapping[str, str], body: bytes, now: Optional[float] = None) -> bool:
    secret = get_settings().paperdaily_webhook_secret
    if not secret:
        return False
    ts = headers.get("x-pd-timestamp", "")
    event_id = headers.get("x-pd-event-id", "")
    if headers.get("x-pd-client") != get_settings().paperdaily_client_id or not ts.isdigit() or not event_id:
        return False
    if abs((now or time.time()) - int(ts)) > WINDOW_SECONDS:
        return False
    expected = sign(secret, ts, event_id, body)
    provided = [p.strip()[3:] for p in headers.get("x-pd-signature", "").split(",") if p.strip().startswith("v1=")]
    return any(hmac.compare_digest(expected, p) for p in provided)


def subject_of(event: dict) -> Optional[str]:
    """主站事件里的用户标识：subject.sub（并核对 issuer）；兼容旧提案里的 user_id"""
    subject = event.get("subject")
    if isinstance(subject, dict):
        if subject.get("issuer") != get_settings().paperdaily_issuer:
            logger.warning("Event %s from unexpected issuer %s ignored", event.get("event_id"), subject.get("issuer"))
            return None
        return str(subject.get("sub") or "") or None
    return str(event["user_id"]) if event.get("user_id") else None


async def handle(event: dict) -> bool:
    """幂等处理一个事件。返回 True 表示本次新处理，False 表示此前已处理。"""
    event_id = str(event.get("event_id") or "")
    if not event_id:
        raise ValueError("event_id 缺失")
    async with async_session_maker() as db:
        existing = await db.get(ProviderEvent, event_id)
        if existing is not None and existing.processed_at is not None:
            return False
        if existing is None:
            db.add(ProviderEvent(event_id=event_id, type=str(event.get("type")), cursor=event.get("cursor"),
                                 payload=event, received_at=utcnow()))
            await db.commit()

    etype = event.get("type")
    if etype == "grant.revoked" and event.get("grant_id"):
        n = await sessions.revoke_grant(str(event["grant_id"]), str(event.get("reason") or "grant_revoked"))
        logger.info("grant.revoked %s → %d sessions", event["grant_id"], n)
    elif etype == "account.deleted" and subject_of(event):
        await sessions.delete_account(subject_of(event))
    elif etype not in KNOWN_TYPES:
        logger.warning("Unknown PaperDaily event type %s (%s) recorded without action", etype, event_id)

    async with async_session_maker() as db:
        row = await db.get(ProviderEvent, event_id)
        row.processed_at = utcnow()
        await db.commit()
    return True


async def last_cursor() -> int:
    async with async_session_maker() as db:
        value = (await db.execute(select(func.max(ProviderEvent.cursor)).where(ProviderEvent.processed_at.is_not(None)))).scalar()
    return int(value or 0)


async def pull_once() -> int:
    """从上次处理到的游标开始补拉事件。返回处理条数。"""
    cursor = await last_cursor()
    handled = 0
    acks: list[str] = []
    while True:
        page = await client.events_after(cursor, acks)
        acks = []
        for event in page.get("events") or []:
            if await handle(event):
                handled += 1
            acks.append(str(event["event_id"]))  # 先落库处理，下一次请求再 ack
        cursor = int(page.get("next_cursor") or cursor)
        if not page.get("has_more"):
            if acks:
                await client.events_after(cursor, acks)
            return handled
