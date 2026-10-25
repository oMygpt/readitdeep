import json

from app.core.data_import import import_json, import_json_if_needed
from app.core.store import store
from app.core.workbench_store import workbench_store


def write_fixture(tmp_path, alice_id):
    papers = {
        "p1": {
            "id": "p1", "filename": "a.pdf", "status": "completed", "user_id": alice_id,
            "created_at": "2025-12-15 11:36:36.339515", "updated_at": "2025-12-15 11:36:53.450787",
            "title": "A", "markdown_content": "# A\n\n正文", "translated_content": "译文",
            "tags": ["t1"], "tags_confirmed": True, "summary": "s", "embedding": [0.5, 0.25],
            "s2_graph": {"citations": [], "references": [{"title": "r"}]},
        },
        "p2": {"id": "p2", "filename": "b.pdf", "status": "failed", "user_id": "ghost-user", "error_message": "x"},
        "p3": {"id": "p3", "filename": "c.pdf", "status": "completed"},
    }
    items = {
        "wb-1": {"id": "wb-1", "type": "method", "title": "M", "description": "d", "source_paper_id": "p1",
                 "zone": "methods", "created_at": "2025-12-15T11:40:00", "data": {"k": 1}},
        "wb-2": {"id": "wb-2", "type": "code", "title": "C", "description": "d", "source_paper_id": "p2",
                 "zone": "datasets", "created_at": "2025-12-15T11:41:00", "data": {}},
        "wb-3": {"id": "wb-3", "type": "note", "title": "N", "description": "d", "source_paper_id": None,
                 "zone": "notes", "created_at": "2025-12-15T11:42:00", "data": {}},
    }
    (tmp_path / "papers.json").write_text(json.dumps(papers, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "workbench.json").write_text(
        json.dumps({"items": items, "global_workbench": {}, "paper_workbenches": {}}), encoding="utf-8"
    )
    return papers, items


async def test_import_is_complete_and_idempotent(tmp_path, users):
    alice = users["alice"]["id"]
    papers, items = write_fixture(tmp_path, alice)
    r1 = import_json(tmp_path / "papers.json", tmp_path / "workbench.json")
    assert r1["papers"] == {"total": 3, "inserted": 3, "updated": 0, "orphan_user": 1, "content_mismatch": []}
    assert r1["workbench"] == {"total": 3, "inserted": 3, "updated": 0, "unowned": 2}

    p1 = store.get("p1")
    for key in ("title", "markdown_content", "translated_content", "tags", "summary", "embedding", "s2_graph", "tags_confirmed"):
        assert p1[key] == papers["p1"][key], key
    assert store.get("p2")["user_id"] is None  # 用户不存在 → 仅管理员可见
    assert workbench_store.get_item("wb-1")["user_id"] == alice
    assert workbench_store.get_item("wb-1")["created_at"] == "2025-12-15T11:40:00"
    assert workbench_store.get_item("wb-2")["user_id"] is None
    assert [i["id"] for i in workbench_store.get_items_for_user(alice)] == ["wb-1"]

    before = (store.get("p1"), [workbench_store.get_item(i) for i in items])
    r2 = import_json(tmp_path / "papers.json", tmp_path / "workbench.json")
    assert r2["papers"]["inserted"] == 0 and r2["papers"]["updated"] == 3
    assert r2["workbench"]["inserted"] == 0 and r2["workbench"]["updated"] == 3
    after = (store.get("p1"), [workbench_store.get_item(i) for i in items])
    before[0].pop("updated_at"), after[0].pop("updated_at")
    assert before == after


async def test_import_if_needed_runs_once(tmp_path, users):
    write_fixture(tmp_path, users["alice"]["id"])
    assert import_json_if_needed(tmp_path)["papers"]["total"] == 3
    assert import_json_if_needed(tmp_path) is None
    assert (tmp_path / "papers.json").exists()  # 原文件保留


async def test_import_if_needed_without_files(tmp_path):
    assert import_json_if_needed(tmp_path) is None
