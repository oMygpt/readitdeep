import pytest

from app.config import Settings
from app.core.url_guard import validate_public_url
from app.main import check_security_settings


@pytest.mark.parametrize("secret", ["", "change-me-in-production", "your-super-secret-key-change-in-production", "short"])
def test_insecure_secret_refuses_to_start(secret):
    with pytest.raises(RuntimeError):
        check_security_settings(Settings(secret_key=secret, debug=False))


def test_insecure_secret_only_warns_in_debug():
    check_security_settings(Settings(secret_key="", debug=True))


def test_strong_secret_ok():
    check_security_settings(Settings(secret_key="x" * 32, debug=False))


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/v1", "http://localhost/v1", "http://10.0.0.5/v1",
    "http://192.168.1.1", "http://169.254.169.254/latest", "ftp://example.com", "http://[::1]/",
])
def test_private_urls_rejected(url):
    with pytest.raises(ValueError):
        validate_public_url(url)


async def test_user_cannot_set_endpoint_by_default(client, users):
    h = users["alice"]["headers"]
    r = await client.put("/api/v1/auth/config", json={"llm_base_url": "http://10.0.0.1/v1"}, headers=h)
    assert r.status_code == 403
    # 只填自己的 key 仍然可以
    r = await client.put("/api/v1/auth/config", json={"llm_api_key": "sk-mine"}, headers=h)
    assert r.status_code == 200


async def test_user_endpoint_allowed_but_private_blocked(client, users, monkeypatch):
    from app.api.v1 import auth

    monkeypatch.setattr(auth.settings, "allow_user_endpoints", True)
    h = users["alice"]["headers"]
    r = await client.put("/api/v1/auth/config", json={"llm_base_url": "http://127.0.0.1:9/v1"}, headers=h)
    assert r.status_code == 400
    r = await client.post("/api/v1/auth/config/test", json={"api_type": "llm", "api_key": "k", "base_url": "http://192.168.0.2"}, headers=h)
    assert r.status_code == 400


async def test_stored_user_url_ignored_when_not_allowed(users):
    from app.core.config_manager import ConfigManager
    from app.core.database import async_session_maker

    async with async_session_maker() as db:
        await ConfigManager.set_user_config(db, users["alice"]["id"], {"llm_base_url": "http://10.1.1.1/v1"})
        cfg = await ConfigManager.get_effective_config(db, users["alice"]["id"])
    assert cfg.get("llm_base_url") != "http://10.1.1.1/v1"
