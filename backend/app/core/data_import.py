"""
Read it DEEP - 旧 JSON 存储导入与启动恢复

import_json(): 把 R2 之前的 data/papers.json、data/workbench.json 导入数据库。
- 幂等：按 id 插入或覆盖，重复执行结果不变；JSON 字段覆盖旧同步逻辑写进 DB 的同名字段；
- user_id 指向不存在的用户时置空（只有管理员可见），计入报告；
- 工作台条目的归属在导入时显式写入：条目自身 user_id → 来源论文所有者；
- 原文件不删除，保留为只读备份。

recover_stuck(): 进程内后台任务在重启后会丢失。启动时把长时间停在中间状态的
论文与翻译改成明确的结果：已有正文的论文恢复为 completed，没有正文的标为
failed 并提示重试；翻译标为 failed（已完成的分块保留，重试时续传）。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select

from app.core.store import store
from app.core.workbench_store import workbench_store

logger = logging.getLogger(__name__)

MIGRATION_NAME = "json_import_v1"
TRANSITIONAL_STATUSES = {"uploading", "parsing", "indexing", "embedding", "embedding_done", "analyzing", "classifying"}
RESTART_MESSAGE = "服务重启中断，请点击重新分析"


def _existing_user_ids() -> set[str]:
    from app.models.user import User

    with store.engine.connect() as conn:
        return {r[0] for r in conn.execute(select(User.id))}


def _already_imported() -> bool:
    from app.models.workbench_item import DataMigration

    with store.engine.connect() as conn:
        return conn.execute(select(DataMigration.name).where(DataMigration.name == MIGRATION_NAME)).first() is not None


def _record(report: dict) -> None:
    from app.models.workbench_item import DataMigration

    table = DataMigration.__table__
    with store.engine.begin() as conn:
        conn.execute(table.delete().where(table.c.name == MIGRATION_NAME))
        conn.execute(table.insert().values(name=MIGRATION_NAME, report=report))


def import_json(papers_path: Path, workbench_path: Path) -> dict:
    """执行导入并返回对账报告（不检查是否已导入过）。"""
    users = _existing_user_ids()
    report: dict[str, Any] = {
        "papers": {"total": 0, "inserted": 0, "updated": 0, "orphan_user": 0, "content_mismatch": []},
        "workbench": {"total": 0, "inserted": 0, "updated": 0, "unowned": 0},
        "sources": {"papers": str(papers_path), "workbench": str(workbench_path)},
    }

    papers: dict[str, dict] = {}
    if papers_path.exists():
        papers = json.loads(papers_path.read_text(encoding="utf-8"))
    for pid, paper in papers.items():
        report["papers"]["total"] += 1
        paper = {**paper, "id": pid}
        if paper.get("user_id") and paper["user_id"] not in users:
            paper["user_id"] = None
            report["papers"]["orphan_user"] += 1
        if store.get(pid) is None:
            store.set(pid, paper)
            report["papers"]["inserted"] += 1
        else:
            store.update(pid, {k: v for k, v in paper.items() if k != "id"})
            report["papers"]["updated"] += 1
        stored = store.get(pid) or {}
        for key in ("markdown_content", "translated_content"):
            if (paper.get(key) or "") != (stored.get(key) or ""):
                report["papers"]["content_mismatch"].append(f"{pid}:{key}")

    items: dict[str, dict] = {}
    if workbench_path.exists():
        items = json.loads(workbench_path.read_text(encoding="utf-8")).get("items", {})
    for item_id, item in items.items():
        report["workbench"]["total"] += 1
        owner: Optional[str] = item.get("user_id")
        source = item.get("source_paper_id")
        if not owner and source:
            owner = (papers.get(source) or store.get(source) or {}).get("user_id")
        if owner not in users:
            owner = None
        if owner is None:
            report["workbench"]["unowned"] += 1
        fields = {
            "type": item.get("type") or "note",
            "title": item.get("title") or "",
            "description": item.get("description") or "",
            "zone": item.get("zone") or "notes",
            "data": item.get("data") or {},
        }
        if workbench_store.get_item(item_id) is None:
            workbench_store.add_item(
                source_paper_id=source,
                user_id=owner,
                item_id=item_id,
                created_at=item.get("created_at") or "",
                **fields,
            )
            # add_item 在 user_id 为空时会按论文回落；这里要求与上面算出的归属一致
            if owner is None:
                _set_item_owner(item_id, None)
            report["workbench"]["inserted"] += 1
        else:
            workbench_store.update_item(item_id, fields)
            _set_item_owner(item_id, owner)
            report["workbench"]["updated"] += 1
    return report


def _set_item_owner(item_id: str, owner: Optional[str]) -> None:
    from app.models.workbench_item import WorkbenchItem

    table = WorkbenchItem.__table__
    with store.engine.begin() as conn:
        conn.execute(table.update().where(table.c.id == item_id).values(user_id=owner))


def import_json_if_needed(data_dir: Path = Path("data")) -> Optional[dict]:
    papers_path = data_dir / "papers.json"
    workbench_path = data_dir / "workbench.json"
    if not (papers_path.exists() or workbench_path.exists()) or _already_imported():
        return None
    report = import_json(papers_path, workbench_path)
    _record(report)
    logger.info("Imported legacy JSON store: %s", json.dumps({k: v for k, v in report.items() if k != "sources"}, ensure_ascii=False))
    return report


def recover_stuck(max_age_minutes: int = 60, now: Optional[datetime] = None) -> dict:
    from app.models.paper import Paper

    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=max_age_minutes)
    result = {"completed": 0, "failed": 0, "translation_failed": 0}
    with store.engine.connect() as conn:
        rows = conn.execute(select(Paper.id, Paper.status, Paper.updated_at)).all()
    from app.core.jobs import active_paper_ids

    queued = active_paper_ids()  # 有排队/运行中任务的论文交给任务队列处理
    for pid, status, updated_at in rows:
        if pid in queued:
            continue
        if updated_at is not None and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        if updated_at is not None and updated_at > cutoff:
            continue
        paper = store.get(pid) or {}
        if status in TRANSITIONAL_STATUSES:
            if paper.get("markdown_content"):
                store.update(pid, {"status": "completed"})
                result["completed"] += 1
            else:
                store.update(pid, {"status": "failed", "error_message": RESTART_MESSAGE})
                result["failed"] += 1
        if paper.get("translation_status") == "translating":
            store.update(pid, {"translation_status": "failed", "translation_error": "服务重启中断，请重新翻译（已完成部分会保留）"})
            result["translation_failed"] += 1
    if any(result.values()):
        logger.warning("Recovered stuck tasks after restart: %s", result)
    return result
