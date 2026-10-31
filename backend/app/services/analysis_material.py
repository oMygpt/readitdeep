"""Deterministic disclosure of the material actually sent to analysis."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def material_scope(source: str, limit: int) -> dict[str, Any]:
    selected = source[:limit]
    return {"version": 1, "source_sha256": digest(source),
            "input_sha256": digest(selected), "source_chars": len(source),
            "start": 0, "end": len(selected), "truncated": len(selected) < len(source)}


def analysis_input(source: str, limit: int) -> str:
    scope = material_scope(source, limit)
    return ("材料范围（系统测量）：" + json.dumps(scope, ensure_ascii=False)
            + "\n仅根据下列输入分析。truncated=true 表示局部前缀；未见章节不代表原论文缺失，"
            "不得猜测未覆盖的方法、工具变量或结果。\n\n" + source[:limit])


def material_status(paper: dict[str, Any]) -> dict[str, Any]:
    scopes = paper.get("analysis_material")
    if not scopes:
        return {"state": "unknown"}
    current = digest(paper.get("markdown_content") or "")
    stale = any(value.get("source_sha256") != current for value in scopes.values())
    return {"state": "stale" if stale else "current", "tasks": scopes}
