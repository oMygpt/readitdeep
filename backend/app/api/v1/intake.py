"""
Read it DEEP - 题录导入与 PDF 入库（设计 2026-10-27 v0.2 §2–§4）

- POST /papers/import/paperdaily              按主站 paper_id 导入题录（最多 50 篇，幂等，不计费）
- POST /papers/import/paperdaily/collection   导入主站合集
- POST /papers/import/paperdaily/review       导入主站综述（问题、答案 + 引文题录）
- POST /papers/{id}/pdf                        为题录补传 PDF（计费 → 解析）
- POST /papers/{id}/fetch-pdf                  从开放获取白名单来源抓取 PDF（计费 → 解析）
- POST /papers/{id}/process                    之前被拦下（待确认价格 / 积分不足 / 达到篇数）的 PDF 重新处理
- GET  /billing/status                         本篇价格、余额、已用篇数
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import require_paper_owner
from app.api.v1.auth import get_current_user
from app.core.store import store
from app.core.timeutil import utcnow
from app.models.user import User
from app.services import billing, pdf_intake
from app.services.paperdaily.client import PaperDailyError, PaperDailyUnavailable

logger = logging.getLogger(__name__)
router = APIRouter()
billing_router = APIRouter()

PROVIDER = "paperdaily"
MAX_IMPORT = 50


def _sid(request: Request) -> Optional[str]:
    return getattr(request.state, "pd_sid", None)


def _require_linked() -> None:
    if not billing.is_linked():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "本站未关联 PaperDaily")


def _pd_error(e: Exception) -> HTTPException:
    if isinstance(e, PaperDailyUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "暂时连不上 PaperDaily，请稍后重试")
    if isinstance(e, PaperDailyError) and e.status in (401, 403):
        return HTTPException(status.HTTP_403_FORBIDDEN, "PaperDaily 授权不包含此操作，请重新登录并同意授权")
    if isinstance(e, PaperDailyError) and e.status == 404:
        return HTTPException(status.HTTP_404_NOT_FOUND, "PaperDaily 上找不到该内容")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "PaperDaily 返回了错误")


# ---------------- 题录导入 ----------------


def _find_imported(user_id: str, source_id: str) -> Optional[dict]:
    from sqlalchemy import select

    from app.models.paper import Paper

    with store.engine.connect() as conn:
        row = conn.execute(select(Paper.id).where(
            Paper.user_id == user_id, Paper.source_provider == PROVIDER, Paper.source_id == source_id)).first()
    return store.get(row[0]) if row else None


def _add_tag(paper_id: str, tag: Optional[str]) -> None:
    if not tag:
        return
    paper = store.get(paper_id) or {}
    tags = paper.get("tags") or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except ValueError:
            tags = [tags]
    if tag not in tags:
        store.update(paper_id, {"tags": [*tags, tag]})


async def import_papers(user: User, sid: Optional[str], paper_ids: list[str], tag: Optional[str] = None) -> list[dict]:
    from app.services.paperdaily import api

    from app.core.database import async_session_maker
    from app.services.paperdaily import sessions
    from app.services.paperdaily.documents import store_document

    async def recheck(scope: str) -> str:
        session = await sessions.verify(sid or sessions.current_sid.get(), user.id, sensitive=True)
        if scope not in (session.scope or "").split():
            raise HTTPException(403, "PaperDaily 授权不包含此操作，请连接研究权限")
        return sessions._token_of(session)

    token = await recheck("read:paper")
    results = []
    for pd_id in dict.fromkeys(p.strip() for p in paper_ids if p and p.strip()):
        try:
            detail = await api.get_paper(token, pd_id)
        except (PaperDailyUnavailable, PaperDailyError) as e:
            if isinstance(e, PaperDailyUnavailable) or (isinstance(e, PaperDailyError) and e.status in (401, 403)):
                raise _pd_error(e)
            results.append({"source_id": pd_id, "paper_id": None, "status": "error", "error": _pd_error(e).detail})
            continue
        async with async_session_maker() as db:
            imported = await store_document(detail, user, db, recheck)
        _add_tag(imported["paper_id"], tag)
        paper = store.get(imported["paper_id"]) or {}
        results.append({"source_id": detail["id"], "paper_id": imported["paper_id"], "status": paper.get("status"),
                        "created": not imported["duplicate"], "oa_available": bool(pdf_intake.oa_candidates(paper))})
    return results


class ImportPapersRequest(BaseModel):
    paper_ids: list[str] = Field(min_length=1, max_length=MAX_IMPORT)
    title: Optional[str] = Field(default=None, max_length=100)  # 多篇时作为标签（文件夹）名


@router.post("/import/paperdaily")
async def import_from_paperdaily(body: ImportPapersRequest, request: Request, user: User = Depends(get_current_user)):
    _require_linked()
    tag = body.title.strip() if body.title and len(body.paper_ids) > 1 else None
    return {"items": await import_papers(user, _sid(request), body.paper_ids, tag)}


class ImportCollectionRequest(BaseModel):
    collection_id: str = Field(min_length=1, max_length=200)


@router.post("/import/paperdaily/collection")
async def import_collection(body: ImportCollectionRequest, request: Request, user: User = Depends(get_current_user)):
    from app.services.paperdaily import api

    _require_linked()
    d = await billing.delegation(_sid(request), user)
    try:
        cols = await api.collections(d.token)
        listing = await api.library(d.token, {"collection_id": body.collection_id, "limit": MAX_IMPORT})
    except (PaperDailyUnavailable, PaperDailyError) as e:
        raise _pd_error(e)
    name = next((c.get("name") for c in cols or [] if str(c.get("id")) == body.collection_id), None) or "PaperDaily 合集"
    ids = [str(i.get("paper_id")) for i in (listing.get("items") or []) if i.get("paper_id")][:MAX_IMPORT]
    return {"title": name, "items": await import_papers(user, _sid(request), ids, f"合集：{name}"[:100])}


class ImportReviewRequest(BaseModel):
    history_id: int = Field(ge=1)
    resume: bool = False


def _review_job(user_id: str, history_id: int) -> Optional[dict]:
    from app.core import jobs
    key = str(uuid.uuid5(uuid.NAMESPACE_URL, f"rid-review:{user_id}:{history_id}"))
    return jobs.get(key)


def _review_result(job: dict) -> dict:
    payload = job.get("payload") or {}
    return {"job_id": job["id"], "status": job["status"],
            "question": payload.get("question", ""), "answer": payload.get("answer", ""),
            "items": payload.get("items", []), "total": len(payload.get("ids", [])),
            "cited_total": payload.get("cited_total", 0),
            "error": "导入未完成，已导入题录已保留；请重新连接授权后检查。" if job["status"] == "failed" else None}


@router.get("/import/paperdaily/review/{history_id}")
async def review_status(history_id: int, user: User = Depends(get_current_user)) -> dict:
    _require_linked()
    job = _review_job(user.id, history_id)
    if not job or job["user_id"] != user.id:
        raise HTTPException(404, "导入任务不存在")
    return _review_result(job)


@router.post("/import/paperdaily/review")
async def import_review(body: ImportReviewRequest, request: Request, user: User = Depends(get_current_user)):
    from app.services.paperdaily import api
    from app.core import jobs
    from app.models.job import Job
    from sqlalchemy.exc import IntegrityError

    _require_linked()
    existing = _review_job(user.id, body.history_id)
    if existing:
        if body.resume and existing["status"] == "failed":
            from sqlalchemy import update
            await billing.delegation(_sid(request), user)
            with store.engine.begin() as conn:
                conn.execute(update(Job).where(Job.id == existing["id"], Job.status == "failed").values(
                    status="queued", attempts=0, error=None, finished_at=None,
                    payload={**existing["payload"], "sid": _sid(request)}))
            if jobs.worker:
                jobs.worker.wake()
            existing = jobs.get(existing["id"])
        return _review_result(existing)
    d = await billing.delegation(_sid(request), user)
    try:
        review = await api.query_history(d.token, body.history_id)
    except (PaperDailyUnavailable, PaperDailyError) as e:
        raise _pd_error(e)
    all_ids = list(dict.fromkeys(str(x) for x in (review.get("cited_paper_ids") or [])))
    key = str(uuid.uuid5(uuid.NAMESPACE_URL, f"rid-review:{user.id}:{body.history_id}"))
    payload = {"ids": all_ids[:MAX_IMPORT], "cited_total": len(all_ids),
               "question": str(review.get("question") or ""), "answer": review.get("answer") or "",
               "sid": _sid(request), "items": []}
    try:
        with store.engine.begin() as conn:
            conn.execute(Job.__table__.insert().values(id=key, kind="import_review", user_id=user.id,
                         status="queued", attempts=0, payload=payload, created_at=utcnow()))
    except IntegrityError:
        pass  # Concurrent reopen returns the same durable job.
    if jobs.worker:
        jobs.worker.wake()
    return _review_result(jobs.get(key))


async def run_review_import(job: dict) -> None:
    from app.core.database import async_session_maker
    from app.models.job import Job
    from sqlalchemy import update

    from app.core import jobs

    payload = dict((jobs.get(job["id"]) or job)["payload"])
    async with async_session_maker() as db:
        user = await db.get(User, job["user_id"])
        if user is None or not user.is_active:
            raise RuntimeError("Import owner unavailable")
        done = {item["source_id"] for item in payload["items"]}
        for source_id in payload["ids"]:
            if source_id in done:
                continue
            items = await import_papers(user, payload.get("sid"), [source_id],
                                       f"综述：{payload['question'][:40]}" if payload['question'] else "PaperDaily 综述")
            payload = {**payload, "items": [*payload["items"], *items]}
            with store.engine.begin() as conn:
                conn.execute(update(Job).where(Job.id == job["id"]).values(payload=payload))


# ---------------- PDF 入库与计费 ----------------


async def attach_pdf(user: User, sid: Optional[str], paper: dict, content: bytes, filename: str,
                     confirm_price: Optional[int]) -> dict:
    try:
        meta = pdf_intake.inspect_pdf(content)
    except pdf_intake.IntakeError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    from app.core.database import async_session_maker
    from app.models.paper import Paper
    from app.services.paperdaily.documents import live_owner
    from app.services.paperdaily import sessions
    from sqlalchemy import select

    if billing.is_linked():
        await sessions.verify(sid or sessions.current_sid.get(), user.id, sensitive=True)
    paper_id = paper["id"]
    # The same row lock arbitrates registered Markdown and uploaded PDF content.
    async with async_session_maker() as db:
        await live_owner(db, user)
        current = await db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id).with_for_update())
        if current is None:
            raise HTTPException(404, "题录不存在")
        if current.markdown_content or current.status not in ("metadata", "pdf_pending", "failed"):
            raise HTTPException(409, "此论文已有正文或正在处理，请重新载入")
        path = pdf_intake.save_pdf(user.id, paper_id, filename, content)
        old = current.file_path
        current.file_path, current.filename = path, filename[:500]
        current.extra = {**(current.extra or {}), "pdf": meta, "billing_block": None}
        current.status, current.error_message = "uploading", None
        await db.commit()
    if old and old != path:
        try:
            import os
            os.remove(old)
        except OSError:
            pass
    return await process(user, sid, paper_id, confirm_price)


async def process(user: User, sid: Optional[str], paper_id: str, confirm_price: Optional[int]) -> dict:
    paper = store.get(paper_id) or {}
    meta = paper.get("pdf")
    if not meta or not paper.get("file_path"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这篇论文还没有 PDF")
    try:
        charge, new = await billing.admit(user, sid, paper_id, meta, confirm_price)
    except billing.BillingBlocked as e:
        store.update(paper_id, {"status": "pdf_pending", "billing_block": e.reason, "error_message": e.detail["message"]})
        e.detail["paper_id"] = paper_id  # PDF 已保存，前端可据此提示并稍后调用 /process
        raise
    except HTTPException:
        # Admission may fail before a job exists; keep the saved PDF retryable.
        store.update(paper_id, {"status": "pdf_pending"})
        raise
    store.update(paper_id, {"status": "uploading", "billing_block": None, "error_message": None})
    from app.core import jobs

    jobs.submit("parse", paper_id, user.id, {"file_path": paper["file_path"], "filename": paper.get("filename") or "paper.pdf"})
    return {"paper_id": paper_id, "status": "uploading", "charged": new and charge.price > 0, "price": charge.price,
            "billing": charge.funding, "pdf": meta}


@router.post("/{paper_id}/pdf")
async def upload_pdf_for_paper(request: Request, file: UploadFile = File(...), confirm_price: Optional[int] = Form(None),
                               paper: dict = Depends(require_paper_owner), user: User = Depends(get_current_user)):
    if paper.get("status") not in ("metadata", "pdf_pending", "failed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "这篇论文已经有正文，无需再上传")
    content = await file.read()
    return await attach_pdf(user, _sid(request), paper, content, file.filename or "paper.pdf", confirm_price)


class ProcessRequest(BaseModel):
    confirm_price: Optional[int] = Field(default=None, ge=0)


@router.post("/{paper_id}/fetch-pdf")
async def fetch_pdf_for_paper(body: ProcessRequest, request: Request, paper: dict = Depends(require_paper_owner),
                              user: User = Depends(get_current_user)):
    if paper.get("status") not in ("metadata", "failed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "这篇论文已经有 PDF")
    candidates = pdf_intake.oa_candidates(paper)
    if not candidates:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有可用的开放获取 PDF，请手动上传")
    last = "没有可用的开放获取 PDF"
    for url in candidates:
        try:
            content = await pdf_intake.fetch_open_access(url)
            pdf_intake.inspect_pdf(content)
        except pdf_intake.IntakeError as e:
            last = str(e)
            continue
        store.update(paper["id"], {"pdf_source_url": url})
        name = (paper.get("arxiv_id") or paper.get("title") or "paper")[:80].replace("/", "_") + ".pdf"
        return await attach_pdf(user, _sid(request), paper, content, name, body.confirm_price)
    raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{last}，请手动上传 PDF")


@router.post("/{paper_id}/process")
async def process_pending(body: ProcessRequest, request: Request, paper: dict = Depends(require_paper_owner),
                          user: User = Depends(get_current_user)):
    if paper.get("status") != "pdf_pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "这篇论文不在待处理状态")
    return await process(user, _sid(request), paper["id"], body.confirm_price)


@billing_router.get("/status")
async def billing_status(request: Request, user: User = Depends(get_current_user)):
    return await billing.status_for(user, _sid(request))
