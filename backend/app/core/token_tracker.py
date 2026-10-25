"""
Read it DEEP - 模型用量统计

每次模型调用结束时按（日期、任务、模型）累加到 token_usage 表。
原来写 data/token_stats.json（每次整文件重写，多进程互相覆盖），升级时其中的
按日数据导入为 task="legacy" 的记录。

get_chat_model() 给每个模型实例挂上 TokenTrackingCallback，所有调用都会被记录。
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Any, Dict

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from sqlalchemy import func, select

logger = logging.getLogger(__name__)

LEGACY_STATS_FILE = Path(__file__).parent.parent.parent / "data" / "token_stats.json"
LEGACY_IMPORT = "token_stats_import_v1"


def _engine():
    from app.core.store import store

    return store.engine


def _upsert(conn, values: dict) -> None:
    from app.models.job import TokenUsage

    table = TokenUsage.__table__
    keys = ("prompt_tokens", "completion_tokens", "total_tokens", "calls")
    if conn.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(table).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["day", "task", "model"],
        set_={k: getattr(table.c, k) + getattr(stmt.excluded, k) for k in keys},
    )
    conn.execute(stmt)


class TokenTracker:
    def record(
        self,
        function_type: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int | None = None,
        model: str = "",
        day: date | None = None,
    ) -> None:
        if total_tokens is None:
            total_tokens = prompt_tokens + completion_tokens
        try:
            with _engine().begin() as conn:
                _upsert(conn, {
                    "day": day or date.today(),
                    "task": function_type[:50],
                    "model": (model or "")[:200],
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "calls": 1,
                })
        except Exception as e:  # 统计失败不能影响业务调用
            logger.error(f"Failed to record token usage: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """与旧 JSON 统计相同的结构：总计、按功能、按日期。"""
        from app.models.job import TokenUsage as T

        with _engine().connect() as conn:
            totals = conn.execute(
                select(func.coalesce(func.sum(T.total_tokens), 0), func.coalesce(func.sum(T.prompt_tokens), 0),
                       func.coalesce(func.sum(T.completion_tokens), 0), func.coalesce(func.sum(T.calls), 0))
            ).one()
            by_function = {
                r.task: {"total_tokens": int(r.tot), "prompt_tokens": int(r.pt), "completion_tokens": int(r.ct), "calls_count": int(r.n)}
                for r in conn.execute(
                    select(T.task, func.sum(T.total_tokens).label("tot"), func.sum(T.prompt_tokens).label("pt"),
                           func.sum(T.completion_tokens).label("ct"), func.sum(T.calls).label("n")).group_by(T.task)
                )
            }
            by_date = {
                r.day.isoformat(): {"total_tokens": int(r.tot), "calls_count": int(r.n)}
                for r in conn.execute(
                    select(T.day, func.sum(T.total_tokens).label("tot"), func.sum(T.calls).label("n")).group_by(T.day).order_by(T.day)
                )
            }
        return {
            "total_tokens": int(totals[0]),
            "total_prompt_tokens": int(totals[1]),
            "total_completion_tokens": int(totals[2]),
            "calls_count": int(totals[3]),
            "by_function": by_function,
            "by_date": by_date,
        }

    def reset(self) -> None:
        from app.models.job import TokenUsage

        with _engine().begin() as conn:
            conn.execute(TokenUsage.__table__.delete())


def import_legacy_stats(path: Path = LEGACY_STATS_FILE) -> int:
    """把旧 token_stats.json 的按日数据导入（只导一次）。返回导入的天数。"""
    from app.models.workbench_item import DataMigration

    if not path.exists():
        return 0
    with _engine().connect() as conn:
        if conn.execute(select(DataMigration.name).where(DataMigration.name == LEGACY_IMPORT)).first():
            return 0
    stats = json.loads(path.read_text(encoding="utf-8"))
    days = stats.get("by_date") or {}
    with _engine().begin() as conn:
        for day, v in days.items():
            _upsert(conn, {
                "day": date.fromisoformat(day), "task": "legacy", "model": "",
                "prompt_tokens": 0, "completion_tokens": 0,
                "total_tokens": int(v.get("total_tokens", 0)), "calls": int(v.get("calls_count", 0)),
            })
        conn.execute(DataMigration.__table__.insert().values(name=LEGACY_IMPORT, report={"days": len(days)}))
    return len(days)


class TokenTrackingCallback(BaseCallbackHandler):
    """LangChain 回调：调用结束时记录用量（非流式读 llm_output，流式读消息上的 usage_metadata）"""

    def __init__(self, function_type: str = "unknown"):
        super().__init__()
        self.function_type = function_type

    def on_llm_end(self, response: LLMResult, **kwargs):
        try:
            usage = (response.llm_output or {}).get("token_usage") or {}
            model = (response.llm_output or {}).get("model_name", "")
            prompt = usage.get("prompt_tokens", 0)
            completion = usage.get("completion_tokens", 0)
            total = usage.get("total_tokens", 0)
            if not (prompt or completion or total):
                for generations in response.generations:
                    for g in generations:
                        meta = getattr(getattr(g, "message", None), "usage_metadata", None) or {}
                        prompt += meta.get("input_tokens", 0)
                        completion += meta.get("output_tokens", 0)
                        total += meta.get("total_tokens", 0)
                        model = model or (getattr(g, "generation_info", None) or {}).get("model_name", "")
            if prompt or completion or total:
                token_tracker.record(self.function_type, prompt, completion, total or None, model)
        except Exception as e:
            logger.error(f"Failed to track tokens: {e}")


token_tracker = TokenTracker()


def get_tracking_callback(function_type: str) -> TokenTrackingCallback:
    return TokenTrackingCallback(function_type=function_type)
