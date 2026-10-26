"""用主站与 RiD 共用的样例（tests/fixtures/paperdaily-connect-v1，原样复制自主站）校验 RiD 的解析与处理。"""

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from app.config import get_settings
from app.services.paperdaily import client, events, sessions

FIX = Path(__file__).parent / "fixtures" / "paperdaily-connect-v1"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


@pytest.fixture
def linked(monkeypatch):
    import base64

    s = get_settings()
    for k, v in {"rid_mode": "linked", "public_base_url": "https://read.paperdaily.org",
                 "paperdaily_web_url": "https://paperdaily.org", "paperdaily_client_id": "read",
                 "paperdaily_token_keys": "v1:" + base64.b64encode(b"k" * 32).decode()}.items():
        monkeypatch.setattr(s, k, v)


def test_contract_constants_match_settings(linked):
    c = load("contract.json")
    s = get_settings()
    assert c["issuer"] == s.paperdaily_issuer and c["client_id"] == s.paperdaily_client_id
    assert c["redirect_uri"] == client.redirect_uri() and c["scope"] == s.paperdaily_scopes == ""
    assert c["events_method"] == "POST" and c["refresh"] is False and c["pkce"] == "S256"


def test_authorize_url_has_exactly_the_fixture_parameters(linked):
    url = client.authorize_url("s" * 43, "c" * 43)
    parsed = urlparse(url)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://paperdaily.org" + load("contract.json")["authorization_path"]
    q = {k: v[0] for k, v in parse_qs(parsed.query, keep_blank_values=True).items()}
    expected = {k: v for k, v in load("authorize-request.json").items() if v != ""}  # 空 scope 可省略
    assert q == {**expected, "state": "s" * 43, "code_challenge": "c" * 43}


async def test_token_response_creates_subject_mapped_user(linked):
    user, session = await sessions.complete_login(load("token-response.json"))
    assert user.external_provider == "paperdaily" and user.external_subject == "u-example"
    assert session.grant_id == "grt_example" and session.auth_version == 7
    # 再次登录映射到同一用户；不会按邮箱合并到既有账号
    again, _ = await sessions.complete_login(load("token-response.json"))
    assert again.id == user.id and user.email.endswith("@users.paperdaily.invalid")


async def test_events_response_fixture_is_processed(linked, monkeypatch):
    calls = []

    async def fake_events_after(cursor, acks=None, limit=100):
        calls.append((cursor, list(acks or [])))
        return load("events-response.json") if not calls[:-1] else {"events": [], "next_cursor": 42, "has_more": False}

    deleted = []

    async def fake_delete(subject):
        deleted.append(subject)
        return True

    monkeypatch.setattr(client, "events_after", fake_events_after)
    monkeypatch.setattr(sessions, "delete_account", fake_delete)
    assert await events.pull_once() == 1
    assert deleted == ["u-example"]
    assert calls == [(0, []), (42, ["evt_example"])]  # 请求格式与 events-request 一致；处理后 ack
    req = load("events-request.json")
    assert set(req) == {"after_cursor", "limit", "ack_event_ids"}
