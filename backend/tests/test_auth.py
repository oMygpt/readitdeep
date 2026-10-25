from tests.conftest import register


async def test_first_user_is_admin_then_user(client):
    a = await client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "x1234567"})
    b = await client.post("/api/v1/auth/register", json={"email": "b@example.com", "password": "x1234567"})
    assert a.json()["user"]["role"] == "admin"
    assert b.json()["user"]["role"] == "user"


async def test_duplicate_email_rejected(client):
    await register(client, "dup@example.com")
    r = await client.post("/api/v1/auth/register", json={"email": "dup@example.com", "password": "x1234567"})
    assert r.status_code == 400


async def test_login_and_me(client):
    await register(client, "me@example.com", "right-pass")
    bad = await client.post("/api/v1/auth/login", json={"email": "me@example.com", "password": "wrong"})
    assert bad.status_code == 401
    ok = await client.post("/api/v1/auth/login", json={"email": "me@example.com", "password": "right-pass"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "me@example.com"


async def test_garbage_token_rejected(client):
    r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
