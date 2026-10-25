import os
import subprocess
import sys
import textwrap
import uuid
from datetime import datetime, timedelta, timezone

from app.core.data_import import recover_stuck
from app.core.store import store


def new_paper(user_id, **fields):
    pid = str(uuid.uuid4())
    store.set(pid, {"id": pid, "filename": "a.pdf", "status": "completed", "user_id": user_id, **fields})
    return pid


async def test_roundtrip_keeps_shape(users):
    uid = users["alice"]["id"]
    pid = new_paper(
        uid,
        title="T",
        markdown_content="# body",
        tags=["a", "b"],
        summary="long summary",
        embedding=[0.1, 0.2],
        translation_status="completed",
        tags_confirmed=True,
        created_at="2025-12-15 11:36:36.339515",
    )
    p = store.get(pid)
    assert p["title"] == "T" and p["markdown_content"] == "# body"
    assert p["tags"] == ["a", "b"] and p["tags_confirmed"] is True
    assert p["summary"] == "long summary" and p["embedding"] == [0.1, 0.2]
    assert p["translation_status"] == "completed"
    assert p["created_at"] == datetime(2025, 12, 15, 11, 36, 36, 339515, tzinfo=timezone.utc)


async def test_list_is_light(users):
    uid = users["alice"]["id"]
    new_paper(uid, markdown_content="x" * 1000, embedding=[1.0] * 10, category="c", tags=["t"])
    [p] = store.get_by_user(uid)
    assert "markdown_content" not in p and "embedding" not in p
    assert p["category"] == "c" and p["tags"] == ["t"]


async def test_update_merges_and_does_not_clobber(users):
    pid = new_paper(users["alice"]["id"], category="old", translation_progress=0)
    stale = store.get(pid)  # 长任务开始时拿到的快照
    store.update(pid, {"category": "new"})  # 期间别人改了分类
    store.update(pid, {"translation_progress": 50})  # 长任务只提交自己的字段
    p = store.get(pid)
    assert p["category"] == "new" and p["translation_progress"] == 50
    assert stale["category"] == "old"
    assert store.update("missing", {"a": 1}) is False


async def test_long_strings_truncated_to_column(users):
    pid = new_paper(users["alice"]["id"], title="x" * 5000)
    assert len(store.get(pid)["title"]) == 1000


async def test_concurrent_processes_do_not_lose_updates(users):
    pid = new_paper(users["alice"]["id"])
    script = textwrap.dedent(
        f"""
        import os, sys
        sys.path.insert(0, {os.getcwd()!r} if False else {str(__import__('pathlib').Path(__file__).resolve().parent.parent)!r})
        from app.core.store import store
        field = sys.argv[1]
        for i in range(30):
            store.update({pid!r}, {{field: i}})
        """
    )
    env = dict(os.environ)
    procs = [subprocess.Popen([sys.executable, "-c", script, f], env=env) for f in ("field_a", "field_b")]
    assert [p.wait(timeout=120) for p in procs] == [0, 0]
    p = store.get(pid)
    assert p["field_a"] == 29 and p["field_b"] == 29


async def test_recover_stuck(users):
    uid = users["alice"]["id"]
    with_content = new_paper(uid, status="analyzing", markdown_content="# x")
    without = new_paper(uid, status="parsing")
    translating = new_paper(uid, status="completed", translation_status="translating")
    fresh = new_paper(uid, status="parsing")
    later = datetime.now(timezone.utc) + timedelta(hours=2)
    # 只有超过时限的才处理：先用「现在」跑一次，什么都不该变
    assert recover_stuck(now=datetime.now(timezone.utc)) == {"completed": 0, "failed": 0, "translation_failed": 0}
    result = recover_stuck(now=later)
    assert result == {"completed": 1, "failed": 2, "translation_failed": 1}
    assert store.get(with_content)["status"] == "completed"
    assert store.get(without)["status"] == "failed" and "重启" in store.get(without)["error_message"]
    assert store.get(translating)["translation_status"] == "failed"
    assert store.get(fresh)["status"] == "failed"
