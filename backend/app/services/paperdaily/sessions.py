"""
关联模式的登录状态、provider session 与核验规则（设计 §2.7 / 主站 v2.2 §3.3）。

- 授权跳转前保存 state + PKCE verifier，绑定浏览器 cookie（防登录 CSRF），10 分钟有效、用后即删；
- 登录成功后按 subject.sub 建/取本地用户（永不按邮箱合并），建 provider session：委托 key 只存 AES-GCM 密文，绝对期限 = min(30 天, key 到期)；
- 本地只发 ≤15 分钟的 JWT（含 sid），续签必须实时 introspect；
- 请求核验：GET 读取接受 60 秒内的核验结果，写入/上传/AI/导出实时核验；主站无法确认 → 503。
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import logging
import secrets
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from fastapi import HTTPException, status
from sqlalchemy import delete, select

from app.config import get_settings
from app.core.database import Base, async_session_maker
from app.core.timeutil import as_utc, utcnow
from app.models.provider import AccountTombstone, ConnectState, ProviderSession
from app.models.user import User
from app.services.paperdaily import client, crypto

logger = logging.getLogger(__name__)

PROVIDER = "paperdaily"
# 本次请求已核验的 provider session（get_current_user 设置）；计费、导入等服务端调用主站时使用
current_sid: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("pd_current_sid", default=None)
STATE_TTL = timedelta(minutes=10)
READ_CACHE = timedelta(seconds=60)
MAX_SESSION = timedelta(days=30)


def is_linked() -> bool:
    return get_settings().rid_mode == "linked"


def safe_return_to(value: Optional[str]) -> str:
    """只接受站内相对路径：以单个 / 开头；原文和逐层解码后都不能是 //host、含反斜杠或控制字符。"""
    if not value:
        return "/"
    candidate = value
    for _ in range(3):
        if (not candidate.startswith("/") or candidate.startswith("//") or "\\" in candidate
                or any(ord(ch) < 32 for ch in candidate)):
            return "/"
        candidate = unquote(candidate)
    return value[:1000]


# ---------------- 授权跳转 ----------------


async def begin_login(return_to: Optional[str], *, research: bool = False) -> tuple[str, str]:
    """返回 (主站授权 URL, 浏览器 cookie 值)"""
    state = secrets.token_urlsafe(32)
    browser_nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    async with async_session_maker() as db:
        await db.execute(delete(ConnectState).where(ConnectState.created_at < utcnow() - STATE_TTL))
        db.add(ConnectState(state=state, browser_nonce=browser_nonce, code_verifier=verifier,
                            return_to=safe_return_to(return_to), created_at=utcnow()))
        await db.commit()
    from app.services.paperdaily.research_client import research_scopes
    return client.authorize_url(state, challenge, research_scopes() if research else None), browser_nonce


async def consume_state(state: str, browser_nonce: Optional[str]) -> ConnectState:
    async with async_session_maker() as db:
        row = await db.get(ConnectState, state)
        if row is not None:
            await db.delete(row)  # 一次性：无论成败都删
            await db.commit()
    if row is None or not browser_nonce or not secrets.compare_digest(row.browser_nonce, browser_nonce):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "登录请求已失效，请重新登录")
    if as_utc(row.created_at) < utcnow() - STATE_TTL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "登录请求已过期，请重新登录")
    return row


# ---------------- 用户映射与会话 ----------------


async def _find_or_link_user(db, subject: str) -> User:
    """只按 (provider, subject.sub) 映射，**永不按邮箱合并**（主站契约 identity_link）。
    既有本地账号要继续使用，须由运维用 scripts/link_paperdaily_account.py 显式绑定。"""
    tomb = await db.get(AccountTombstone, (PROVIDER, subject))
    if tomb is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "该 PaperDaily 账号已删除")
    user = (await db.execute(select(User).where(User.external_provider == PROVIDER, User.external_subject == subject))).scalar_one_or_none()
    if user is None:
        # 主站不下发邮箱等资料（scope 为空）：用占位邮箱，只作本站内部唯一键
        user = User(email=f"pd-{subject}@users.paperdaily.invalid", username="PaperDaily 用户",
                    role="user", external_provider=PROVIDER, external_subject=subject)
        user.set_password(secrets.token_urlsafe(32))  # 不可用的随机密码：关联模式不允许密码登录
        db.add(user)
    admins = {x.strip() for x in get_settings().paperdaily_admin_subjects.split(",") if x.strip()}
    if subject in admins:
        user.role = "admin"
    if user.is_active is False:  # 新建对象在入库前为 None（列默认值 True）
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账户已禁用")
    user.last_login = utcnow()
    return user


async def complete_login(token_response: dict) -> tuple[User, ProviderSession]:
    subject_obj = token_response.get("subject") or {}
    subject = str(subject_obj.get("sub") or "") if isinstance(subject_obj, dict) else ""
    if not subject or not token_response.get("access_token") or not token_response.get("grant_id"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "PaperDaily 返回的授权信息不完整")
    if subject_obj.get("issuer") != get_settings().paperdaily_issuer:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "PaperDaily 授权签发方不符")
    if token_response.get("expires_at"):
        expires = as_utc(datetime.fromisoformat(str(token_response["expires_at"]).replace("Z", "+00:00")))
    else:
        expires = utcnow() + timedelta(seconds=int(token_response.get("expires_in") or 0))
    now = utcnow()
    async with async_session_maker() as db:
        user = await _find_or_link_user(db, subject)
        await db.flush()
        sid = secrets.token_urlsafe(32)
        aad = crypto.associated_data(user.id, get_settings().paperdaily_client_id, token_response["grant_id"], sid)
        version, nonce, ct = crypto.encrypt(token_response["access_token"], aad)
        session = ProviderSession(
            id=sid, user_id=user.id, provider=PROVIDER, grant_id=token_response["grant_id"],
            key_id=(str(token_response["key_id"])[:100] if token_response.get("key_id") else None),
            auth_version=int(token_response.get("auth_version") or 0), key_version=version, key_nonce=nonce,
            key_ciphertext=ct, scope=token_response.get("scope"), expires_at=min(expires, now + MAX_SESSION),
            last_verified_at=now, created_at=now,
        )
        db.add(session)
        await db.commit()
        await db.refresh(user)
    return user, session


def _token_of(session: ProviderSession) -> str:
    aad = crypto.associated_data(session.user_id, get_settings().paperdaily_client_id, session.grant_id, session.id)
    return crypto.decrypt(session.key_version, session.key_nonce, session.key_ciphertext, aad)


async def _revoke_local(db, session: ProviderSession, reason: str) -> None:
    if session.revoked_at is None:
        session.revoked_at = utcnow()
        session.revoke_reason = reason[:50]


async def verify(sid: Optional[str], user_id: str, *, sensitive: bool) -> ProviderSession:
    """核验本地会话仍有效；需要时向主站 introspect。失败抛 401/503。"""
    if not sid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "请使用 PaperDaily 账号重新登录")
    async with async_session_maker() as db:
        session = await db.get(ProviderSession, sid)
        now = utcnow()
        if session is None or session.user_id != user_id or session.revoked_at is not None or as_utc(session.expires_at) <= now:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已失效，请重新登录")
        fresh = session.last_verified_at is not None and as_utc(session.last_verified_at) > now - READ_CACHE
        if fresh and not sensitive:
            return session
        try:
            result = await client.introspect(_token_of(session))
        except client.PaperDailyUnavailable as e:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "暂时无法确认 PaperDaily 授权，请稍后重试") from e
        except client.PaperDailyError as e:
            logger.error("introspect rejected by PaperDaily: %s", e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "暂时无法确认 PaperDaily 授权，请稍后重试") from e
        if not result.get("active") or str(result.get("grant_id")) != session.grant_id:
            await _revoke_local(db, session, "introspect_inactive")
            await db.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "PaperDaily 授权已失效，请重新登录")
        if int(result.get("auth_version") or 0) != session.auth_version:
            await _revoke_local(db, session, "auth_version_changed")
            await db.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "PaperDaily 账号安全信息已变化，请重新登录")
        session.last_verified_at = now
        await db.commit()
        return session


async def logout(sid: Optional[str]) -> None:
    if not sid:
        return
    async with async_session_maker() as db:
        session = await db.get(ProviderSession, sid)
        if session is None or session.revoked_at is not None:
            return
        try:
            await client.revoke(_token_of(session))
        except Exception as e:  # 主站稍后仍会推 grant.revoked；本地先作废
            logger.warning("PaperDaily revoke failed: %s", e)
        await _revoke_local(db, session, "logout")
        await db.commit()


async def revoke_grant(grant_id: str, reason: str) -> int:
    async with async_session_maker() as db:
        rows = (await db.execute(select(ProviderSession).where(ProviderSession.grant_id == grant_id))).scalars().all()
        for s in rows:
            await _revoke_local(db, s, reason or "grant_revoked")
        await db.commit()
    return len(rows)


async def delete_account(subject: str) -> bool:
    """主站删号：删除该外部身份在本站的全部数据（论文、文件、工作台、批注、会话……）并留 tombstone。"""
    from app.core.database import import_all_models
    from app.core.files import images_root
    from app.core.store import store

    import_all_models()
    async with async_session_maker() as db:
        if await db.get(AccountTombstone, (PROVIDER, subject)) is None:
            db.add(AccountTombstone(provider=PROVIDER, subject=subject))
        user = (await db.execute(select(User).where(User.external_provider == PROVIDER, User.external_subject == subject))).scalar_one_or_none()
        if user is None:
            await db.commit()
            return False
        uid = user.id
        await db.commit()

    for paper in store.get_by_user(uid):  # 文件先删（数据库行删掉后就找不到路径了）
        full = store.get(paper["id"]) or {}
        if full.get("file_path"):
            Path(full["file_path"]).unlink(missing_ok=True)
        shutil.rmtree(images_root() / paper["id"], ignore_errors=True)
    shutil.rmtree(Path("data/uploads") / uid, ignore_errors=True)

    async with async_session_maker() as db:
        # SQLite 不强制外键级联：按列名显式删除所有归属该用户的行，再删用户
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "users" and "user_id" in table.c:
                await db.execute(table.delete().where(table.c.user_id == uid))
        await db.execute(delete(User).where(User.id == uid))
        await db.commit()
    logger.warning("Deleted RiD data for PaperDaily subject %s (account.deleted)", subject)
    return True
