import time

from app.core.files import images_root, sign_markdown_images, signed_image_url
from app.core.store import store


def put_image(pid, name="fig1.png", data=b"\x89PNG fake"):
    d = images_root() / pid
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(data)


async def test_uploads_static_mount_is_gone(client):
    put_image("p1")
    assert (await client.get("/uploads/images/p1/fig1.png")).status_code == 404


async def test_markdown_links_are_signed_and_served(client, users):
    pid = "p-signed"
    put_image(pid)
    store._data[pid] = {
        "id": pid, "filename": "x.pdf", "status": "completed", "user_id": users["alice"]["id"],
        "markdown_content": f"![f](/uploads/images/{pid}/fig1.png)",
    }
    md = (await client.get(f"/api/v1/papers/{pid}/content", headers=users["alice"]["headers"])).json()["markdown"]
    assert "/uploads/" not in md
    url = md[md.index("(") + 1 : md.index(")")]
    assert url.startswith(f"/api/v1/files/images/{pid}/fig1.png?exp=")
    r = await client.get(url)
    assert r.status_code == 200 and r.content == b"\x89PNG fake"


async def test_bad_or_expired_signature_rejected(client):
    put_image("p2")
    good = signed_image_url("p2", "fig1.png")
    assert (await client.get(good.replace("sig=", "sig=0"))).status_code == 403
    expired = signed_image_url("p2", "fig1.png", now=time.time() - 30 * 3600)
    assert (await client.get(expired)).status_code == 403
    # 签名不能挪到别的论文/文件上
    other = good.replace("/p2/", "/p3/")
    assert (await client.get(other)).status_code == 403


async def test_traversal_names_rejected(client):
    url = signed_image_url("p2", "..")
    assert (await client.get(url)).status_code in (403, 404)


def test_sign_markdown_keeps_other_links():
    md = "see [x](https://example.com/a.png) and ![](/uploads/images/abc/f.png)"
    out = sign_markdown_images(md)
    assert "https://example.com/a.png" in out and "/api/v1/files/images/abc/f.png?exp=" in out
