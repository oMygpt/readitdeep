"""Authenticated, private reading state with optimistic concurrency control."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_paper_access
from app.api.v1.annotations import TextAnchor
from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.timeutil import utcnow
from app.models.reading_workspace import ReadingWorkspace
from app.models.user import User

router = APIRouter()


class Checkpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision_id: str = Field(max_length=64)
    representation: Literal["original", "translation"] = "original"
    scroll_ratio: float = Field(default=0, ge=0, le=1)
    font_size: float = Field(default=1.1, ge=0.8, le=2)
    anchor: Optional[TextAnchor] = None
    block_offset: float = Field(default=0, ge=-100000, le=100000)


class WorkspaceWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0)
    focus: str = Field(default="", max_length=2000)
    next_action: str = Field(default="", max_length=4000)
    checkpoint: Optional[Checkpoint] = None


def serialize(row: Optional[ReadingWorkspace]) -> dict:
    return {
        "version": row.version if row else 0,
        "focus": row.focus if row else "",
        "next_action": row.next_action if row else "",
        "checkpoint": row.checkpoint if row else None,
        "updated_at": row.updated_at.isoformat() if row else None,
    }


@router.get("/papers/{paper_id}/reading-workspace")
async def get_workspace(
    paper_id: str,
    response: Response,
    paper: dict = Depends(require_paper_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return serialize(await db.get(ReadingWorkspace, (user.id, paper_id)))


@router.put("/papers/{paper_id}/reading-workspace")
async def put_workspace(
    paper_id: str,
    body: WorkspaceWrite,
    response: Response,
    paper: dict = Depends(require_paper_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.models.reading_workspace import ReadingRevision

    response.headers["Cache-Control"] = "private, no-store"
    if body.checkpoint:
        revision = await db.get(ReadingRevision, body.checkpoint.revision_id)
        if (
            not revision
            or revision.paper_id != paper_id
            or revision.representation != body.checkpoint.representation
        ):
            raise HTTPException(422, "阅读位置对应的内容版本无效")
        if body.checkpoint.anchor and (
            body.checkpoint.anchor.revision_id != revision.id
            or body.checkpoint.anchor.representation != revision.representation
        ):
            raise HTTPException(422, "阅读锚点与内容版本不一致")
    values = body.model_dump(exclude={"version"})
    values.update(version=body.version + 1, updated_at=utcnow())
    if body.version == 0:
        db.add(ReadingWorkspace(user_id=user.id, paper_id=paper_id, **values))
        try:
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(409, "阅读现场已在其他窗口更新，请先重新载入") from exc
    else:
        result = await db.execute(
            update(ReadingWorkspace)
            .where(
                ReadingWorkspace.user_id == user.id,
                ReadingWorkspace.paper_id == paper_id,
                ReadingWorkspace.version == body.version,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await db.rollback()
            raise HTTPException(409, "阅读现场已在其他窗口更新，请先重新载入")
        await db.commit()
    return serialize(await db.get(ReadingWorkspace, (user.id, paper_id)))
