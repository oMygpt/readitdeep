"""Research bridge isolation, integrity and publication retry regressions."""

import copy
import hashlib
import uuid

import httpx
import pytest
from fastapi import HTTPException

from app.core.store import store
from app.services.paperdaily import client as pd_client
from app.services.paperdaily import research_client as pd


@pytest.fixture
def bridge(monkeypatch):
    calls = []

    async def delegation(request, user, required):
        return "delegate"

    async def call(token, method, path, **kwargs):
        calls.append((method, path, copy.deepcopy(kwargs)))
        if path.endswith("/resolve"):
            return {"id": "EX1", "title": "A research paper", "abstract": "Abstract"}
        if path.endswith("/resources"):
            return {"manifest_version": "read-resources-v1", "paper_id": "EX1", "resources": []}
        if "/questions/" in path:
            return {
                "id": int(path.rsplit("/", 1)[1]),
                "question": "When does the result hold?",
                "status": "open",
                "updated_at": "2026-10-27",
            }
        return {"id": "rs-1"}

    monkeypatch.setattr(pd, "delegation", delegation)
    monkeypatch.setattr(pd, "call", call)
    return calls


async def evidence(client, user, pid, source_id="EX1"):
    store.set(
        pid,
        {
            "id": pid,
            "user_id": user["id"],
            "filename": "fixture.pdf",
            "title": pid,
            "status": "completed",
            "markdown_content": "Evidence text.",
            "source_provider": "paperdaily" if source_id else None,
            "source_id": source_id,
        },
    )
    r = await client.post(
        f"/api/v1/papers/{pid}/annotations",
        headers=user["headers"],
        json={"selected_text": "Evidence text.", "content": "My own note", "is_evidence": True},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def comparison(client, user, ids, **kwargs):
    cid = str(uuid.uuid4())
    body = {
        "title": "Research comparison",
        "items": [
            {"annotation_id": aid, "relationship": "boundary", "judgement": "Different samples"}
            for aid in ids
        ],
        "notes": "Needs replication",
        **kwargs,
    }
    r = await client.put(f"/api/v1/research/comparisons/{cid}", headers=user["headers"], json=body)
    assert r.status_code == 200, r.text
    return cid, r.json()


async def test_import_upgrade_never_replaces_existing_content(client, users, bridge, monkeypatch):
    h = users["alice"]["headers"]
    r = await client.post("/api/v1/research/import", headers=h, json={"paper_id": "10.1/example"})
    assert r.status_code == 200, r.text
    assert r.json()["availability"] == "no_transferable_markdown"
    pid = r.json()["paper_id"]
    original = pd.call

    async def resources(*args, **kwargs):
        if args[2].endswith("/resources"):
            return {
                "manifest_version": "read-resources-v1",
                "paper_id": "EX1",
                "resources": [{"media_type": "text/markdown"}],
            }
        return await original(*args, **kwargs)

    async def resource_bytes(*args):
        return b"# Full text\n\nVerified bytes"

    monkeypatch.setattr(pd, "call", resources)
    monkeypatch.setattr(pd, "resource_bytes", resource_bytes)
    upgraded = await client.post("/api/v1/research/import", headers=h, json={"paper_id": "EX1"})
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["paper_id"] == pid and upgraded.json()["duplicate"]
    assert store.get(pid)["markdown_content"].startswith("# Full text")
    assert (await client.get(f"/api/v1/papers/{pid}", headers=h)).json()[
        "source_provider"
    ] == "paperdaily"
    library = (await client.get("/api/v1/library/", headers=h)).json()
    assert library["items"][0]["content_ready"]
    store.update(pid, {"markdown_content": "Keep my existing revision"})
    await client.post("/api/v1/research/import", headers=h, json={"paper_id": "EX1"})
    assert store.get(pid)["markdown_content"] == "Keep my existing revision"
    other = await client.post(
        "/api/v1/research/import", headers=users["bob"]["headers"], json={"paper_id": "EX1"}
    )
    assert other.json()["paper_id"] != pid


async def test_import_integrity_failure_is_not_success(client, users, bridge, monkeypatch):
    original = pd.call

    async def call(*args, **kwargs):
        if args[2].endswith("/resources"):
            return {
                "manifest_version": "read-resources-v1",
                "paper_id": "EX1",
                "resources": [{"media_type": "text/markdown"}],
            }
        return await original(*args, **kwargs)

    async def broken(*args):
        raise HTTPException(502, "hash mismatch")

    monkeypatch.setattr(pd, "call", call)
    monkeypatch.setattr(pd, "resource_bytes", broken)
    r = await client.post(
        "/api/v1/research/import", headers=users["alice"]["headers"], json={"paper_id": "EX1"}
    )
    assert r.status_code == 502 and store.get_by_user(users["alice"]["id"]) == []


async def test_resource_ranges_and_redirect_rejection(monkeypatch):
    raw = ("中文 evidence" * 100000).encode()
    digest = hashlib.sha256(raw).hexdigest()
    manifest = {
        "resource_id": "rr_" + "a" * 32,
        "byte_length": len(raw),
        "content_sha256": digest,
        "paper_id": "EX1",
        "transfer_policy": "first_party_read",
        "policy_version": "v1",
        "license": "cc-by",
    }
    seen = []

    def handler(request):
        assert request.headers["Authorization"] == "Bearer delegate"
        seen.append(request)
        a, b = map(int, request.headers["range"].removeprefix("bytes=").split("-"))
        return httpx.Response(
            206,
            content=raw[a : b + 1],
            headers={"Content-Range": f"bytes {a}-{b}/{len(raw)}", "X-Content-SHA256": digest},
        )

    monkeypatch.setattr(
        pd_client, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    assert await pd.resource_bytes("delegate", "EX1", manifest) == raw and len(seen) > 1
    with pytest.raises(HTTPException):
        await pd.resource_bytes("delegate", "EX2", manifest)
    monkeypatch.setattr(
        pd_client,
        "http_client",
        lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(302, headers={"Location": "https://evil.test"})
            )
        ),
    )
    with pytest.raises(HTTPException) as err:
        await pd.resource_bytes("delegate", "EX1", manifest)
    assert err.value.status_code == 502


async def test_question_snapshot_separate_from_focus(client, users, bridge, monkeypatch):
    alice = users["alice"]
    await evidence(client, alice, "p")
    url = "/api/v1/papers/p/reading-workspace"
    response = await client.put(
        url, headers=alice["headers"], json={"version": 0, "question_id": 7, "focus": "Local focus"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["question"]["id"] == 7 and response.json()["focus"] == "Local focus"

    async def denied(*args, **kwargs):
        raise HTTPException(404, "question not found")

    monkeypatch.setattr(pd, "call", denied)
    assert (
        await client.put(
            url, headers=alice["headers"], json={"version": 1, "question_id": 8, "focus": "changed"}
        )
    ).status_code == 404
    assert (await client.get(url, headers=alice["headers"])).json()["focus"] == "Local focus"


async def test_comparison_owner_cas_and_removed_evidence(client, users, bridge):
    alice, bob = users["alice"], users["bob"]
    aid = await evidence(client, alice, "a")
    bid = await evidence(client, bob, "b")
    cid, _ = await comparison(client, alice, [aid])
    assert (await client.get("/api/v1/research/evidence", headers=bob["headers"])).json()["items"][
        0
    ]["id"] == bid
    url = f"/api/v1/research/comparisons/{cid}"
    assert (
        await client.put(url, headers=bob["headers"], json={"version": 1, "title": "bad"})
    ).status_code == 404
    assert (
        await client.put(url, headers=alice["headers"], json={"version": 0, "title": "stale"})
    ).status_code == 409
    await client.delete(f"/api/v1/annotations/{aid}", headers=alice["headers"])
    assert (await client.post(url + "/preview", headers=alice["headers"])).status_code == 422
    assert (await client.post(url + "/preview", headers=bob["headers"])).status_code == 404


async def test_preview_frozen_unknown_retry_and_revision(client, users, bridge, monkeypatch):
    alice = users["alice"]
    h = alice["headers"]
    a = await evidence(client, alice, "a", "EX1")
    b = await evidence(client, alice, "b", "EX2")
    cid, _ = await comparison(client, alice, [a, b], question_id=7)
    url = f"/api/v1/research/comparisons/{cid}/preview"
    preview = (await client.post(url, headers=h)).json()
    assert len(preview["payload"]["papers"]) == 2
    assert all(p["depth"] == "selected-passages" for p in preview["payload"]["papers"])
    assert (
        preview["payload"]["claims"] == [] and preview["payload"]["provenance"]["question_id"] == 7
    )
    await client.put(
        f"/api/v1/annotations/{a}", headers=h, json={"content": "Changed AFTER preview"}
    )
    sent = []

    async def unknown_then_success(token, method, path, **kwargs):
        sent.append((path, copy.deepcopy(kwargs["body"])))
        if len(sent) == 1:
            raise HTTPException(503, "timeout")
        return {"id": "rs-1"}

    monkeypatch.setattr(pd, "call", unknown_then_success)
    publish = f"/api/v1/research/publications/{preview['id']}/publish"
    assert (await client.post(publish, headers=h)).status_code == 503
    result = await client.post(publish, headers=h)
    assert result.status_code == 200, result.text
    assert sent[0] == sent[1] and "Changed AFTER" not in str(sent)
    assert (await client.post(publish, headers=h)).json()["status"] == "succeeded" and len(
        sent
    ) == 2
    again = (await client.post(url, headers=h)).json()
    assert again["parent_id"] == "rs-1"

    async def missing(token, method, path, **kwargs):
        assert path.endswith("/rs-1/revisions")
        raise HTTPException(404, "gone")

    monkeypatch.setattr(pd, "call", missing)
    assert (
        await client.post(f"/api/v1/research/publications/{again['id']}/publish", headers=h)
    ).status_code == 404


async def test_discard_before_send(client, users, bridge):
    alice = users["alice"]
    aid = await evidence(client, alice, "a")
    cid, _ = await comparison(client, alice, [aid])
    preview = (
        await client.post(f"/api/v1/research/comparisons/{cid}/preview", headers=alice["headers"])
    ).json()
    url = f"/api/v1/research/publications/{preview['id']}"
    assert (await client.delete(url, headers=alice["headers"])).status_code == 200
    assert (await client.post(url + "/publish", headers=alice["headers"])).status_code == 409


async def test_late_import_does_not_recreate_deleted_owner(client, users, bridge, monkeypatch):
    from sqlalchemy import delete

    from app.core.database import async_session_maker
    from app.models.user import User

    original = pd.call

    async def deleted(*args, **kwargs):
        result = await original(*args, **kwargs)
        if args[2].endswith("/resolve"):
            async with async_session_maker() as db:
                await db.execute(delete(User).where(User.id == users["alice"]["id"]))
                await db.commit()
        return result

    monkeypatch.setattr(pd, "call", deleted)
    response = await client.post(
        "/api/v1/research/import",
        headers=users["alice"]["headers"],
        json={"paper_id": "EX1", "fulltext": False},
    )
    assert response.status_code == 401 and store.get_by_user(users["alice"]["id"]) == []


async def test_rejected_question_can_be_revised_without_new_create_fallback(
    client, users, bridge, monkeypatch
):
    alice = users["alice"]
    aid = await evidence(client, alice, "a")
    cid, _ = await comparison(client, alice, [aid], question_id=7)
    url = f"/api/v1/research/comparisons/{cid}/preview"
    preview = (await client.post(url, headers=alice["headers"])).json()

    async def rejected(*args, **kwargs):
        raise HTTPException(404, {"upstream_status": 404, "code": "paperdaily_request_denied"})

    monkeypatch.setattr(pd, "call", rejected)
    pub_url = f"/api/v1/research/publications/{preview['id']}"
    assert (await client.post(pub_url + "/publish", headers=alice["headers"])).status_code == 404
    assert (await client.post(url, headers=alice["headers"])).json()["status"] == "rejected"
    assert (await client.delete(pub_url, headers=alice["headers"])).status_code == 200
    updated = await client.put(
        f"/api/v1/research/comparisons/{cid}",
        headers=alice["headers"],
        json={
            "title": "Updated",
            "version": 1,
            "items": [{"annotation_id": aid}],
            "question_id": None,
        },
    )
    assert updated.status_code == 200, updated.text
    new = (await client.post(url, headers=alice["headers"])).json()
    assert new["id"] != preview["id"] and "question_id" not in new["payload"]["provenance"]


async def test_question_revoked_during_read_does_not_save(client, users, bridge, monkeypatch):
    alice = users["alice"]
    await evidence(client, alice, "a")
    count = 0

    async def revoked(request, user, required):
        nonlocal count
        count += 1
        if count == 2:
            raise HTTPException(401, "revoked")
        return "delegate"

    monkeypatch.setattr(pd, "delegation", revoked)
    cid = str(uuid.uuid4())
    result = await client.put(
        f"/api/v1/research/comparisons/{cid}",
        headers=alice["headers"],
        json={"title": "Do not save", "question_id": 7},
    )
    assert result.status_code == 401
    assert (await client.get("/api/v1/research/comparisons", headers=alice["headers"])).json()[
        "items"
    ] == []
    count = 0
    result = await client.put(
        "/api/v1/papers/a/reading-workspace",
        headers=alice["headers"],
        json={"version": 0, "question_id": 7},
    )
    assert result.status_code == 401
    assert (
        await client.get("/api/v1/papers/a/reading-workspace", headers=alice["headers"])
    ).json()["version"] == 0


async def test_late_publish_attempt_cannot_overwrite_new_success(
    client, users, bridge, monkeypatch
):
    import asyncio
    from datetime import timedelta

    from sqlalchemy import update

    from app.core.database import async_session_maker
    from app.core.timeutil import utcnow
    from app.models.research import ResearchPublication

    alice = users["alice"]
    aid = await evidence(client, alice, "a")
    cid, _ = await comparison(client, alice, [aid])
    preview = (
        await client.post(f"/api/v1/research/comparisons/{cid}/preview", headers=alice["headers"])
    ).json()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def remote(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await release.wait()
            raise HTTPException(503, "late timeout")
        return {"id": "new-success"}

    monkeypatch.setattr(pd, "call", remote)
    url = f"/api/v1/research/publications/{preview['id']}/publish"
    first = asyncio.create_task(client.post(url, headers=alice["headers"]))
    await entered.wait()
    async with async_session_maker() as db:
        await db.execute(
            update(ResearchPublication)
            .where(ResearchPublication.id == preview["id"])
            .values(updated_at=utcnow() - timedelta(minutes=3))
        )
        await db.commit()
    second = await client.post(url, headers=alice["headers"])
    assert second.status_code == 200, second.text
    release.set()
    await first
    async with async_session_maker() as db:
        receipt = await db.get(ResearchPublication, preview["id"])
        assert receipt.status == "succeeded" and receipt.remote_id == "new-success"
    assert (await client.post(url, headers=alice["headers"])).json()["status"] == "succeeded"


async def test_uploaded_source_binding_requires_confirmation_and_preserves_content(
    client, users, bridge
):
    alice = users["alice"]
    await evidence(client, alice, "local", None)
    result = await client.post(
        "/api/v1/research/papers/local/source", headers=alice["headers"], json={"source_id": "EX1"}
    )
    assert result.status_code == 200, result.text
    assert store.get("local")["markdown_content"] == "Evidence text."
    assert store.get("local")["source_id"] == "EX1"
    assert not (await client.get("/api/v1/papers/local", headers=alice["headers"])).json()[
        "resource_imported"
    ]
    assert (
        await client.post(
            "/api/v1/research/papers/local/source",
            headers=users["bob"]["headers"],
            json={"source_id": "EX1"},
        )
    ).status_code == 404


async def test_unknown_then_denied_stays_unknown(client, users, bridge, monkeypatch):
    alice = users["alice"]
    aid = await evidence(client, alice, "a")
    cid, _ = await comparison(client, alice, [aid])
    preview = (
        await client.post(f"/api/v1/research/comparisons/{cid}/preview", headers=alice["headers"])
    ).json()
    calls = 0

    async def remote(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPException(503, "response lost")
        raise HTTPException(403, {"upstream_status": 403})

    monkeypatch.setattr(pd, "call", remote)
    url = f"/api/v1/research/publications/{preview['id']}"
    assert (await client.post(url + "/publish", headers=alice["headers"])).status_code == 503
    assert (await client.post(url + "/publish", headers=alice["headers"])).status_code == 403
    status = await client.get(url, headers=alice["headers"])
    assert status.json()["status"] == "unknown" and status.json()["id"] == preview["id"]
    assert status.headers["cache-control"] == "private, no-store"
    assert (await client.delete(url, headers=alice["headers"])).status_code == 409


async def test_resource_wait_preserves_new_pdf_and_metadata_extra(
    client, users, bridge, monkeypatch
):
    import asyncio
    from types import SimpleNamespace

    from app.services import billing
    from tests.test_series_billing import make_pdf

    alice = users["alice"]
    h = alice["headers"]
    pid = (
        await client.post(
            "/api/v1/research/import", headers=h, json={"paper_id": "EX1", "fulltext": False}
        )
    ).json()["paper_id"]
    store.update(
        pid,
        {
            "oa_pdf_url": "https://arxiv.org/pdf/1",
            "venue_name": "Fixture venue",
            "publication_date": "2025-01-01",
            "custom": "keep",
        },
    )
    started, release = asyncio.Event(), asyncio.Event()
    original = pd.call

    async def resources(*args, **kwargs):
        if args[2].endswith("/resources"):
            return {
                "manifest_version": "read-resources-v1",
                "paper_id": "EX1",
                "resources": [{"media_type": "text/markdown"}],
            }
        return await original(*args, **kwargs)

    async def content(*args):
        started.set()
        await release.wait()
        return b"Late Markdown must not replace PDF"

    async def admit(*args):
        return SimpleNamespace(price=0, funding="standalone"), True

    monkeypatch.setattr(pd, "call", resources)
    monkeypatch.setattr(pd, "resource_bytes", content)
    monkeypatch.setattr(billing, "admit", admit)
    importing = asyncio.create_task(
        client.post("/api/v1/research/import", headers=h, json={"paper_id": "EX1"})
    )
    await started.wait()
    attached = await client.post(
        f"/api/v1/papers/{pid}/pdf",
        headers=h,
        files={"file": ("first.pdf", make_pdf(), "application/pdf")},
    )
    assert attached.status_code == 200, attached.text
    release.set()
    result = await importing
    assert result.json()["availability"] == "processing"
    paper = store.get(pid)
    assert not paper.get("markdown_content") and paper["file_path"]
    assert paper["custom"] == "keep" and paper["venue_name"] == "Fixture venue"


async def test_late_pdf_read_cannot_replace_registered_markdown(client, users, bridge, monkeypatch):
    import asyncio

    from starlette.datastructures import UploadFile

    from app.services import billing
    from tests.test_series_billing import make_pdf

    alice = users["alice"]
    h = alice["headers"]
    pid = (
        await client.post(
            "/api/v1/research/import", headers=h, json={"paper_id": "EX1", "fulltext": False}
        )
    ).json()["paper_id"]
    store.update(
        pid,
        {
            "oa_pdf_url": "https://arxiv.org/pdf/1",
            "venue_name": "Fixture venue",
            "publication_date": "2025-01-01",
            "custom": "keep",
        },
    )
    entered, release = asyncio.Event(), asyncio.Event()
    original_read = UploadFile.read
    original_call = pd.call

    async def delayed_read(self, *args, **kwargs):
        if self.filename == "late.pdf":
            entered.set()
            await release.wait()
        return await original_read(self, *args, **kwargs)

    async def resources(*args, **kwargs):
        if args[2].endswith("/resources"):
            return {
                "manifest_version": "read-resources-v1",
                "paper_id": "EX1",
                "resources": [{"media_type": "text/markdown"}],
            }
        return await original_call(*args, **kwargs)

    async def content(*args):
        return b"First registered Markdown"

    from unittest.mock import AsyncMock

    admit = AsyncMock()
    monkeypatch.setattr(UploadFile, "read", delayed_read)
    monkeypatch.setattr(pd, "call", resources)
    monkeypatch.setattr(pd, "resource_bytes", content)
    monkeypatch.setattr(billing, "admit", admit)
    uploading = asyncio.create_task(
        client.post(
            f"/api/v1/papers/{pid}/pdf",
            headers=h,
            files={"file": ("late.pdf", make_pdf(), "application/pdf")},
        )
    )
    await entered.wait()
    imported = await client.post("/api/v1/research/import", headers=h, json={"paper_id": "EX1"})
    assert imported.json()["availability"] == "available"
    release.set()
    rejected = await uploading
    assert rejected.status_code == 409
    admit.assert_not_called()
    paper = store.get(pid)
    assert paper["markdown_content"] == "First registered Markdown" and not paper.get("file_path")
    assert (
        paper["custom"] == "keep"
        and paper["oa_pdf_url"] == "https://arxiv.org/pdf/1"
        and paper["publication_date"] == "2025-01-01"
    )
