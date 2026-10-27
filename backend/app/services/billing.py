"""
Read it DEEP - 按篇计费（设计 2026-10-27 v0.2 §4）

- 计费单位：每个用户每个 PDF 内容（SHA-256）一次，覆盖 OCR/解析、全文翻译与自动分析；
- 篇数在本站计（read_charges）：注册用户每周期 READ_FREE_PAPER_LIMIT 篇，Pro/机构/管理员不限；
- 积分与主站同步：READ_BILLING=paperdaily 时，处理前在主站 read-jobs 预扣（hold），
  本站 worker 作为受信 runner claim → heartbeat → complete，主站结算或冲正；
- READ_BILLING=off：只计篇数、不经主站（独立模式与主站计费开通前）；
- 独立模式（standalone）：沿用本地 PLAN_LIMITS，记一行 funding=standalone 便于统计。
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select, text

from app.config import get_settings
from app.core.database import async_session_maker, engine
from app.core.timeutil import utcnow
from app.models.provider import ProviderSession
from app.models.read_charge import COUNTED, ReadCharge
from app.models.user import User

logger = logging.getLogger(__name__)

BEIJING = timezone(timedelta(hours=8))
TIER_CACHE_SECONDS = 60
PREFLIGHT_SECONDS = 600  # 主站要求 ≤ 900
CLAIM_BACKOFF_SECONDS = 5
HEARTBEAT_SECONDS = 30   # 主站租约 60 秒

PAID_TIERS = {"pro", "institution", "admin"}

_tier_cache: dict[str, tuple[float, str]] = {}
_price_cache: dict[str, object] = {"price": None, "price_version": None}


def is_linked() -> bool:
    return get_settings().rid_mode == "linked"


def billing_mode() -> str:
    """standalone | off | paperdaily"""
    return get_settings().read_billing if is_linked() else "standalone"


def period_key(now: Optional[datetime] = None) -> str:
    if get_settings().read_free_paper_period == "lifetime":
        return "lifetime"
    return (now or utcnow()).astimezone(BEIJING).strftime("%Y-%m")


# ---------------- 主站身份 ----------------


@dataclass(frozen=True)
class Delegation:
    token: str
    key_id: str
    grant_id: str
    subject: str


async def delegation(sid: Optional[str], user: User) -> Delegation:
    """当前请求对应的主站委托 key（只在服务端解密）"""
    from app.services.paperdaily import sessions

    sid = sid or sessions.current_sid.get()
    if not sid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "请使用 PaperDaily 账号重新登录")
    async with async_session_maker() as db:
        session = await db.get(ProviderSession, sid)
    if session is None or session.user_id != user.id or session.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已失效，请重新登录")
    return Delegation(sessions._token_of(session), session.key_id or "-", session.grant_id, user.external_subject or "")


def tier_from_entitlements(ent: dict) -> str:
    """主站 P5 提供 plan_tier 之前，按 credits.daily_grant 的来源前缀判断档位"""
    tier = ent.get("plan_tier")
    if isinstance(tier, str) and tier:
        return tier
    source = str(((ent.get("limits") or {}).get("credits.daily_grant") or {}).get("source") or "")
    if source.startswith("plan:"):
        return "pro"
    if source.startswith("institution:"):
        return "institution"
    if source == "account:verified":
        return "registered"
    return "unverified"


async def tier_of(user: User, sid: Optional[str]) -> str:
    if user.is_admin:
        return "admin"
    if not is_linked():
        return "standalone"
    cached = _tier_cache.get(user.id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

    try:
        tier = tier_from_entitlements(await api.entitlements((await delegation(sid, user)).token))
    except (PaperDailyUnavailable, PaperDailyError) as e:
        logger.warning("entitlements unavailable for %s: %s", user.id, e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "暂时无法确认 PaperDaily 权益，请稍后重试") from e
    _tier_cache[user.id] = (time.monotonic() + TIER_CACHE_SECONDS, tier)
    return tier


def paper_limit(tier: str) -> Optional[int]:
    if tier in PAID_TIERS or tier == "standalone":
        return None
    if tier == "unverified":
        return 0
    return max(0, get_settings().read_free_paper_limit)


async def papers_used(user_id: str, period: Optional[str] = None) -> int:
    period = period or period_key()
    stmt = select(func.count()).select_from(ReadCharge).where(
        ReadCharge.user_id == user_id, ReadCharge.status.in_(COUNTED))
    if period != "lifetime":
        stmt = stmt.where(ReadCharge.period_key == period)
    async with async_session_maker() as db:
        return int((await db.execute(stmt)).scalar() or 0)


async def status_for(user: User, sid: Optional[str]) -> dict:
    """前端上传前显示：本篇价格、余额、已用篇数"""
    mode = billing_mode()
    out: dict = {"mode": mode, "period": period_key(), "price": None, "price_version": None, "balance": None}
    tier = await tier_of(user, sid)
    out["tier"] = tier
    out["papers_limit"] = paper_limit(tier)
    out["papers_used"] = await papers_used(user.id)
    if mode == "paperdaily":
        out["price"], out["price_version"] = _price_cache["price"], _price_cache["price_version"]
        from app.services.paperdaily import api
        from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

        try:
            out["balance"] = await api.balance((await delegation(sid, user)).token)
        except (PaperDailyUnavailable, PaperDailyError) as e:
            logger.warning("balance unavailable: %s", e)
    return out


# ---------------- 准入（预扣） ----------------


class BillingBlocked(HTTPException):
    """不能开始处理：PDF 已保存，论文停在 pdf_pending，用户处理后可重试"""

    def __init__(self, code: int, reason: str, message: str, **extra):
        super().__init__(code, {"error": reason, "message": message, **extra})
        self.reason = reason


async def _charge(user_id: str, sha: str) -> Optional[ReadCharge]:
    async with async_session_maker() as db:
        return (await db.execute(select(ReadCharge).where(
            ReadCharge.user_id == user_id, ReadCharge.content_sha256 == sha))).scalar_one_or_none()


async def _save(user_id: str, sha: str, paper_id: str, **values) -> ReadCharge:
    async with async_session_maker() as db:
        row = (await db.execute(select(ReadCharge).where(
            ReadCharge.user_id == user_id, ReadCharge.content_sha256 == sha))).scalar_one_or_none()
        if row is None:
            row = ReadCharge(id=str(uuid.uuid4()), user_id=user_id, content_sha256=sha)
            db.add(row)
        row.paper_id = paper_id
        row.pd_fence = None
        row.error = None
        row.completion = None
        for k, v in values.items():
            setattr(row, k, v)
        row.updated_at = utcnow()
        await db.commit()
        await db.refresh(row)
        return row


_admission_locks: dict[str, asyncio.Lock] = {}


@asynccontextmanager
async def admission_lock(user_id: str) -> AsyncIterator[None]:
    """Serialize per-user quota and durable intent, across workers on PostgreSQL."""
    if engine.dialect.name == "postgresql":
        lock_id = int.from_bytes(hashlib.sha256(("rid-admission:" + user_id).encode()).digest()[:8], signed=True)
        async with engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": lock_id})
            yield
    else:
        async with _admission_locks.setdefault(user_id, asyncio.Lock()):
            yield


async def admit(user: User, sid: Optional[str], paper_id: str, pdf: dict,
                confirm_price: Optional[int] = None) -> tuple[ReadCharge, bool]:
    async with admission_lock(user.id):
        return await _admit_locked(user, sid, paper_id, pdf, confirm_price)


async def _admit_locked(user: User, sid: Optional[str], paper_id: str, pdf: dict, confirm_price: Optional[int] = None) -> tuple[ReadCharge, bool]:
    """为一份 PDF 取得处理资格。返回 (计费记录, 是否本次新扣费)。
    同一用户同一内容已计过费 → 直接复用，不再扣；被拦下时抛 BillingBlocked。"""
    sha = pdf["sha256"]
    existing = await _charge(user.id, sha)
    if existing is not None and existing.status == "admitting":
        return await _admit_paperdaily(user, sid, paper_id, pdf, existing.period_key, confirm_price), True
    if existing is not None and existing.status in {"held", "running", "unknown"}:
        raise BillingBlocked(409, "billing_pending", "这份PDF的原作业尚未确认结束，请核对原作业后重试")
    if existing is not None and existing.status in COUNTED:
        if existing.paper_id != paper_id:
            logger.info("PDF %s already charged for user %s (paper %s); reusing", sha[:12], user.id, existing.paper_id)
        return existing, False

    mode = billing_mode()
    period = period_key()
    common = dict(period_key=period, pages=int(pdf["pages"]), price=0, price_version=None, pd_job_id=None)
    if mode == "standalone":
        return await _save(user.id, sha, paper_id, status="free", funding="standalone", **common), True

    tier = await tier_of(user, sid)
    limit = paper_limit(tier)
    if limit is not None:
        used = await papers_used(user.id, period)
        if used >= limit:
            label = "本月" if period != "lifetime" else "累计"
            raise BillingBlocked(status.HTTP_403_FORBIDDEN, "paper_limit_reached",
                                 f"注册用户{label}可精读 {limit} 篇 PDF，已用 {used} 篇；Pro 与机构用户不限篇数",
                                 used=used, limit=limit, period=period)
    if mode == "off":
        return await _save(user.id, sha, paper_id, status="free", funding="off", **common), True
    return await _admit_paperdaily(user, sid, paper_id, pdf, period, confirm_price), True


async def _admit_paperdaily(user: User, sid: Optional[str], paper_id: str, pdf: dict, period: str,
                            confirm_price: Optional[int]) -> ReadCharge:
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

    s = get_settings()
    if not (s.paperdaily_runner_secret and s.paperdaily_assertion_secret):
        raise BillingBlocked(status.HTTP_503_SERVICE_UNAVAILABLE, "billing_unconfigured", "精读计费尚未开通，请稍后再试")
    d = await delegation(sid, user)

    def job_body(price, version) -> dict:
        asset = api.sign_preflight({
            "receipt_id": uuid.uuid4().hex, "kind": "blob", "asset_id": paper_id.replace("-", ""), "paper_id": None,
            "owner_id": d.subject, "grant_id": d.grant_id, "operation": "read.parse",
            "content_sha256": pdf["sha256"], "byte_length": int(pdf["bytes"]), "pages": int(pdf["pages"]),
            "expires_at": int(time.time()) + PREFLIGHT_SECONDS, "signer": s.paperdaily_runner_id,
        })
        return {"operation": "read.parse", "asset": asset, "parameters": {},
                "confirmed_price": int(price) if isinstance(price, int) and price >= 0 else 0,
                "confirmed_price_version": str(version or "unknown")}

    existing = await _charge(user.id, pdf["sha256"])
    replay = bool(existing and existing.status == "admitting" and existing.admission)
    envelope = existing.admission if replay else {
        "body": job_body(confirm_price if confirm_price is not None else _price_cache["price"], _price_cache["price_version"]),
        "idempotency_key": uuid.uuid4().hex,
    }
    for attempt in range(2):
        await _save(user.id, pdf["sha256"], paper_id, status="admitting", funding="paperdaily",
                    period_key=period, pages=int(pdf["pages"]), price=envelope["body"]["confirmed_price"],
                    admission=envelope)
        try:
            result = await api.create_read_job(d.token, d.key_id, envelope["body"], envelope["idempotency_key"])
            break
        except PaperDailyUnavailable as exc:
            # Main may already have committed a hold: preserve the exact body/key.
            raise BillingBlocked(503, "billing_unconfirmed", "原计费请求尚未确认，请重试核对原请求；不会创建第二份预扣") from exc
        except PaperDailyError as exc:
            detail = getattr(exc, "detail", None)
            if exc.status == 409 and isinstance(detail, dict) and detail.get("code") == "read_quote_confirmation_required":
                _price_cache.update(price=detail.get("price"), price_version=detail.get("price_version"))
                # This specific response guarantees admission rolled back, so a new quote is safe.
                await _save(user.id, pdf["sha256"], paper_id, status="failed", funding="paperdaily",
                            period_key=period, pages=int(pdf["pages"]), admission=None)
                if attempt == 0 and confirm_price is not None and detail.get("price") == confirm_price:
                    envelope = {"body": job_body(confirm_price, detail["price_version"]), "idempotency_key": uuid.uuid4().hex}
                    replay = False
                    continue
                raise BillingBlocked(409, "price_confirmation_required", f"本篇将消耗 {detail.get('price')} 积分，请确认",
                                     price=detail.get("price"), price_version=detail.get("price_version")) from exc
            if replay:
                raise BillingBlocked(503, "billing_unconfirmed", "暂时无法核对原计费请求，请保留原请求等待对账") from exc
            await _save(user.id, pdf["sha256"], paper_id, status="failed", funding="paperdaily",
                        period_key=period, pages=int(pdf["pages"]), admission=None)
            if exc.status == 402:
                raise BillingBlocked(402, "insufficient_credits", "今日积分不足，积分每天补发；也可以先阅读已解析的论文") from exc
            if exc.status in (401, 403):
                raise BillingBlocked(403, "not_entitled", "当前 PaperDaily 账号暂不能使用精读（需验证邮箱或重新授权）", provider_code=exc.error) from exc
            if exc.status == 413:
                raise BillingBlocked(413, "too_large", "PDF 页数或大小超过上限") from exc
            raise BillingBlocked(503, "billing_unavailable", "精读计费暂不可用，请稍后重试") from exc
    else:
        raise BillingBlocked(503, "billing_unconfirmed", "原计费请求尚未确认")
    if result.get("status") != "queued":
        final = {"succeeded": "settled", "failed": "failed", "cancelled": "cancelled"}.get(result.get("status"), "unknown")
        await _save(user.id, pdf["sha256"], paper_id, status=final, funding="paperdaily", period_key=period,
                    pages=int(pdf["pages"]), pd_job_id=result["job_id"], admission=None)
        raise BillingBlocked(409, "billing_pending", "原作业已有执行状态，请核对原结果")
    _price_cache.update(price=result.get("price"), price_version=result.get("price_version"))
    return await _save(user.id, pdf["sha256"], paper_id, status="held", funding="paperdaily", period_key=period,
                       pages=int(pdf["pages"]), price=int(result.get("price") or 0),
                       price_version=result.get("price_version"), pd_job_id=result["job_id"], admission=envelope)


# ---------------- 受信 runner：执行期间与主站同步 ----------------


async def charge_of_paper(paper_id: str) -> Optional[ReadCharge]:
    async with async_session_maker() as db:
        return (await db.execute(select(ReadCharge).where(
            ReadCharge.paper_id == paper_id,
            ReadCharge.funding == "paperdaily").order_by(ReadCharge.updated_at.desc()))).scalars().first()


async def _update(charge_id: str, **values) -> None:
    async with async_session_maker() as db:
        row = await db.get(ReadCharge, charge_id)
        for k, v in values.items():
            setattr(row, k, v)
        row.updated_at = utcnow()
        await db.commit()


async def run_billed(paper_id: str, work) -> None:
    """执行一次已计费的处理：claim → 周期 heartbeat（主站要求停止则中断）→ complete。
    没有主站计费记录（off / standalone / 复用旧计费）时直接执行。"""
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

    charge = await charge_of_paper(paper_id)
    if charge is None:
        await work()
        return
    if charge.status == "settled":
        await work()
        return
    if charge.status != "held":
        raise BillingBlocked(409, "billing_pending", "原计费作业尚未确认结束，不能重复执行")
    try:
        deadline = ((charge.admission or {}).get("body", {}).get("asset", {}).get("expires_at") or int(time.time()) + PREFLIGHT_SECONDS)
        while True:
            try:
                lease = await api.claim(charge.pd_job_id)
                break
            except PaperDailyError as exc:
                if exc.status != 429 or time.time() >= deadline:
                    raise
                await asyncio.sleep(min(CLAIM_BACKOFF_SECONDS, max(0.01, deadline - time.time())))
    except (PaperDailyUnavailable, PaperDailyError) as e:
        # 预检过期、授权撤销或主站拒绝：不执行（主站对账会冲正未开始的作业）
        await _update(charge.id, status="unknown", error=f"claim: {type(e).__name__}")
        from app.core.store import store

        store.update(paper_id, {"status": "pdf_pending", "billing_block": "claim_failed",
                                "error_message": "原计费作业执行状态待核对，请等待对账后再处理"})
        return
    fence = int(lease["fence"])
    await _update(charge.id, status="running", pd_fence=fence)
    started = time.monotonic()
    task = asyncio.create_task(work())
    stopped_by_pd = False
    while not task.done():
        done, _ = await asyncio.wait({task}, timeout=HEARTBEAT_SECONDS)
        if done:
            break
        try:
            beat = await api.heartbeat(charge.pd_job_id, fence)
            if beat.get("stop"):
                stopped_by_pd = True
                task.cancel()
        except (PaperDailyUnavailable, PaperDailyError):
            logger.warning("heartbeat unavailable for job %s", charge.pd_job_id)
            stopped_by_pd = True
            task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("billed work crashed for paper %s", paper_id)
    from app.core.store import store

    paper = store.get(paper_id) or {}
    markdown = (paper.get("markdown_content") or "").encode()
    ok = not stopped_by_pd and paper.get("status") not in ("failed", "parsing", "pdf_pending") and bool(markdown)
    if stopped_by_pd:
        store.update(paper_id, {"status": "failed", "error_message": "PaperDaily 要求停止处理（授权变化或超时），本次不扣分"})
    completion = {
        "fence": fence, "receipt_id": uuid.uuid4().hex, "operation": "read.parse", "asset_sha256": charge.content_sha256,
        "status": "succeeded" if ok else ("cancelled" if stopped_by_pd else "failed"), "execution_stopped": True,
        "output_sha256": hashlib.sha256(markdown).hexdigest() if ok else None, "output_bytes": len(markdown) if ok else 0,
        "elapsed_ms": int((time.monotonic() - started) * 1000), "external_cost_micros": 0,
    }
    await _update(charge.id, completion=completion)
    await submit_completion(charge.id)


async def submit_completion(charge_id: str) -> bool:
    """把待送达的 complete 提交给主站；成功后按主站终态更新本地状态。可重复调用（receipt 幂等）。"""
    from app.services.paperdaily import api
    from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

    async with async_session_maker() as db:
        row = await db.get(ReadCharge, charge_id)
    if row is None or not row.completion:
        return False
    try:
        result = await api.complete(row.pd_job_id, row.completion)
    except PaperDailyUnavailable as e:
        logger.warning("complete deferred for %s: %s", row.pd_job_id, e)
        return False
    except PaperDailyError as e:
        logger.error("complete rejected for %s: %s", row.pd_job_id, e)
        await _update(charge_id, status="unknown", error=f"complete: {e}"[:500])
        return False
    job_status = ((result or {}).get("job") or {}).get("status")
    if not result.get("accepted"):
        await _update(charge_id, status="unknown", error=f"complete: {result.get('disposition')}"[:500])
        return False
    final = {"succeeded": "settled", "failed": "failed", "cancelled": "cancelled"}.get(job_status, "unknown")
    await _update(charge_id, status=final, completion=None, admission=None)
    return True


async def reconcile_pending() -> int:
    """补交主站不可达时未送达的 complete（启动时与每 5 分钟）"""
    async with async_session_maker() as db:
        ids = [r[0] for r in (await db.execute(select(ReadCharge.id).where(ReadCharge.completion.is_not(None)))).all()]
    done = 0
    for charge_id in ids:
        if await submit_completion(charge_id):
            done += 1
    # An authoritative terminal status may resolve a claim/lease uncertainty.
    from app.services.paperdaily import api, sessions
    from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable
    async with async_session_maker() as db:
        pending = (await db.execute(select(ReadCharge).where(ReadCharge.status == "unknown", ReadCharge.pd_job_id.is_not(None)))).scalars().all()
    for row in pending:
        async with async_session_maker() as db:
            session = (await db.execute(select(ProviderSession).where(ProviderSession.user_id == row.user_id, ProviderSession.revoked_at.is_(None)).order_by(ProviderSession.created_at.desc()))).scalars().first()
        if session is None:
            continue
        try:
            result = await api.read_job_status(sessions._token_of(session), row.pd_job_id)
        except (PaperDailyError, PaperDailyUnavailable):
            continue
        final = {"succeeded": "settled", "failed": "failed", "cancelled": "cancelled"}.get(result.get("status"))
        if final:
            await _update(row.id, status=final, completion=None, admission=None)
            done += 1
    return done


# ---------------- 交互 AI 每日次数（linked） ----------------


async def charge_chat(user: User, sid: Optional[str]) -> None:
    """问答、划词翻译、解释等不扣积分，按档位限每日次数；主站暂不可达时按注册档限"""
    s = get_settings()
    try:
        tier = await tier_of(user, sid)
    except HTTPException:
        tier = "registered"
    if tier == "admin":
        return
    limit = s.read_chat_daily_limit_paid if tier in PAID_TIERS else s.read_chat_daily_limit_free
    async with async_session_maker() as db:
        row = await db.get(User, user.id)
        row.reset_daily_quota_if_needed()
        if (row.daily_ai_used or 0) >= limit:
            await db.commit()
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
                "error": "quota_exceeded", "message": f"今日 AI 问答次数已用完（{limit} 次/天），明天恢复",
                "quota": {"ai": {"daily_used": row.daily_ai_used, "daily_limit": limit}}})
        row.daily_ai_used = (row.daily_ai_used or 0) + 1
        await db.commit()
