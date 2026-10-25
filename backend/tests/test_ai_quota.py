"""触发 LLM 的路由按调用者扣 AI 配额；配额用完返回 403 quota_exceeded，且不调用模型。"""

from sqlalchemy import select

from app.core.database import async_session_maker
from app.core.store import store
from app.models.user import User


async def set_ai_used(user_id, n):
    async with async_session_maker() as db:
        u = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
        u.daily_ai_used = n
        from datetime import datetime, timezone
        u.last_daily_reset = datetime.now(timezone.utc)
        await db.commit()


async def ai_used(user_id):
    async with async_session_maker() as db:
        return (await db.execute(select(User).where(User.id == user_id))).scalar_one().daily_ai_used


async def test_smart_analyze_charges_caller_and_blocks_when_exhausted(client, users, monkeypatch):
    calls = []

    async def fake_smart(**kw):
        calls.append(kw)
        return {"success": True, "result": "ok"}

    monkeypatch.setattr("app.api.v1.workbench.smart_analyze", fake_smart)
    alice = users["alice"]
    pid = "p-ai"
    store._data[pid] = {"id": pid, "filename": "x", "status": "completed", "user_id": alice["id"], "markdown_content": "x"}
    body = {"text": "t", "paper_id": pid, "paper_title": "T", "action_type": "chat"}

    r = await client.post("/api/v1/workbench/analyze/smart", json=body, headers=alice["headers"])
    assert r.status_code == 200 and len(calls) == 1
    assert await ai_used(alice["id"]) == 1

    await set_ai_used(alice["id"], 10_000)
    r = await client.post("/api/v1/workbench/analyze/smart", json=body, headers=alice["headers"])
    assert r.status_code == 403 and r.json()["detail"]["error"] == "quota_exceeded"
    assert len(calls) == 1


async def test_cannot_run_ai_on_someone_elses_paper(client, users, monkeypatch):
    async def fake_smart(**kw):
        raise AssertionError("must not be called")

    monkeypatch.setattr("app.api.v1.workbench.smart_analyze", fake_smart)
    pid = "p-other"
    store._data[pid] = {"id": pid, "filename": "x", "status": "completed", "user_id": users["alice"]["id"]}
    body = {"text": "t", "paper_id": pid, "paper_title": "T", "action_type": "chat"}
    r = await client.post("/api/v1/workbench/analyze/smart", json=body, headers=users["bob"]["headers"])
    assert r.status_code == 403
    assert await ai_used(users["bob"]["id"]) == 0
