"""Canonical owner-scoped document imports, shared with the PDF intake workflow."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper import Paper
from app.models.provider import AccountTombstone
from app.models.user import User
from app.services.paperdaily import research_client as pd


async def live_owner(db: AsyncSession, user: User) -> None:
    """Re-check after remote waits; account deletion must never recreate content."""
    exists = await db.scalar(
        select(User.id).where(User.id == user.id, User.is_active.is_(True)).with_for_update()
    )
    tomb = (
        await db.get(AccountTombstone, ("paperdaily", user.external_subject))
        if user.external_subject
        else None
    )
    if not exists or tomb:
        raise HTTPException(401, "账号已失效")


async def store_document(
    metadata: dict[str, Any],
    user: User,
    db: AsyncSession,
    recheck: Callable[[str], Awaitable[str]],
    *,
    fulltext: bool = False,
) -> dict:
    """Shared canonical, owner-checked upsert for both deep links and R6 intake."""
    canonical = metadata.get("id") if isinstance(metadata, dict) else None
    if not isinstance(canonical, str) or not 0 < len(canonical) <= 200:
        raise HTTPException(502, "PaperDaily 论文身份无效")
    existing = await db.scalar(
        select(Paper).where(
            Paper.user_id == user.id,
            Paper.source_provider == "paperdaily",
            Paper.source_id == canonical,
        )
    )
    if existing and existing.markdown_content:
        await recheck("read:paper")
        await live_owner(db, user)
        return {"paper_id": existing.id, "duplicate": True, "availability": "available"}
    if existing and existing.file_path:
        await recheck("read:paper")
        await live_owner(db, user)
        return {"paper_id": existing.id, "duplicate": True, "availability": "processing"}
    markdown, resource, unavailable = None, None, "metadata_only"
    if fulltext:
        try:
            resource_token = await recheck("read:resources")
            manifest = await pd.call(resource_token, "GET", pd.paper_path(canonical) + "/resources")
            if (
                manifest.get("manifest_version") != "read-resources-v1"
                or manifest.get("paper_id") != canonical
            ):
                raise HTTPException(502, "全文清单身份无效")
            candidates = [
                r
                for r in manifest.get("resources", [])
                if r.get("media_type", "").split(";")[0] == "text/markdown"
            ]
            if candidates:
                resource = candidates[0]
                raw = await pd.resource_bytes(resource_token, canonical, resource)
                try:
                    markdown = raw.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise HTTPException(502, "全文编码无效") from exc
                if not markdown.strip() or "\x00" in markdown:
                    raise HTTPException(502, "全文内容无效")
                unavailable = "available"
            else:
                unavailable = "no_transferable_markdown"
        except HTTPException as exc:
            if exc.status_code not in (403, 404, 503):
                raise
            unavailable = (
                "scope_required"
                if isinstance(exc.detail, dict)
                and exc.detail.get("code") == "paperdaily_scope_required"
                else "resource_unavailable"
            )
    # Imported resource identity is preserved verbatim; the reader blocks external images.
    await recheck("read:paper")
    await live_owner(db, user)
    pid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"rid:{user.id}:paperdaily:{canonical}"))
    from app.services.pdf_intake import metadata_fields

    fields = metadata_fields(metadata)
    from app.core.store import _split

    mapped_metadata = _split({k: v for k, v in fields.items() if v is not None})
    metadata_extra = mapped_metadata.pop("extra")
    mapped_metadata.pop("extra_large")
    values = dict(
        id=pid,
        user_id=user.id,
        filename=str(metadata.get("title") or canonical)[:500],
        title=str(metadata.get("title") or canonical)[:1000],
        abstract=metadata.get("abstract"),
        authors=fields.get("authors"),
        arxiv_id=fields.get("arxiv_id"),
        doi=metadata.get("doi"),
        source_provider="paperdaily",
        source_id=canonical,
        status="content_ready" if markdown else "metadata",
        markdown_content=markdown,
        extra={
            "paperdaily_resource": resource,
            "resource_availability": unavailable,
            "content_ready": bool(markdown),
            "external_full_text_url": fields.get("external_full_text_url"),
        },
    )
    values.update(mapped_metadata)
    values["extra"] = {**metadata_extra, **values["extra"]}
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    await db.execute(
        insert(Paper)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["user_id", "source_provider", "source_id"])
    )
    row = await db.scalar(
        select(Paper)
        .where(
            Paper.user_id == user.id,
            Paper.source_provider == "paperdaily",
            Paper.source_id == canonical,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if markdown and row.file_path:
        unavailable = "processing"
    elif markdown and row.markdown_content:
        unavailable = "available"
    elif markdown:
        # Upgrade metadata only; never replace any existing reading content or annotations.
        await db.execute(
            update(Paper)
            .where(Paper.id == row.id, Paper.markdown_content.is_(None), Paper.file_path.is_(None))
            .values(
                markdown_content=markdown,
                status="content_ready",
                extra={
                    **(row.extra or {}),
                    "paperdaily_resource": resource,
                    "resource_availability": "available",
                    "content_ready": True,
                },
            )
        )
    await db.commit()
    return {"paper_id": row.id, "duplicate": existing is not None, "availability": unavailable}
