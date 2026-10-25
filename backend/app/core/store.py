"""
Read it DEEP - 论文存储（数据库实现）

原先是进程内 dict + 每次写入整文件重写 data/papers.json，数据库只是异步补写
的副本：多进程/多副本不安全，崩溃可能丢数据。现在 papers 表是唯一事实来源，
接口（get / set / update / delete / keys / get_all / get_by_user）保持不变，
调用方无需改动。

一篇论文 = 固定列 + extra（小字段）+ extra_large（体积大、列表页用不到的字段）。
get() 返回与原 JSON 存储相同形状的 dict。

写入约定：
- set(id, paper)       新建或整条替换，只用于新建；
- update(id, changes)  在一个事务内读当前行、合并改动、写回。长任务（翻译、
  分析）只提交自己改的字段，不会用开始时的旧快照覆盖别人期间的修改。

这里用同步引擎：调用点遍布同步与异步代码，每次调用是一条短事务，
比原来在事件循环里重写整个 JSON 文件快得多。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import create_engine, delete, event, select
from sqlalchemy.engine import Engine

from app.models.paper import Paper

# 映射到 papers 表固定列的字段（其余进 extra / extra_large）
_STRING_COLUMNS = {
    "user_id": 36,
    "filename": 500,
    "file_path": 1000,
    "title": 1000,
    "category": 200,
    "doi": 200,
    "arxiv_id": 50,
    "status": 50,
    "source_provider": 50,
    "source_id": 200,
}
_TEXT_COLUMNS = {"abstract", "markdown_content", "translated_content", "error_message"}
_DATETIME_COLUMNS = {"created_at", "updated_at"}

# 体积大、列表页用不到的 extra 字段
LARGE_KEYS = {
    "embedding",
    "structure",
    "summary",
    "analysis",
    "s2_graph",
    "s2_cache",
    "reference_analysis",
    "translation_chunks",
    "tag_suggestions",
}

_LIGHT_COLUMNS = [
    c
    for c in Paper.__table__.columns
    if c.name not in {"markdown_content", "translated_content", "extra_large"}
]


def _to_datetime(value: Any) -> Optional[datetime]:
    """写入前统一为带时区的 UTC；不带时区的值（含旧 JSON 里的字符串）按 UTC 解释。"""
    if value is not None and not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value))
        except ValueError:
            return None
    return _utc(value)


def _utc(value: Any) -> Any:
    """SQLite 读回的时间不带时区；本存储写入的一律是 UTC，读出时补上。"""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _split(paper: dict) -> dict:
    """论文 dict → 列值（extra / extra_large 为完整替换值）。"""
    row: dict[str, Any] = {"extra": {}, "extra_large": {}}
    for key, value in paper.items():
        if key == "id":
            continue
        if key in _STRING_COLUMNS:
            row[key] = None if value is None else str(value)[: _STRING_COLUMNS[key]]
        elif key in _TEXT_COLUMNS:
            row[key] = value
        elif key in _DATETIME_COLUMNS:
            row[key] = _to_datetime(value)
        elif key == "tags":
            row["tags"] = None if value is None else (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
        elif key == "authors" and (value is None or isinstance(value, str)):
            row["authors"] = value
        elif key in LARGE_KEYS:
            row["extra_large"][key] = value
        else:
            row["extra"][key] = value
    return row


def _to_dict(row: Any) -> dict:
    m = row._mapping
    paper: dict[str, Any] = {}
    for key, value in m.items():
        if key in ("extra", "extra_large"):
            continue
        if key == "tags":
            if value is None:
                continue
            try:
                paper["tags"] = json.loads(value)
            except (TypeError, ValueError):
                paper["tags"] = value
            continue
        if value is None and key not in ("user_id", "status", "filename"):
            continue
        paper[key] = _utc(value) if key in _DATETIME_COLUMNS else value
    paper.update(m.get("extra") or {})
    paper.update(m.get("extra_large") or {})
    return paper


class PaperStore:
    def __init__(self) -> None:
        self._engine: Optional[Engine] = None

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            from app.core.database import sync_database_url

            url = sync_database_url()
            # PostgreSQL 会话时区固定为 UTC，与异步引擎一致
            kwargs: dict[str, Any] = {"pool_pre_ping": True, "connect_args": {"options": "-c timezone=utc"}}
            if url.startswith("sqlite"):
                kwargs = {"connect_args": {"check_same_thread": False, "timeout": 30}}
            self._engine = create_engine(url, **kwargs)
            if url.startswith("sqlite"):
                # SQLite 没有 SELECT ... FOR UPDATE。合并写需要在事务一开始就拿写锁
                # （BEGIN IMMEDIATE），否则两个进程会读到同一旧值再先后覆盖。
                # 为此关闭驱动自带的事务管理，由下面的 begin 事件自己发 BEGIN。

                @event.listens_for(self._engine, "connect")
                def _sqlite_connect(dbapi_conn, _):
                    dbapi_conn.isolation_level = None
                    cur = dbapi_conn.cursor()
                    cur.execute("PRAGMA journal_mode=WAL")
                    cur.execute("PRAGMA busy_timeout=30000")
                    cur.close()

                @event.listens_for(self._engine, "begin")
                def _sqlite_begin(conn):
                    immediate = conn.get_execution_options().get("rid_write_lock")
                    conn.exec_driver_sql("BEGIN IMMEDIATE" if immediate else "BEGIN")

        return self._engine

    # ---------- 读取 ----------

    def get(self, key: str) -> Optional[dict]:
        with self.engine.connect() as conn:
            row = conn.execute(select(Paper.__table__).where(Paper.id == key)).first()
        return _to_dict(row) if row else None

    def keys(self) -> list:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(select(Paper.id))]

    def _light(self, user_id: Optional[str]) -> list:
        stmt = select(*_LIGHT_COLUMNS)
        if user_id is not None:
            stmt = stmt.where(Paper.user_id == user_id)
        with self.engine.connect() as conn:
            return [_to_dict(r) for r in conn.execute(stmt)]

    def get_all(self) -> list:
        """全部论文的轻量 dict（不含正文、译文与 LARGE_KEYS）。"""
        return self._light(None)

    def get_by_user(self, user_id: str) -> list:
        """某用户论文的轻量 dict（不含正文、译文与 LARGE_KEYS）。"""
        return self._light(user_id)

    def get_all_or_by_user(self, user_id: str | None = None) -> list:
        return self.get_by_user(user_id) if user_id else self.get_all()

    # ---------- 写入 ----------

    def set(self, key: str, value: dict) -> None:
        """新建或整条替换。已有论文的局部修改请用 update()。"""
        row = _split(value)
        table = Paper.__table__
        with self.engine.begin() as conn:
            exists = conn.execute(select(Paper.id).where(Paper.id == key)).first()
            if exists:
                values = {c.name: None for c in table.columns if c.name != "id"}
                values.update(row)
                conn.execute(table.update().where(Paper.id == key).values(**values))
            else:
                row.setdefault("filename", value.get("filename") or "")
                row.setdefault("status", value.get("status") or "uploading")
                row.setdefault("created_at", datetime.now(timezone.utc))
                row.setdefault("updated_at", datetime.now(timezone.utc))
                conn.execute(table.insert().values(id=key, **row))

    def update(self, key: str, updates: dict) -> bool:
        """合并更新：只改 updates 里的字段。论文不存在时返回 False。"""
        table = Paper.__table__
        with self.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
            stmt = select(Paper.extra, Paper.extra_large).where(Paper.id == key)
            if conn.dialect.name == "postgresql":
                stmt = stmt.with_for_update()
            current = conn.execute(stmt).first()
            if current is None:
                return False
            row = _split(updates)
            extra = dict(current.extra or {})
            extra.update(row.pop("extra"))
            large = dict(current.extra_large or {})
            large.update(row.pop("extra_large"))
            conn.execute(
                table.update().where(Paper.id == key).values(extra=extra, extra_large=large, **row)
            )
        return True

    def delete(self, key: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(Paper.__table__).where(Paper.id == key))


# Global instance
store = PaperStore()
