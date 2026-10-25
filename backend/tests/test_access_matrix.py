"""论文相关路由的权限矩阵：未登录 401、他人 403、所有者/管理员通过、团队成员可读。"""

import uuid

import pytest

from app.core.store import store
from app.core.workbench_store import workbench_store

READ_ROUTES = [
    "/api/v1/papers/{pid}",
    "/api/v1/papers/{pid}/content",
    "/api/v1/papers/{pid}/analysis",
    "/api/v1/papers/{pid}/translation",
    "/api/v1/papers/{pid}/tags",
    "/api/v1/papers/{pid}/workbench",
    "/api/v1/papers/{pid}/references/analysis",
    "/api/v1/monitor/{pid}",
]

OWNER_WRITE_ROUTES = [
    ("PUT", "/api/v1/papers/{pid}/tags", {"tags": ["x"]}),
    ("POST", "/api/v1/papers/{pid}/tags", {"tag": "x"}),
    ("DELETE", "/api/v1/papers/{pid}/tags/x", None),
    ("PUT", "/api/v1/papers/{pid}/category", {"category": "c"}),
]


def make_paper(owner_id, **extra):
    pid = str(uuid.uuid4())
    store.set(pid, {
        "id": pid,
        "filename": "p.pdf",
        "status": "completed",
        "user_id": owner_id,
        "markdown_content": "# T\n\n![fig](/uploads/images/%s/fig1.png)\n" % pid,
        **extra,
    })
    return pid


@pytest.mark.parametrize("route", READ_ROUTES)
async def test_read_routes(client, users, route):
    pid = make_paper(users["alice"]["id"])
    url = route.format(pid=pid)
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=users["bob"]["headers"])).status_code == 403
    assert (await client.get(url, headers=users["alice"]["headers"])).status_code == 200
    assert (await client.get(url, headers=users["admin"]["headers"])).status_code == 200


@pytest.mark.parametrize("method,route,body", OWNER_WRITE_ROUTES)
async def test_owner_write_routes(client, users, method, route, body):
    pid = make_paper(users["alice"]["id"])
    url = route.format(pid=pid)
    kw = {"json": body} if body is not None else {}
    assert (await client.request(method, url, **kw)).status_code == 401
    assert (await client.request(method, url, headers=users["bob"]["headers"], **kw)).status_code == 403
    assert (await client.request(method, url, headers=users["alice"]["headers"], **kw)).status_code == 200


async def test_missing_paper_is_404_for_logged_in(client, users):
    r = await client.get("/api/v1/papers/nope/content", headers=users["alice"]["headers"])
    assert r.status_code == 404


async def test_ownerless_legacy_paper_is_admin_only(client, users):
    pid = make_paper(None)
    url = f"/api/v1/papers/{pid}"
    assert (await client.get(url, headers=users["alice"]["headers"])).status_code == 403
    assert (await client.get(url, headers=users["admin"]["headers"])).status_code == 200


async def test_team_member_can_read_shared_paper(client, users):
    pid = make_paper(users["alice"]["id"])
    team = (await client.post("/api/v1/teams", json={"name": "lab"}, headers=users["alice"]["headers"])).json()
    invite = (await client.post(f"/api/v1/teams/{team['id']}/invite", json={}, headers=users["alice"]["headers"])).json()
    code = invite.get("invite_code") or invite.get("code")
    r = await client.post(f"/api/v1/teams/join/{code}", headers=users["bob"]["headers"])
    assert r.status_code in (200, 201), r.text
    r = await client.post(
        f"/api/v1/teams/papers/{pid}/share", json={"team_id": team["id"]}, headers=users["alice"]["headers"]
    )
    assert r.status_code in (200, 201), r.text
    assert (await client.get(f"/api/v1/papers/{pid}", headers=users["bob"]["headers"])).status_code == 200
    # 团队成员可读，但不能改所有者的元数据
    r = await client.put(f"/api/v1/papers/{pid}/category", json={"category": "x"}, headers=users["bob"]["headers"])
    assert r.status_code == 403


async def test_monitor_list_only_own_tasks(client, users):
    make_paper(users["alice"]["id"], status="parsing")
    make_paper(users["bob"]["id"], status="parsing")
    r = await client.get("/api/v1/monitor/", headers=users["alice"]["headers"])
    assert r.json()["count"] == 1


async def test_library_tags_are_per_user(client, users):
    make_paper(users["alice"]["id"], tags=["alice-tag"])
    make_paper(users["bob"]["id"], tags=["bob-tag"])
    r = await client.get("/api/v1/library/tags", headers=users["alice"]["headers"])
    assert [t["name"] for t in r.json()] == ["alice-tag"]


async def test_workbench_is_per_user(client, users):
    a, b = users["alice"], users["bob"]
    pid = make_paper(a["id"])
    item = (await client.post(
        "/api/v1/workbench/items",
        json={"type": "note", "title": "mine", "description": "d", "source_paper_id": pid, "zone": "notes"},
        headers=a["headers"],
    )).json()
    # 他人：看不到、改不了、删不了，也不能往别人的论文上挂条目
    assert (await client.get("/api/v1/workbench", headers=b["headers"])).json()["notes"] == []
    assert (await client.get(f"/api/v1/workbench/items/{item['id']}", headers=b["headers"])).status_code == 404
    assert (await client.put(f"/api/v1/workbench/items/{item['id']}", json={"title": "x"}, headers=b["headers"])).status_code == 404
    assert (await client.delete(f"/api/v1/workbench/items/{item['id']}", headers=b["headers"])).status_code == 404
    r = await client.post(
        "/api/v1/workbench/items",
        json={"type": "note", "title": "t", "description": "d", "source_paper_id": pid},
        headers=b["headers"],
    )
    assert r.status_code == 403
    # 本人
    assert [n["id"] for n in (await client.get("/api/v1/workbench", headers=a["headers"])).json()["notes"]] == [item["id"]]
    assert (await client.get("/api/v1/workbench/stats", headers=a["headers"])).json()["total_items"] == 1
    assert (await client.get("/api/v1/workbench/stats", headers=b["headers"])).json()["total_items"] == 0


async def test_legacy_workbench_item_belongs_to_paper_owner(client, users):
    pid = make_paper(users["alice"]["id"])
    legacy = workbench_store.add_item(type="method", title="old", description="d", source_paper_id=pid, zone="methods")
    a = (await client.get("/api/v1/workbench", headers=users["alice"]["headers"])).json()
    b = (await client.get("/api/v1/workbench", headers=users["bob"]["headers"])).json()
    assert [m["id"] for m in a["methods"]] == [legacy.id]
    assert b["methods"] == []
