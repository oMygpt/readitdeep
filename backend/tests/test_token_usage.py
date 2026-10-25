import json
from datetime import date

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from app.core.token_tracker import TokenTrackingCallback, import_legacy_stats, token_tracker


async def test_record_accumulates_and_reports_old_shape():
    token_tracker.record("translation", 10, 5, model="qwen", day=date(2026, 10, 1))
    token_tracker.record("translation", 1, 1, model="qwen", day=date(2026, 10, 1))
    token_tracker.record("smart_chat", 3, 4, model="qwen", day=date(2026, 10, 2))
    s = token_tracker.get_stats()
    assert s["total_tokens"] == 24 and s["total_prompt_tokens"] == 14 and s["calls_count"] == 3
    assert s["by_function"]["translation"] == {"total_tokens": 17, "prompt_tokens": 11, "completion_tokens": 6, "calls_count": 2}
    assert s["by_date"] == {"2026-10-01": {"total_tokens": 17, "calls_count": 2}, "2026-10-02": {"total_tokens": 7, "calls_count": 1}}
    token_tracker.reset()
    assert token_tracker.get_stats()["calls_count"] == 0


async def test_callback_reads_streaming_usage_metadata():
    msg = AIMessage(content="hi", usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10})
    TokenTrackingCallback("smart_deep").on_llm_end(LLMResult(generations=[[ChatGeneration(message=msg)]]))
    TokenTrackingCallback("chat").on_llm_end(LLMResult(generations=[], llm_output={"token_usage": {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4}, "model_name": "m"}))
    s = token_tracker.get_stats()
    assert s["by_function"]["smart_deep"]["total_tokens"] == 10 and s["by_function"]["chat"]["total_tokens"] == 4


async def test_legacy_import_once(tmp_path):
    f = tmp_path / "token_stats.json"
    f.write_text(json.dumps({"by_date": {"2025-12-20": {"total_tokens": 100, "calls_count": 4}}}))
    assert import_legacy_stats(f) == 1
    assert import_legacy_stats(f) == 0
    s = token_tracker.get_stats()
    assert s["by_function"]["legacy"]["total_tokens"] == 100 and s["by_date"]["2025-12-20"]["calls_count"] == 4


async def test_chat_model_tracks_usage(users):
    from app.core.database import async_session_maker
    from app.models.system_config import SystemConfig
    from app.services.llm import get_chat_model

    async with async_session_maker() as db:
        db.add(SystemConfig(key="llm_base_url", value="http://x/v1"))
        db.add(SystemConfig(key="llm_model", value="m"))
        await db.commit()
    llm = await get_chat_model("translate", None, usage_label="translation")
    assert llm.stream_usage is True
    assert any(isinstance(c, TokenTrackingCallback) and c.function_type == "translation" for c in llm.callbacks)
