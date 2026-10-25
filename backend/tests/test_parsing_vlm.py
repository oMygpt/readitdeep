import pymupdf

from app.services.parsing import provider_order
from app.services.parsing import vlm as vlm_mod


def make_pdf(pages=3) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=600, height=800)
        page.insert_text((72, 72), f"Page {i + 1} text")
        page.draw_rect(pymupdf.Rect(100, 200, 500, 500), color=(0, 0, 1), fill=(0.8, 0.8, 1))
    return doc.tobytes()


class FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def ainvoke(self, messages, **kw):
        self.calls += 1
        content = messages[0].content
        assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply

        class R:
            pass

        r = R()
        r.content = reply
        return r


def patch_llm(monkeypatch, llm):
    async def fake_get_chat_model(task, user_id, **kw):
        assert task == "vlm" and kw["channel"] == "vlm"
        return llm

    monkeypatch.setattr("app.services.llm.get_chat_model", fake_get_chat_model)


def test_provider_order_puts_vlm_first():
    assert provider_order({"vlm_model": "qwen-vl", "grobid_url": "http://g"}) == ["vlm", "grobid"]


def test_crop_figures_both_formats():
    doc = pymupdf.open(stream=make_pdf(1), filetype="pdf")
    md, images = vlm_mod.crop_figures(doc[0], 1, "text\n\n![Fig 1: box](bbox:160,250,840,625)\n\n![Fig 2](10, 10, 900, 900)\n\n![tiny](1,1,2,2)")
    assert md == "text\n\n![Fig 1: box](p1_fig1.png)\n\n![Fig 2](p1_fig2.png)\n\n*tiny*"
    assert set(images) == {"p1_fig1.png", "p1_fig2.png"}
    assert images["p1_fig1.png"].startswith(b"\x89PNG")


async def test_parse_with_vlm_assembles_pages(monkeypatch):
    llm = FakeLLM(["```markdown\n# A Title\n\nIntro $x$\n```", "## 2 Method\n\n![Overview](bbox:160,250,840,625)", "| a | b |\n|---|---|\n| 1 | 2 |"])
    patch_llm(monkeypatch, llm)
    r = await vlm_mod.parse_with_vlm("p.pdf", make_pdf(3), "u1")
    assert r.success and r.meta == {"pages": 3, "failed_pages": [], "figures": 1, "title": "A Title"}
    assert r.markdown_content.startswith("# A Title\n\nIntro $x$\n\n## 2 Method\n\n![Overview](p2_fig1.png)")
    assert list(r.images) == ["p2_fig1.png"]


async def test_single_page_retry_and_failure_threshold(monkeypatch):
    # 第 1 页失败一次后重试成功；第 2 页两次都失败 → 标注，1/3 页失败 > 30% → 整体失败
    llm = FakeLLM(["p1", RuntimeError("x"), "p1-retry", RuntimeError("a"), RuntimeError("b"), "p3"])
    patch_llm(monkeypatch, llm)
    r = await vlm_mod.parse_with_vlm("p.pdf", make_pdf(3), None)
    assert not r.success and "失败页过多" in r.error
    # 10 页里坏 1 页：成功并标注
    llm = FakeLLM(["ok"] * 4 + [RuntimeError("a"), RuntimeError("b")] + ["ok"] * 5)
    patch_llm(monkeypatch, llm)
    r = await vlm_mod.parse_with_vlm("p.pdf", make_pdf(10), None)
    assert r.success and len(r.meta["failed_pages"]) == 1 and "解析失败]" in r.markdown_content


async def test_rejects_non_pdf_and_page_limit(monkeypatch):
    assert (await vlm_mod.parse_with_vlm("a.docx", b"x", None)).error == "视觉模型解析只支持 PDF"
    r = await vlm_mod.parse_with_vlm("p.pdf", make_pdf(3), None, max_pages=2)
    assert "超过视觉解析上限" in r.error
    assert "无法打开" in (await vlm_mod.parse_with_vlm("p.pdf", b"not a pdf", None)).error


def test_vlm_model_config_resolution():
    from app.services.llm import resolve_model_config

    cfg = {"llm_base_url": "http://x/v1", "llm_api_key": "k", "llm_model": "m", "vlm_model": "qwen-vl"}
    assert resolve_model_config(cfg, "vlm") == (["http://x/v1"], "k", "qwen-vl")
