"""Exact shared vectors copied from PaperDaily read-jobs-v1."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.paperdaily import api

FIXTURES = Path(__file__).parent / "fixtures" / "read-jobs-v1"


@pytest.mark.parametrize("name", ["create", "claim", "heartbeat", "complete"])
def test_assertion_vector(name, monkeypatch):
    vector = json.loads((FIXTURES / f"{name}.json").read_text())
    monkeypatch.setattr(api.time, "time", lambda: int(vector["timestamp"]))
    monkeypatch.setattr(api.secrets, "token_urlsafe", lambda n: vector["nonce"])
    raw = api.body_bytes(vector["body"])
    assert raw.decode() == vector["body_utf8"]
    actual = api.assertion_headers(vector["actor"], vector["secret"], vector["method"],
                                   vector["path"], raw, vector["key_id"])
    assert actual["X-Read-Signature"] == vector["signature"]
    assert actual["X-Read-Nonce"] == vector["nonce"]


def test_preflight_vector(monkeypatch):
    vector = json.loads((FIXTURES / "preflight.json").read_text())
    monkeypatch.setattr(api, "get_settings", lambda: SimpleNamespace(paperdaily_runner_secret=vector["secret"]))
    assert api.sign_preflight(vector["asset"])["signature"] == vector["signature"]
