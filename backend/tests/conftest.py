"""Test harness.

The app builds its engines at import time from settings, so the environment is
pinned here *before* any `app` import: a throwaway SQLite file, a throwaway
storage dir, and cwd moved into a temp dir so relative `data/` paths never touch
the developer's real data.
"""

import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="rid-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["STORAGE_PATH"] = str(_TMP / "uploads")
os.environ["CORS_ORIGINS"] = "http://testserver"
os.environ.setdefault("MINERU_API_KEY", "")
os.chdir(_TMP)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

from app.core.database import Base, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def fresh_state():
    """Every test starts with empty tables."""
    await init_db()
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
    yield


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


async def register(client: httpx.AsyncClient, email: str, password: str = "pw-123456") -> dict:
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"id": body["user"]["id"], "headers": {"Authorization": f"Bearer {body['access_token']}"}}


@pytest_asyncio.fixture
async def users(client):
    """admin (first registrant), alice and bob."""
    admin = await register(client, "admin@example.com")
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    return {"admin": admin, "alice": alice, "bob": bob}


@pytest.fixture
def no_parse(monkeypatch):
    """Upload without calling MinerU: the background parse becomes a no-op."""
    calls = []

    async def fake_parse(*args, **kwargs):
        calls.append(args)

    monkeypatch.setattr("app.api.v1.papers.parse_paper_task", fake_parse)
    return calls


@pytest_asyncio.fixture(scope="session", autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()
    from app.core.store import store

    store.engine.dispose()
