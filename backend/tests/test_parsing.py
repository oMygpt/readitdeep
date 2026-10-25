import asyncio

import httpx

from app.core.store import store
from app.services import parsing
from app.services.parsing import ParseResult, parse_with_fallback, provider_order
from app.services.parsing.grobid import tei_to_markdown

TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
<teiHeader><fileDesc>
  <titleStmt><title level="a" type="main">A Tiny Paper</title></titleStmt>
  <sourceDesc><biblStruct><analytic>
    <author><persName><forename type="first">Ada</forename><surname>Lovelace</surname></persName></author>
    <author><persName><forename type="first">Alan</forename><surname>Turing</surname></persName></author>
  </analytic><idno type="DOI">10.1234/tiny</idno></biblStruct></sourceDesc>
</fileDesc>
<profileDesc><abstract><div><p>We study   tiny things.</p></div></abstract></profileDesc>
</teiHeader>
<text><body>
  <div><head n="1">Introduction</head><p>Prior work <ref type="bibr" target="#b0">[1]</ref> is small.</p></div>
  <div><head n="2.1">Method</head>
    <formula xml:id="f0">E = mc 2<label>(1)</label></formula>
    <p>See Figure 1.</p></div>
  <div><head>Unnumbered</head><p>Tail.</p></div>
  <figure xml:id="fig_0"><head>Figure 1 :</head><figDesc>Figure 1: Overview.</figDesc></figure>
  <figure type="table" xml:id="tab_0"><head>Table 1</head><figDesc>Results | main</figDesc>
    <table><row><cell>Model</cell><cell>Score</cell></row><row><cell>Ours</cell><cell>9|9</cell></row></table></figure>
  <note place="foot" n="1"><p>A footnote.</p></note>
</body>
<back>
  <div type="acknowledgement"><div><p>Thanks to all.</p></div></div>
  <div type="references"><listBibl>
    <biblStruct xml:id="b0"><monogr><title/></monogr><note type="raw_reference">Babbage. Engines. 1837.</note></biblStruct>
    <biblStruct xml:id="b1"><analytic><title level="a">On Numbers</title>
      <author><persName><forename>Kurt</forename><surname>Godel</surname></persName></author></analytic>
      <monogr><title level="j">Monatshefte</title><imprint><date when="1931"/></imprint></monogr></biblStruct>
  </listBibl></div>
</back></text></TEI>"""


def test_tei_to_markdown_structure():
    md, meta = tei_to_markdown(TEI)
    assert md.startswith("# A Tiny Paper\n\nAda Lovelace, Alan Turing\n\n## Abstract\n\nWe study tiny things.")
    assert "## 1 Introduction\n\nPrior work [1] is small." in md
    assert "### 2.1 Method" in md and "*E = mc 2* (1)" in md
    assert "### Unnumbered" in md
    assert "> **图** Figure 1: Overview." in md
    assert "**Results | main**" in md and "| Model | Score |\n| --- | --- |\n| Ours | 9\\|9 |" in md
    assert "## 注释\n\n- A footnote." in md and "## 致谢\n\nThanks to all." in md
    assert "[1] Babbage. Engines. 1837." in md and "[2] Kurt Godel. On Numbers. Monatshefte. 1931." in md
    assert meta == {"title": "A Tiny Paper", "authors": ["Ada Lovelace", "Alan Turing"], "doi": "10.1234/tiny", "reference_count": 2}


def test_provider_order_defaults():
    assert provider_order({}) == []
    assert provider_order({"grobid_url": "http://g"}) == ["grobid"]
    assert provider_order({"grobid_url": "http://g", "mineru_api_key": "k"}) == ["mineru", "grobid"]
    assert provider_order({"parse_providers": "grobid, mineru", "mineru_api_key": "k"}) == ["grobid", "mineru"]


async def test_fallback_to_grobid_when_mineru_fails(monkeypatch):
    calls = []

    async def fake_run(name, config, filename, content, paper_id):
        calls.append(name)
        if name == "mineru":
            return ParseResult(False, error="quota exceeded")
        return ParseResult(True, "# ok", meta={"title": "T"})

    monkeypatch.setattr(parsing, "_run", fake_run)
    r = await parse_with_fallback({"mineru_api_key": "k", "grobid_url": "http://g"}, "a.pdf", b"%PDF", "p")
    assert calls == ["mineru", "grobid"] and r.success and r.parser == "grobid"


async def test_all_fail_reports_each(monkeypatch):
    async def fake_run(name, *a):
        if name == "grobid":
            raise RuntimeError("boom")
        return ParseResult(False, error="nope")

    monkeypatch.setattr(parsing, "_run", fake_run)
    r = await parse_with_fallback({"parse_providers": "mineru,grobid"}, "a.pdf", b"", "p")
    assert not r.success and "mineru: nope" in r.error and "grobid: boom" in r.error
    r = await parse_with_fallback({}, "a.pdf", b"", "p")
    assert not r.success and "未配置" in r.error


async def test_grobid_provider_http(monkeypatch):
    from app.services.parsing import grobid

    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["multipart"] = b'name="input"' in request.content
        return httpx.Response(200, text=TEI)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(grobid.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    r = await grobid.parse_with_grobid("http://grobid:8070/", "a.pdf", b"%PDF-1.4")
    assert r.success and seen == {"path": "/api/processFulltextDocument", "multipart": True}
    assert (await grobid.parse_with_grobid("http://g", "a.docx", b"x")).error == "GROBID 只支持 PDF"


async def test_upload_pipeline_uses_grobid(client, users, monkeypatch):
    async def fake_grobid(url, filename, content):
        md, meta = tei_to_markdown(TEI)
        return ParseResult(True, md, meta=meta)

    monkeypatch.setattr("app.services.parsing.grobid.parse_with_grobid", fake_grobid)
    from app.core.database import async_session_maker
    from app.models.system_config import SystemConfig

    async with async_session_maker() as db:
        db.add(SystemConfig(key="grobid_url", value="http://g"))
        db.add(SystemConfig(key="mineru_api_key", value=""))
        await db.commit()

    files = {"file": ("tiny.pdf", b"%PDF-1.4", "application/pdf")}
    r = await client.post("/api/v1/papers/upload", files=files, headers=users["alice"]["headers"])
    pid = r.json()["id"]
    for _ in range(50):
        p = store.get(pid)
        if p.get("markdown_content"):
            break
        await asyncio.sleep(0.05)
    p = store.get(pid)
    assert p["parser"] == "grobid" and p["title"] == "A Tiny Paper" and p["doi"] == "10.1234/tiny"
    assert "## 1 Introduction" in p["markdown_content"]
    detail = (await client.get(f"/api/v1/papers/{pid}", headers=users["alice"]["headers"])).json()
    assert detail["parser"] == "grobid"
