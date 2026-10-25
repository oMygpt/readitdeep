async def upload(client, user, name="paper.pdf"):
    files = {"file": (name, b"%PDF-1.4 fake", "application/pdf")}
    return await client.post("/api/v1/papers/upload", files=files, headers=user["headers"])


async def test_upload_requires_login(client, no_parse):
    files = {"file": ("x.pdf", b"%PDF", "application/pdf")}
    r = await client.post("/api/v1/papers/upload", files=files)
    assert r.status_code == 401
    assert no_parse.refresh() == []


async def test_upload_rejects_unknown_type(client, users, no_parse):
    r = await upload(client, users["alice"], "x.exe")
    assert r.status_code == 400


async def test_upload_creates_owned_paper_and_queues_parse(client, users, no_parse):
    r = await upload(client, users["alice"])
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert no_parse.refresh() == [pid]
    got = await client.get(f"/api/v1/papers/{pid}", headers=users["alice"]["headers"])
    assert got.status_code == 200
    assert got.json()["user_id"] == users["alice"]["id"]


async def test_paper_access_owner_other_anon_admin(client, users, no_parse):
    pid = (await upload(client, users["alice"])).json()["id"]
    for path in (f"/api/v1/papers/{pid}", f"/api/v1/papers/{pid}/content"):
        assert (await client.get(path, headers=users["alice"]["headers"])).status_code == 200
        assert (await client.get(path, headers=users["bob"]["headers"])).status_code == 403
        assert (await client.get(path)).status_code == 401
        assert (await client.get(path, headers=users["admin"]["headers"])).status_code == 200


async def test_library_lists_only_own_papers(client, users, no_parse):
    await upload(client, users["alice"], "a.pdf")
    await upload(client, users["bob"], "b.pdf")
    r = await client.get("/api/v1/library/", headers=users["alice"]["headers"])
    assert r.status_code == 200
    names = [p["filename"] for p in r.json()["items"]]
    assert names == ["a.pdf"]
