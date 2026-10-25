import asyncio
import json

import httpx
import pytest
from langchain_openai import ChatOpenAI

from app.services.llm import (
    BATCH,
    INTERACTIVE,
    EndpointPool,
    PoolTransport,
    resolve_model_config,
    split_endpoints,
)

MAIN = {"llm_base_url": "http://a/v1, http://b/v1", "llm_api_key": "main-key", "llm_model": "m"}


def test_split_endpoints():
    assert split_endpoints(" http://a/v1/ ,http://b/v1\nhttp://c/v1 ") == ["http://a/v1", "http://b/v1", "http://c/v1"]
    assert split_endpoints("") == []


def test_resolve_main_and_translate_fallback():
    assert resolve_model_config(MAIN, "chat") == (["http://a/v1", "http://b/v1"], "main-key", "m")
    # 翻译没配地址 → 主模型端点与 Key
    assert resolve_model_config(MAIN, "translate") == (["http://a/v1", "http://b/v1"], "main-key", "m")
    # 翻译配了自己的地址 → 用自己的 Key（为空也不借主 Key）
    cfg = {**MAIN, "translation_base_url": "http://t/v1", "translation_model": "tm"}
    assert resolve_model_config(cfg, "translate") == (["http://t/v1"], "", "tm")


def test_resolve_smart_custom_only_when_enabled():
    cfg = {**MAIN, "smart_math_base_url": "http://s/v1", "smart_math_model": "sm"}
    assert resolve_model_config(cfg, "smart:math")[0] == ["http://a/v1", "http://b/v1"]
    cfg["smart_analysis_mode"] = "custom"
    assert resolve_model_config(cfg, "smart:math") == (["http://s/v1"], "", "sm")
    assert resolve_model_config(cfg, "smart:deep")[0] == ["http://a/v1", "http://b/v1"]


def _pool(bases=("http://a/v1", "http://b/v1"), limits=None):
    return EndpointPool(list(bases), limits or {INTERACTIVE: 8, BATCH: 2})


async def _send(transport, path="/chat/completions"):
    async with httpx.AsyncClient(transport=transport) as c:
        return await c.post(f"http://a/v1{path}", json={"x": 1})


async def test_failover_on_connect_error_and_cooldown():
    seen = []

    def handler(request):
        seen.append(request.url.host)
        if request.url.host == "a":
            raise httpx.ConnectError("down")
        return httpx.Response(200, json={"host": request.url.host, "body": json.loads(request.content)})

    pool = _pool()
    t = PoolTransport(pool, BATCH, inner=httpx.MockTransport(handler))
    r = await _send(t)
    assert r.json() == {"host": "b", "body": {"x": 1}}
    # a 在冷却期：后续请求不再先打 a
    seen.clear()
    for _ in range(3):
        assert (await _send(t)).json()["host"] == "b"
    assert "a" not in seen


async def test_retry_on_5xx_but_return_last_response():
    def handler(request):
        return httpx.Response(503 if request.url.host == "a" else 200, json={"host": request.url.host})

    t = PoolTransport(_pool(), BATCH, inner=httpx.MockTransport(handler))
    assert (await _send(t)).json()["host"] == "b"

    t2 = PoolTransport(_pool(), BATCH, inner=httpx.MockTransport(lambda r: httpx.Response(502)))
    assert (await _send(t2)).status_code == 502


async def test_channel_concurrency_limit_and_isolation():
    active = {"batch": 0, "max_batch": 0}
    gate = asyncio.Event()

    async def handler(request):
        active["batch"] += 1
        active["max_batch"] = max(active["max_batch"], active["batch"])
        await gate.wait()
        active["batch"] -= 1
        return httpx.Response(200, json={})

    pool = _pool(limits={INTERACTIVE: 8, BATCH: 2})
    batch = PoolTransport(pool, BATCH, inner=httpx.MockTransport(handler))
    tasks = [asyncio.create_task(_send(batch)) for _ in range(5)]
    await asyncio.sleep(0.05)
    assert active["max_batch"] == 2  # 批量通道最多 2 个在途

    # 批量通道占满时，交互通道照样能发
    interactive = PoolTransport(pool, INTERACTIVE, inner=httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": 1})))
    assert (await asyncio.wait_for(_send(interactive), 1)).json() == {"ok": 1}

    gate.set()
    await asyncio.gather(*tasks)
    assert pool.semaphores[BATCH]._value == 2  # 名额全部归还


async def test_streaming_holds_slot_until_closed():
    pool = _pool(limits={INTERACTIVE: 1, BATCH: 1})
    class Chunks(httpx.AsyncByteStream):  # 真正的流：读之前没有内容
        async def __aiter__(self):
            yield b"data: x\n\n"

    t = PoolTransport(pool, BATCH, inner=httpx.MockTransport(lambda r: httpx.Response(200, stream=Chunks())))
    async with httpx.AsyncClient(transport=t) as c:
        async with c.stream("POST", "http://a/v1/chat/completions", json={}) as r:
            assert pool.semaphores[BATCH].locked()
            await r.aread()
    assert not pool.semaphores[BATCH].locked()


async def test_openai_sdk_through_pool():
    def handler(request):
        if request.url.host == "a":
            raise httpx.ConnectError("down")
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={
            "id": "x", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello from b"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        })

    client = httpx.AsyncClient(transport=PoolTransport(_pool(), INTERACTIVE, inner=httpx.MockTransport(handler)))
    llm = ChatOpenAI(base_url="http://a/v1", api_key="k", model="m", http_async_client=client, max_retries=0)
    assert (await llm.ainvoke("hi")).content == "hello from b"


async def test_get_chat_model_uses_admin_config(users):
    from app.core.database import async_session_maker
    from app.models.system_config import SystemConfig
    from app.services.llm import get_chat_model

    async with async_session_maker() as db:
        db.add(SystemConfig(key="llm_base_url", value="http://x1/v1,http://x2/v1"))
        db.add(SystemConfig(key="llm_model", value="qwen"))
        db.add(SystemConfig(key="translation_model", value="qwen-mt"))
        await db.commit()
    llm = await get_chat_model("translate", users["alice"]["id"])
    assert llm.model_name == "qwen-mt" and str(llm.openai_api_base) == "http://x1/v1"


async def test_get_chat_model_unconfigured(users, monkeypatch):
    from app.services import llm as llm_mod

    async def empty(db, user_id=None):
        return {}

    monkeypatch.setattr("app.core.config_manager.ConfigManager.get_effective_config", staticmethod(empty))
    with pytest.raises(llm_mod.LLMNotConfigured):
        await llm_mod.get_chat_model("chat", None)


def test_parse_extra_body():
    from app.services.llm import parse_extra_body

    assert parse_extra_body('{"chat_template_kwargs": {"enable_thinking": false}}') == {"chat_template_kwargs": {"enable_thinking": False}}
    assert parse_extra_body({"a": 1}) == {"a": 1}
    assert parse_extra_body("not json") is None and parse_extra_body("") is None and parse_extra_body("[1]") is None
