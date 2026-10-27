"""Reading state survives reloads without crossing users or content revisions."""

from sqlalchemy import select

from app.core.store import store
from app.models.reading_workspace import ReadingRevision, ReadingWorkspace


def paper_for(user: dict, pid: str = "reading-paper") -> str:
    store.set(
        pid,
        {
            "id": pid,
            "filename": "paper.pdf",
            "user_id": user["id"],
            "status": "analyzing",
            "content_ready": True,
            "markdown_content": "# Methods\n\n重复句子。\n\n**重复句子。**",
        },
    )
    return pid


async def test_workspace_persists_and_rejects_stale_writer(client, users):
    alice = users["alice"]
    pid = paper_for(alice)
    url = f"/api/v1/papers/{pid}/reading-workspace"
    assert (await client.get(url, headers=alice["headers"])).json()["version"] == 0
    content = (await client.get(f"/api/v1/papers/{pid}/content", headers=alice["headers"])).json()
    revision = content["revisions"]["original"]["id"]
    body = {
        "version": 0,
        "focus": "识别假设是什么？",
        "next_action": "核对表 2",
        "checkpoint": {
            "revision_id": revision,
            "representation": "original",
            "scroll_ratio": 0.45,
        },
    }
    response = await client.put(url, json=body, headers=alice["headers"])
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json()["version"] == 1
    assert (await client.put(url, json=body, headers=alice["headers"])).status_code == 409
    saved = (await client.get(url, headers=alice["headers"])).json()
    assert saved["focus"] == body["focus"] and saved["checkpoint"]["scroll_ratio"] == 0.45
    assert (await client.get(url, headers=users["bob"]["headers"])).status_code == 403
    assert (await client.put(url, json={**body, "version": 1}, headers=alice["headers"])).json()[
        "version"
    ] == 2


async def test_revisions_are_immutable_and_anchor_cannot_cross_papers(client, users):
    alice = users["alice"]
    pid = paper_for(alice)
    url = f"/api/v1/papers/{pid}/content"
    first = (await client.get(url, headers=alice["headers"])).json()["revisions"]["original"]
    assert (await client.get(url, headers=alice["headers"])).json()["revisions"][
        "original"
    ] == first
    store.update(pid, {"markdown_content": "# New\n\n不同的正文。"})
    second = (await client.get(url, headers=alice["headers"])).json()["revisions"]["original"]
    assert first["id"] != second["id"]
    with store.engine.connect() as conn:
        old = conn.execute(
            select(ReadingRevision.markdown).where(ReadingRevision.id == first["id"])
        ).scalar_one()
    assert "重复句子" in old
    anchor = {
        "revision_id": first["id"],
        "representation": "original",
        "exact": "重复句子。",
        "start": 10,
        "end": 15,
    }
    body = {
        "selected_text": "重复句子。",
        "type": "note",
        "content": "需要核对假设",
        "anchor": anchor,
        "is_evidence": True,
        "research_question": "识别假设是什么？",
    }
    response = await client.post(
        f"/api/v1/papers/{pid}/annotations", json=body, headers=alice["headers"]
    )
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["anchor"] == {**anchor, "prefix": "", "suffix": ""}
    assert item["is_evidence"] and item["research_question"] == body["research_question"]
    assert (
        await client.put(
            f"/api/v1/annotations/{item['id']}",
            json={"is_evidence": False},
            headers=users["bob"]["headers"],
        )
    ).status_code == 403
    other = paper_for(alice, "other-paper")
    assert (
        await client.post(
            f"/api/v1/papers/{other}/annotations", json=body, headers=alice["headers"]
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/v1/papers/{pid}/annotations",
            json={**body, "selected_text": "wrong"},
            headers=alice["headers"],
        )
    ).status_code == 422


async def test_original_pdf_is_authenticated_and_ready_while_ai_runs(client, users, tmp_path):
    alice = users["alice"]
    pid = paper_for(alice)
    original = tmp_path / "source.pdf"
    original.write_bytes(b"%PDF-1.4\nsource")
    store.update(pid, {"file_path": str(original)})
    url = f"/api/v1/papers/{pid}/original"
    assert (await client.get(url)).status_code in (401, 403)
    assert (await client.get(url, headers=users["bob"]["headers"])).status_code == 403
    response = await client.get(url, headers=alice["headers"])
    assert response.status_code == 200 and response.content == original.read_bytes()
    assert response.headers["cache-control"] == "private, no-store"
    detail = (await client.get(f"/api/v1/papers/{pid}", headers=alice["headers"])).json()
    assert detail["content_ready"] and detail["has_original"] and detail["status"] == "analyzing"
    listing = (await client.get("/api/v1/library/", headers=alice["headers"])).json()
    assert listing["items"][0]["content_ready"]


async def test_invalid_checkpoint_does_not_write(client, users):
    pid = paper_for(users["alice"])
    body = {"version": 0, "checkpoint": {"revision_id": "0" * 64, "scroll_ratio": 0.2}}
    assert (
        await client.put(
            f"/api/v1/papers/{pid}/reading-workspace", json=body, headers=users["alice"]["headers"]
        )
    ).status_code == 422
    with store.engine.connect() as conn:
        assert conn.execute(select(ReadingWorkspace)).first() is None


async def test_deleting_paper_clears_snapshots_and_workspace(client, users):
    alice = users["alice"]
    pid = paper_for(alice)
    await client.get(f"/api/v1/papers/{pid}/content", headers=alice["headers"])
    await client.put(
        f"/api/v1/papers/{pid}/reading-workspace",
        json={"version": 0, "focus": "test"},
        headers=alice["headers"],
    )
    store.delete(pid)
    with store.engine.connect() as conn:
        assert (
            conn.execute(select(ReadingRevision).where(ReadingRevision.paper_id == pid)).first()
            is None
        )
        assert (
            conn.execute(select(ReadingWorkspace).where(ReadingWorkspace.paper_id == pid)).first()
            is None
        )
