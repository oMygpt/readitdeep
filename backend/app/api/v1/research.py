"""Owner-only research bridge, explicit evidence selection and publication previews."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.timeutil import as_utc, utcnow
from app.models.annotation import TeamAnnotation
from app.models.paper import Paper
from app.models.research import ResearchComparison, ResearchPublication
from app.models.user import User
from app.services.paperdaily import research_client as pd
from app.services.paperdaily.documents import live_owner, store_document

router = APIRouter(prefix="/research")


async def question_snapshot(token: str, question_id: int) -> dict:
    data = await pd.call(token, "GET", f"/api/v1/me/questions/{question_id}")
    if not isinstance(data, dict) or data.get("id") != question_id or not data.get("question"):
        raise HTTPException(502, "研究问题响应无效")
    return {key: data.get(key) for key in ("id", "question", "status", "updated_at")}


@router.get("/questions")
async def questions(
    request: Request, response: Response, user: User = Depends(get_current_user), offset: int = 0
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if not 0 <= offset <= 10000:
        raise HTTPException(422, "分页参数无效")
    token = await pd.delegation(request, user, "read:reading")
    return await pd.call(
        token, "GET", "/api/v1/me/questions", params={"limit": 100, "offset": offset}
    )


class ImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    paper_id: str = Field(min_length=1, max_length=512, pattern=r"^[^\x00-\x1f]+$")
    fulltext: bool = True


@router.post("/import")
async def import_paper(
    body: ImportIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    token = await pd.delegation(request, user, "read:paper")
    metadata = await pd.call(token, "GET", "/api/v1/papers/resolve", params={"id": body.paper_id})

    async def recheck(scope: str) -> str:
        return await pd.delegation(request, user, scope)

    return await store_document(metadata, user, db, recheck, fulltext=body.fulltext)


class ComparisonItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    annotation_id: str = Field(max_length=36)
    relationship: Literal["unassessed", "supports", "challenges", "boundary", "method"] = (
        "unassessed"
    )
    judgement: str = Field(default="", max_length=4000)


class ComparisonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(default=0, ge=0)
    title: str = Field(min_length=1, max_length=200)
    question_id: int | None = Field(default=None, ge=1)
    items: list[ComparisonItem] = Field(default_factory=list, max_length=100)
    notes: str = Field(default="", max_length=20000)


async def evidence_rows(db: AsyncSession, uid: str, ids: list[str] | None = None) -> list:
    query = (
        select(TeamAnnotation, Paper)
        .join(Paper, TeamAnnotation.paper_id == Paper.id)
        .where(
            TeamAnnotation.user_id == uid,
            Paper.user_id == uid,
            TeamAnnotation.is_evidence.is_(True),
        )
    )
    if ids is not None:
        query = query.where(TeamAnnotation.id.in_(ids))
    return list(
        (await db.execute(query.order_by(TeamAnnotation.created_at.desc()).limit(500))).all()
    )


def evidence_view(annotation: TeamAnnotation, paper: Paper) -> dict:
    return {
        "id": annotation.id,
        "paper_id": paper.id,
        "paper_title": paper.title or paper.filename,
        "source_id": paper.source_id if paper.source_provider == "paperdaily" else None,
        "quote": annotation.selected_text,
        "note": annotation.content,
        "anchor": annotation.anchor,
        "research_question": annotation.research_question,
    }


@router.get("/evidence")
async def evidence(
    response: Response, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return {"items": [evidence_view(a, p) for a, p in await evidence_rows(db, user.id)]}


def comparison_view(row: ResearchComparison) -> dict:
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "title",
            "question",
            "items",
            "notes",
            "version",
            "remote_id",
            "pending_id",
        )
    }


async def owned(db: AsyncSession, model: type, row_id: str, uid: str):
    row = await db.get(model, row_id)
    if row is None or row.user_id != uid:
        raise HTTPException(404, "记录不存在")
    return row


@router.get("/comparisons")
async def comparisons(
    response: Response, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    rows = (
        await db.scalars(
            select(ResearchComparison)
            .where(ResearchComparison.user_id == user.id)
            .order_by(ResearchComparison.updated_at.desc())
            .limit(100)
        )
    ).all()
    return {"items": [comparison_view(row) for row in rows]}


@router.put("/comparisons/{comparison_id}")
async def save_comparison(
    comparison_id: str,
    body: ComparisonIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        uuid.UUID(comparison_id)
    except ValueError as exc:
        raise HTTPException(422, "比较 ID 无效") from exc
    current = await db.get(ResearchComparison, comparison_id)
    if current and current.user_id != user.id:
        raise HTTPException(404, "记录不存在")
    ids = [item.annotation_id for item in body.items]
    if len(set(ids)) != len(ids) or len(await evidence_rows(db, user.id, ids)) != len(ids):
        raise HTTPException(422, "所选证据已移除或无权使用，请重新选择")
    question = current.question if current else None
    if body.question_id != (question or {}).get("id"):
        question = (
            await question_snapshot(
                await pd.delegation(request, user, "read:reading"), body.question_id
            )
            if body.question_id
            else None
        )
    if (
        body.question_id != ((current.question if current else None) or {}).get("id")
        and body.question_id
    ):
        await pd.delegation(request, user, "read:reading")
    values = dict(
        title=body.title.strip(),
        question=question,
        items=[item.model_dump() for item in body.items],
        notes=body.notes,
        version=body.version + 1,
        updated_at=utcnow(),
    )
    if not values["title"]:
        raise HTTPException(422, "请填写比较标题")
    await live_owner(db, user)
    if current is None and body.version == 0:
        insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
        result = await db.execute(
            insert(ResearchComparison)
            .values(id=comparison_id, user_id=user.id, **values)
            .on_conflict_do_nothing(index_elements=["id"])
        )
    else:
        result = await db.execute(
            update(ResearchComparison)
            .where(
                ResearchComparison.id == comparison_id,
                ResearchComparison.user_id == user.id,
                ResearchComparison.version == body.version,
            )
            .values(**values)
        )
    if result.rowcount != 1:
        raise HTTPException(409, "比较草稿已在其他窗口更新，请重新载入")
    await db.commit()
    uid = user.id
    db.expire_all()
    return comparison_view(await owned(db, ResearchComparison, comparison_id, uid))


def publication_view(row: ResearchPublication) -> dict:
    return {key: getattr(row, key) for key in ("id", "status", "payload", "remote_id", "parent_id")}


@router.post("/comparisons/{comparison_id}/preview")
async def preview(
    comparison_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    row = await owned(db, ResearchComparison, comparison_id, user.id)
    if row.pending_id:
        return publication_view(await owned(db, ResearchPublication, row.pending_id, user.id))
    ids = [item["annotation_id"] for item in row.items]
    evidence = {a.id: (a, p) for a, p in await evidence_rows(db, user.id, ids)}
    if not ids or set(ids) != set(evidence):
        raise HTTPException(422, "请先选择仍可使用的证据")
    notes: dict[str, list[str]] = {}
    labels = {
        "unassessed": "待判断",
        "supports": "支持",
        "challenges": "质疑",
        "boundary": "适用边界",
        "method": "方法参照",
    }
    for item in row.items:
        a, p = evidence[item["annotation_id"]]
        if p.source_provider != "paperdaily" or not p.source_id:
            raise HTTPException(422, "发布前请先为所选论文建立 PaperDaily 身份；本地比较可继续保存")
        anchor = a.anchor or {}
        location = f"RiD revision {anchor.get('revision_id', 'unverified')}; {anchor.get('representation', 'unknown')}; UTF-16 {anchor.get('start', '?')}–{anchor.get('end', '?')}"
        quote = (a.selected_text or "").replace("\n", "\n> ")
        text = f"### {labels[item['relationship']]}\n\n> {quote}\n\n来源定位：{location}\n\n我的批注：{a.content or ''}\n\n比较判断：{item['judgement']}"
        notes.setdefault(p.source_id, []).append(text)
    papers = [
        {"paper_id": pid, "depth": "selected-passages", "note_md": "\n\n".join(parts)}
        for pid, parts in notes.items()
    ]
    if any(len(p["note_md"].encode()) > 65536 for p in papers):
        raise HTTPException(422, "单篇证据超出发布上限，请减少所选材料")
    payload = {
        "title": row.title,
        "provenance": {
            "kind": "readitdeep-human",
            "skill_ver": "research-bridge-v1",
            "model": "none",
        },
        "papers": papers,
        "claims": [],
        "report_md": row.notes,
    }
    if row.question:
        payload["provenance"]["question_id"] = row.question["id"]
        payload["report_md"] = f"研究问题快照：{row.question['question']}\n\n{row.notes}"
    digest = hashlib.sha256(
        json.dumps(
            {"comparison": row.id, "payload": payload}, sort_keys=True, ensure_ascii=False
        ).encode()
    ).hexdigest()
    if "\x00" in json.dumps(payload, ensure_ascii=False).replace("\\u0000", "\x00"):
        raise HTTPException(422, "所选材料含无效字符，请先修改批注再预览")
    payload["provenance"]["worklist_fingerprint"] = digest
    receipt = ResearchPublication(
        id=str(uuid.uuid4()),
        user_id=user.id,
        comparison_id=row.id,
        fingerprint=digest,
        payload=payload,
        parent_id=row.remote_id,
        status="prepared",
    )
    db.add(receipt)
    result = await db.execute(
        update(ResearchComparison)
        .where(
            ResearchComparison.id == row.id,
            ResearchComparison.version == row.version,
            ResearchComparison.pending_id.is_(None),
        )
        .values(pending_id=receipt.id)
    )
    if result.rowcount != 1:
        raise HTTPException(409, "比较已更新，请重新预览")
    await db.commit()
    return publication_view(receipt)


@router.post("/publications/{publication_id}/publish")
async def publish(
    publication_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    uid = user.id
    token = await pd.delegation(request, user, "write:reading")
    receipt = await owned(db, ResearchPublication, publication_id, user.id)
    if receipt.status == "succeeded":
        return publication_view(receipt)
    comparison = await owned(db, ResearchComparison, receipt.comparison_id, user.id)
    if comparison.pending_id != receipt.id:
        raise HTTPException(409, "发布预览已失效，请重新预览")
    if receipt.status == "sending" and as_utc(receipt.updated_at) > utcnow() - timedelta(minutes=2):
        raise HTTPException(409, "发布正在进行，请稍后查询")
    attempt_id = str(uuid.uuid4())
    previous_status = receipt.status
    result = await db.execute(
        update(ResearchPublication)
        .where(
            ResearchPublication.id == receipt.id,
            ResearchPublication.status == previous_status,
            (ResearchPublication.updated_at <= utcnow() - timedelta(minutes=2))
            if previous_status == "sending"
            else ResearchPublication.status == previous_status,
        )
        .values(status="sending", attempt_id=attempt_id, updated_at=utcnow())
        .execution_options(synchronize_session="fetch")
    )
    if result.rowcount != 1:
        raise HTTPException(409, "发布正在进行")
    await db.commit()
    path = "/api/v1/me/reading-sessions"
    if receipt.parent_id:
        path += f"/{receipt.parent_id}/revisions"
    phase = "remote"
    try:
        result = await pd.call(token, "POST", path, body=receipt.payload)
        phase = "verify"
        if not isinstance(result, dict) or not isinstance(result.get("id"), str):
            raise HTTPException(502, "发布回执无效")
        await pd.delegation(request, user, "write:reading")
        await live_owner(db, user)
    except HTTPException as exc:
        await db.rollback()
        rejected = (
            previous_status in ("prepared", "rejected")
            and phase == "remote"
            and isinstance(exc.detail, dict)
            and 400 <= exc.detail.get("upstream_status", 0) < 500
        )
        # UPDATE only: a deletion while waiting must not recreate a receipt.
        await db.execute(
            update(ResearchPublication)
            .where(
                ResearchPublication.id == publication_id,
                ResearchPublication.user_id == uid,
                ResearchPublication.attempt_id == attempt_id,
                ResearchPublication.status == "sending",
            )
            .values(status="rejected" if rejected else "unknown", updated_at=utcnow())
        )
        await db.commit()
        raise
    remote_id = result["id"]
    finalized = await db.execute(
        update(ResearchPublication)
        .where(
            ResearchPublication.id == publication_id,
            ResearchPublication.attempt_id == attempt_id,
            ResearchPublication.status == "sending",
        )
        .values(status="succeeded", remote_id=remote_id, updated_at=utcnow())
    )
    if finalized.rowcount != 1:
        await db.rollback()
        raise HTTPException(409, "此请求已由另一轮重试接管，请重新载入回执")
    await db.execute(
        update(ResearchComparison)
        .where(
            ResearchComparison.id == receipt.comparison_id,
            ResearchComparison.pending_id == publication_id,
        )
        .values(remote_id=remote_id, pending_id=None)
    )
    await db.commit()
    receipt.status, receipt.remote_id = "succeeded", remote_id
    return publication_view(receipt)


@router.delete("/publications/{publication_id}")
async def discard_preview(
    publication_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    receipt = await owned(db, ResearchPublication, publication_id, user.id)
    result = await db.execute(
        update(ResearchPublication)
        .where(
            ResearchPublication.id == receipt.id,
            ResearchPublication.status.in_(("prepared", "rejected")),
        )
        .values(status="cancelled")
    )
    if result.rowcount != 1:
        raise HTTPException(409, "已发送的内容需要按原预览重试，不能撤销回执")
    await db.execute(
        update(ResearchComparison)
        .where(
            ResearchComparison.id == receipt.comparison_id,
            ResearchComparison.pending_id == receipt.id,
        )
        .values(pending_id=None)
    )
    await db.commit()
    return {"cancelled": True}


@router.get("/resolve")
async def resolve_source(
    paper_id: str, request: Request, response: Response, user: User = Depends(get_current_user)
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if not 0 < len(paper_id) <= 512 or any(ord(ch) < 32 for ch in paper_id):
        raise HTTPException(422, "论文标识无效")
    token = await pd.delegation(request, user, "read:paper")
    data = await pd.call(token, "GET", "/api/v1/papers/resolve", params={"id": paper_id})
    return {key: data.get(key) for key in ("id", "title", "doi", "authors")}


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=200)


@router.post("/papers/{paper_id}/source")
async def bind_source(
    paper_id: str,
    body: SourceIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from sqlalchemy.exc import IntegrityError

    paper = await owned(db, Paper, paper_id, user.id)
    token = await pd.delegation(request, user, "read:paper")
    metadata = await pd.call(token, "GET", "/api/v1/papers/resolve", params={"id": body.source_id})
    if metadata.get("id") != body.source_id:
        raise HTTPException(422, "请先核对并确认主站返回的规范标识")
    await pd.delegation(request, user, "read:paper")
    await live_owner(db, user)
    if paper.source_provider and (
        paper.source_provider != "paperdaily" or paper.source_id != body.source_id
    ):
        raise HTTPException(409, "此论文已关联其他来源身份")
    duplicate = await db.scalar(
        select(Paper).where(
            Paper.user_id == user.id,
            Paper.source_provider == "paperdaily",
            Paper.source_id == body.source_id,
            Paper.id != paper_id,
        )
    )
    if duplicate:
        if not duplicate.markdown_content and not duplicate.file_path:
            raise HTTPException(
                409,
                f"文献库已有无正文题录「{duplicate.title or duplicate.filename}」。可在文献库删除这条空题录后重试关联；以后可在导入页直接为题录上传原文。",
            )
        raise HTTPException(409, "文献库已有此主站论文的原文，请使用已有论文的证据")
    try:
        result = await db.execute(
            update(Paper)
            .where(Paper.id == paper_id, Paper.user_id == user.id, Paper.source_provider.is_(None))
            .values(source_provider="paperdaily", source_id=body.source_id)
        )
        if result.rowcount != 1:
            current = (
                await db.execute(
                    select(Paper.source_provider, Paper.source_id).where(
                        Paper.id == paper_id, Paper.user_id == user.id
                    )
                )
            ).one_or_none()
            if not current or current != ("paperdaily", body.source_id):
                raise HTTPException(409, "论文身份已在其他窗口变更，请重新核对")
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "文献库已有此主站论文，请使用已有论文的证据") from exc
    return {"paper_id": paper_id, "source_id": body.source_id}


@router.get("/publications/{publication_id}")
async def publication_status(
    publication_id: str,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return publication_view(await owned(db, ResearchPublication, publication_id, user.id))
