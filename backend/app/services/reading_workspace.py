"""Snapshot identity uses unsigned source bytes, never expiring image URLs."""

import hashlib
from typing import Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.store import store
from app.models.reading_workspace import ReadingRevision


def ensure_revision(paper: dict, representation: str) -> Optional[dict[str, str]]:
    key = "markdown_content" if representation == "original" else "translated_content"
    markdown = paper.get(key) or ""
    if not markdown.strip():
        return None
    digest = hashlib.sha256(markdown.encode()).hexdigest()
    revision_id = hashlib.sha256(f"{paper['id']}:{representation}:{digest}".encode()).hexdigest()
    table = ReadingRevision.__table__
    with store.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
        insert = sqlite_insert if conn.dialect.name == "sqlite" else pg_insert
        conn.execute(
            insert(table)
            .values(
                id=revision_id,
                paper_id=paper["id"],
                user_id=paper.get("user_id"),
                representation=representation,
                content_hash=digest,
                markdown=markdown,
            )
            .on_conflict_do_nothing(index_elements=["id"])
        )
    return {"id": revision_id, "content_hash": digest, "representation": representation}
