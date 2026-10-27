"""配置分层（设计 2026-10-27 v0.2 §5）：linked 下 Key/地址只来自部署层，管理员只能从允许列表选模型，用户只有偏好。"""

import pytest

from app.config import get_settings
from app.core.config_manager import ConfigManager
from app.core.database import async_session_maker
from app.models.system_config import SystemConfig
from app.models.user_config import UserConfig
from app.services.parsing import provider_order
from app.services.translation import build_translation_prompt
from tests.conftest import register


@pytest.fixture
def linked(monkeypatch):
    """返回一个函数：先用本地注册建好用户，再切到 linked（linked 下本地注册关闭）"""
    return lambda: _set_linked(monkeypatch)


def _set_linked(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "rid_mode", "linked")
    monkeypatch.setattr(s, "allowed_models", "Qwen/Qwen3.6-35B-A3B,Qwen/Qwen3-VL-32B-Instruct")
    monkeypatch.setattr(s, "llm_base_url", "http://campus/v1")
    monkeypatch.setattr(s, "llm_model", "Qwen/Qwen3.6-35B-A3B")


async def _seed(user_id):
    async with async_session_maker() as db:
        db.add_all([
            SystemConfig(key="llm_base_url", value="http://evil.example/v1"),
            SystemConfig(key="llm_api_key", value="sk-db"),
            SystemConfig(key="translation_model", value="Qwen/Qwen3-VL-32B-Instruct"),
            SystemConfig(key="smart_chat_model", value="gpt-unknown"),
            UserConfig(user_id=user_id, key="llm_model", value="my-model"),
            UserConfig(user_id=user_id, key="translate_target_lang", value="ja"),
        ])
        await db.commit()


async def test_linked_ignores_db_keys_and_urls(client, linked):
    u = await register(client, "a@example.com")
    linked()
    await _seed(u["id"])
    async with async_session_maker() as db:
        cfg = await ConfigManager.get_effective_config(db, u["id"])
    assert cfg["llm_base_url"] == "http://campus/v1" and cfg.get("llm_api_key", "") != "sk-db"
    assert cfg["translation_model"] == "Qwen/Qwen3-VL-32B-Instruct"  # 在允许列表内
    assert cfg.get("smart_chat_model") != "gpt-unknown"  # 不在允许列表
    assert cfg["llm_model"] == "Qwen/Qwen3.6-35B-A3B"  # 用户不能改模型
    assert cfg["translate_target_lang"] == "ja"  # 偏好生效


async def test_standalone_keeps_user_overrides(client):
    u = await register(client, "a@example.com")
    await _seed(u["id"])
    async with async_session_maker() as db:
        cfg = await ConfigManager.get_effective_config(db, u["id"])
    assert cfg["llm_model"] == "my-model" and cfg["llm_api_key"] == "sk-db"


async def test_write_endpoints_reject_in_linked(client, linked):
    from app.api.v1.auth import get_current_user
    from app.main import app
    from app.models.user import User

    admin = await register(client, "admin@example.com")  # 第一个注册者是管理员
    linked()
    # linked 下本地 JWT 不带主站会话会被拒（另有测试覆盖）；这里只测配置策略，直接注入当前用户
    async with async_session_maker() as db:
        user = await db.get(User, admin["id"])
    app.dependency_overrides[get_current_user] = lambda: user
    h = {}
    try:
        await _write_checks(client, h)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _write_checks(client, h):
    r = await client.put("/api/v1/auth/config", json={"llm_model": "x"}, headers=h)
    assert r.status_code == 400
    r = await client.post("/api/v1/auth/config/test", json={"api_type": "llm", "api_key": "k"}, headers=h)
    assert r.status_code == 400
    r = await client.put("/api/v1/admin/config", json={"llm_api_key": "k"}, headers=h)
    assert r.status_code == 400 and "部署层" in r.json()["detail"]
    r = await client.put("/api/v1/admin/config", json={"translation_model": "gpt-x"}, headers=h)
    assert r.status_code == 400
    r = await client.put("/api/v1/admin/config", json={"translation_model": "Qwen/Qwen3.6-35B-A3B"}, headers=h)
    assert r.status_code == 200


async def test_preferences_roundtrip_and_validation(client):
    u = await register(client, "a@example.com")
    h = u["headers"]
    r = await client.get("/api/v1/preferences", headers=h)
    assert r.json()["preferences"]["translate_target_lang"] == "zh" and r.json()["preferences"]["auto_translate"] is True
    body = {"translate_target_lang": "en", "translate_style": "literal",
            "glossary": [{"source": "attention", "target": "注意力"}], "parse_quality": "fast"}
    r = await client.put("/api/v1/preferences", json=body, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["translate_style"] == "literal"
    for bad in ({"llm_api_key": "x"}, {"translate_target_lang": "xx"}, {"glossary": [{"source": "a"}]},
                {"glossary": [{"source": "a", "target": "b"}] * 201}, {"auto_translate": "yes"}):
        assert (await client.put("/api/v1/preferences", json=bad, headers=h)).status_code == 400


def test_prompt_and_parse_quality():
    p = build_translation_prompt("We use attention {x}.", {"translate_target_lang": "en", "translate_style": "literal",
                                                           "glossary": [{"source": "attention", "target": "ATT"}, {"source": "absent", "target": "z"}]})
    assert "翻译成English" in p and "attention → ATT" in p and "absent" not in p and "{x}" in p
    assert "翻译成中文" in build_translation_prompt("x")
    cfg = {"vlm_model": "vl", "grobid_url": "http://g"}
    assert provider_order(cfg) == ["vlm", "grobid"]
    assert provider_order({**cfg, "parse_quality": "fast"}) == ["grobid"]
    assert provider_order({"vlm_model": "vl", "parse_quality": "fast"}) == ["vlm"]  # 没有别的解析器时仍用 VLM
