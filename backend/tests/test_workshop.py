from types import SimpleNamespace

import pytest

from app.services.analysis_material import analysis_input, digest, material_scope, material_status
from app.services.parsing.vlm import _transcribe
from app.core.store import store


def test_partial_input_discloses_actual_source_and_cache_version():
    source = "# Intro\n" + "a" * 9000 + "\n## Methods\nIV DESIGN"
    scope = material_scope(source, 8000)
    assert scope["truncated"] and scope["end"] == 8000
    assert scope["source_sha256"] == digest(source)
    assert scope["input_sha256"] == digest(source[:8000])
    prompt = analysis_input(source, 8000)
    assert "IV DESIGN" not in prompt and "不得猜测" in prompt
    assert material_status({})["state"] == "unknown"
    paper = {"markdown_content": source, "analysis_material": {"summary": scope}}
    assert material_status(paper)["state"] == "current"
    assert material_status({**paper, "markdown_content": source + "x"})["state"] == "stale"
    assert not material_scope("short", 8000)["truncated"]


async def test_vlm_token_limit_is_not_a_successful_page():
    class Model:
        async def ainvoke(self, *args, **kwargs):
            return SimpleNamespace(content="sentence cut", response_metadata={"finish_reason": "length"})
    with pytest.raises(ValueError, match="truncated"):
        await _transcribe(Model(), b"image")


async def test_focus_before_pagination_preserves_owner_and_search(client, users):
    owner = users["alice"]
    for index in range(25):
        store.set(f"p{index}", {"id": f"p{index}", "user_id": owner["id"], "filename": f"Paper {index}",
                   "title": f"Paper {index}", "status": "metadata"})
    store.set("foreign", {"id": "foreign", "user_id": users["bob"]["id"], "filename": "Foreign", "status": "metadata"})
    got = await client.get("/api/v1/library/?focus=p0,foreign", headers=owner["headers"])
    assert got.status_code == 200, got.text
    assert got.json()["total"] == 25
    assert got.json()["items"][0]["id"] == "p0"
    assert "foreign" not in [item["id"] for item in got.json()["items"]]
    second = await client.get("/api/v1/library/?focus=p0&page=2", headers=owner["headers"])
    assert len(second.json()["items"]) == 5
    found = await client.get("/api/v1/library/?search=Paper%200", headers=owner["headers"])
    assert found.json()["total"] == 1


async def test_review_import_is_durable_idempotent_and_owner_scoped(client, users, monkeypatch):
    from app.api.v1 import intake
    from app.core import jobs
    from app.services.paperdaily import api
    from types import SimpleNamespace

    monkeypatch.setattr(intake.billing, 'is_linked', lambda: True)
    async def delegation(*args): return SimpleNamespace(token='fixture')
    async def history(*args): return {'question': 'Synthetic', 'answer': 'Answer', 'cited_paper_ids': ['W1', 'W2', 'W1']}
    calls = []
    async def imported(user, sid, ids, tag):
        calls.extend(ids)
        return [{'source_id': ids[0], 'paper_id': 'local-' + ids[0], 'status': 'metadata'}]
    monkeypatch.setattr(intake.billing, 'delegation', delegation)
    monkeypatch.setattr(api, 'query_history', history)
    monkeypatch.setattr(intake, 'import_papers', imported)
    h = users['alice']['headers']
    path = '/api/v1/papers/import/paperdaily/review'
    first = (await client.post(path, json={'history_id': 1}, headers=h)).json()
    again = (await client.post(path, json={'history_id': 1}, headers=h)).json()
    assert first['job_id'] == again['job_id'] and first['total'] == 2
    assert await jobs.drain(['import_review']) == 1
    result = await client.get(path + '/1', headers=h)
    assert result.json()['status'] == 'done' and len(result.json()['items']) == 2
    assert (await client.get(path + '/1', headers=users['bob']['headers'])).status_code == 404
    await client.post(path, json={'history_id': 1}, headers=h)
    assert await jobs.drain(['import_review']) == 0
    assert calls == ['W1', 'W2']


async def test_review_partial_failure_resumes_without_reimporting_success(client, users, monkeypatch):
    from app.api.v1 import intake
    from app.core import jobs
    from app.services.paperdaily import api
    from types import SimpleNamespace
    monkeypatch.setattr(intake.billing, 'is_linked', lambda: True)
    async def delegation(*args): return SimpleNamespace(token='fixture')
    async def history(*args): return {'cited_paper_ids': ['W1', 'W2']}
    calls = []
    async def imported(user, sid, ids, tag):
        calls.extend(ids)
        if calls == ['W1', 'W2']:
            raise RuntimeError('fixture interruption')
        return [{'source_id': ids[0], 'paper_id': 'local-' + ids[0], 'status': 'metadata'}]
    monkeypatch.setattr(intake.billing, 'delegation', delegation)
    monkeypatch.setattr(api, 'query_history', history)
    monkeypatch.setattr(intake, 'import_papers', imported)
    path = '/api/v1/papers/import/paperdaily/review'
    h = users['alice']['headers']
    first = (await client.post(path, json={'history_id': 2}, headers=h)).json()
    await jobs.drain(['import_review'])
    failed = (await client.get(path + '/2', headers=h)).json()
    assert failed['status'] == 'failed' and len(failed['items']) == 1
    resumed = (await client.post(path, json={'history_id': 2, 'resume': True}, headers=h)).json()
    assert resumed['job_id'] == first['job_id'] and resumed['status'] == 'queued'
    await jobs.drain(['import_review'])
    result = (await client.get(path + '/2', headers=h)).json()
    assert result['status'] == 'done' and len(result['items']) == 2
    assert calls == ['W1', 'W2', 'W2']
