"""
Read it DEEP - 持久化后台任务

原来的上传解析、重新分析、翻译都是进程内任务（BackgroundTasks / create_task），
进程一重启就丢了，论文永远停在「解析中」。现在先写一条 jobs 记录，再由 worker 认领执行：

- enqueue():   写入 queued 任务；同一论文同类任务已在排队或运行时直接返回已有任务；
- claim():     原子地把一条 queued 任务改为 running（PostgreSQL 用 FOR UPDATE SKIP LOCKED，
               SQLite 用 BEGIN IMMEDIATE），多进程多副本不会重复执行；
- heartbeat(): 运行中每 30 秒更新心跳；
- requeue_stale(): 心跳超时的 running 任务（进程崩溃/重启）重新排队，超过最大尝试次数则失败；
- Worker:      进程内循环，按任务类型限并发。lifespan 启动，RID_WORKER=0 可关闭
               （例如只想让部分副本执行任务）。

任务处理函数自己负责把失败写到论文状态上（与原来一致）；jobs 表只关心「有没有执行完」。
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from sqlalchemy import and_, select, update

from app.core.store import store
from app.models.job import Job

logger = logging.getLogger(__name__)

ACTIVE = ("queued", "running")
MAX_ATTEMPTS = 3
HEARTBEAT_SECONDS = 30
STALE_AFTER = timedelta(minutes=5)
# 每个进程每类任务的并发数（解析与翻译会占用外部解析服务和模型批量通道）
KIND_CONCURRENCY = {"parse": 2, "analyze": 2, "translate": 1}

_table = Job.__table__


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row(row) -> dict:
    return dict(row._mapping)


def enqueue(kind: str, paper_id: Optional[str], user_id: Optional[str], payload: Optional[dict] = None) -> str:
    with store.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
        existing = conn.execute(
            select(_table.c.id).where(
                _table.c.kind == kind, _table.c.paper_id == paper_id, _table.c.status.in_(ACTIVE)
            )
        ).first()
        if existing:
            return existing[0]
        job_id = str(uuid.uuid4())
        conn.execute(
            _table.insert().values(
                id=job_id, kind=kind, paper_id=paper_id, user_id=user_id, status="queued",
                attempts=0, payload=payload or {}, created_at=_now(),
            )
        )
    return job_id


def get(job_id: str) -> Optional[dict]:
    with store.engine.connect() as conn:
        row = conn.execute(select(_table).where(_table.c.id == job_id)).first()
    return _row(row) if row else None


def active_paper_ids() -> set[str]:
    with store.engine.connect() as conn:
        return {r[0] for r in conn.execute(select(_table.c.paper_id).where(_table.c.status.in_(ACTIVE))) if r[0]}


def claim(worker: str, kinds: list[str]) -> Optional[dict]:
    if not kinds:
        return None
    with store.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
        stmt = (
            select(_table)
            .where(_table.c.status == "queued", _table.c.kind.in_(kinds))
            .order_by(_table.c.created_at)
            .limit(1)
        )
        if conn.dialect.name == "postgresql":
            stmt = stmt.with_for_update(skip_locked=True)
        row = conn.execute(stmt).first()
        if row is None:
            return None
        now = _now()
        conn.execute(
            update(_table)
            .where(_table.c.id == row.id)
            .values(status="running", worker=worker, attempts=row.attempts + 1, started_at=now, heartbeat_at=now)
        )
    job = _row(row)
    job.update(status="running", worker=worker, attempts=job["attempts"] + 1)
    return job


def heartbeat(job_id: str) -> None:
    with store.engine.begin() as conn:
        conn.execute(update(_table).where(_table.c.id == job_id, _table.c.status == "running").values(heartbeat_at=_now()))


def finish(job_id: str, ok: bool, error: Optional[str] = None) -> None:
    with store.engine.begin() as conn:
        conn.execute(
            update(_table)
            .where(_table.c.id == job_id)
            .values(status="done" if ok else "failed", error=error, finished_at=_now())
        )


def requeue_stale(now: Optional[datetime] = None) -> dict:
    """心跳超时的 running 任务：未超过最大尝试次数则重新排队，否则标为失败并写到论文上。"""
    now = now or _now()
    cutoff = now - STALE_AFTER
    result = {"requeued": 0, "failed": 0}
    gave_up: list[tuple[str, str]] = []
    with store.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
        stale = conn.execute(
            select(_table).where(and_(_table.c.status == "running", _table.c.heartbeat_at < cutoff))
        ).all()
        for job in stale:
            if job.attempts < MAX_ATTEMPTS:
                conn.execute(update(_table).where(_table.c.id == job.id).values(status="queued", worker=None))
                result["requeued"] += 1
            else:
                conn.execute(
                    update(_table)
                    .where(_table.c.id == job.id)
                    .values(status="failed", error="多次中断后放弃", finished_at=now)
                )
                result["failed"] += 1
                if job.paper_id:
                    gave_up.append((job.kind, job.paper_id))
    # 论文状态在任务事务提交后再改（SQLite 同时只能有一个写事务）
    for kind, paper_id in gave_up:
        _mark_paper_failed(kind, paper_id)
    if any(result.values()):
        logger.warning("Stale jobs handled: %s", result)
    return result


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def requeue_local_orphans(me: str) -> int:
    """启动时立即接管本机上已经不在的进程留下的 running 任务，不必等心跳超时。

    worker 名为 主机名:pid:启动随机串。同主机且（pid 已不存在，或 pid 与本进程相同但
    启动串不同——容器重启后 pid 复用）的任务视为孤儿，重新排队。"""
    host, pid, boot = me.rsplit(":", 2)
    orphans = []
    with store.engine.connect() as conn, conn.execution_options(rid_write_lock=True).begin():
        for job in conn.execute(select(_table).where(_table.c.status == "running", _table.c.worker.like(f"{host}:%"))).all():
            try:
                _, other_pid, other_boot = job.worker.rsplit(":", 2)
                other_pid = int(other_pid)
            except ValueError:
                continue
            dead = not _pid_alive(other_pid) if other_pid != int(pid) else other_boot != boot
            if dead:
                orphans.append(job.id)
                conn.execute(update(_table).where(_table.c.id == job.id).values(status="queued", worker=None))
    if orphans:
        logger.warning("Requeued %d jobs left by a previous process on this host", len(orphans))
    return len(orphans)


def _mark_paper_failed(kind: str, paper_id: str) -> None:
    if kind == "translate":
        store.update(paper_id, {"translation_status": "failed", "translation_error": "翻译多次中断，请重新翻译（已完成部分会保留）"})
    else:
        store.update(paper_id, {"status": "failed", "error_message": "处理多次中断，请点击重新分析"})


# ---------------- 任务处理 ----------------

Handler = Callable[[dict], Awaitable[None]]


async def _handle_parse(job: dict) -> None:
    from app.api.v1.papers import parse_paper_task
    from app.services import billing

    payload = job["payload"] or {}
    with open(payload["file_path"], "rb") as f:
        content = f.read()

    async def work() -> None:
        await parse_paper_task(job["paper_id"], payload["file_path"], content, payload["filename"], job["user_id"])

    # 主站计费的作业：claim → heartbeat → complete；其余直接执行
    await billing.run_billed(job["paper_id"], work)
    await _auto_translate(job["paper_id"], job["user_id"])


async def _auto_translate(paper_id: str, user_id: Optional[str]) -> None:
    """解析成功后按用户偏好自动全文翻译（关联模式默认开启，已含在每篇价格里；独立模式需用户显式开启）"""
    from app.config import get_settings
    from app.core.config_manager import ConfigManager
    from app.core.database import async_session_maker

    paper = store.get(paper_id) or {}
    if not user_id or paper.get("status") not in ("completed", "analyzed") or paper.get("translated_content"):
        return
    async with async_session_maker() as db:
        stored = await ConfigManager.get_user_config(db, user_id)
    default = get_settings().rid_mode == "linked"
    if stored.get("auto_translate", default) is True:
        submit("translate", paper_id, user_id)


async def _handle_analyze(job: dict) -> None:
    from app.api.v1.papers import run_analysis_pipeline

    await run_analysis_pipeline(job["paper_id"], job["user_id"])


async def _handle_translate(job: dict) -> None:
    from app.services.translation import _translate_paper_background

    await _translate_paper_background(job["paper_id"], job["user_id"])


HANDLERS: dict[str, Handler] = {
    "parse": _handle_parse,
    "analyze": _handle_analyze,
    "translate": _handle_translate,
}


async def run_job(job: dict) -> None:
    """执行一条已认领的任务，期间维持心跳。"""

    async def beat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await asyncio.to_thread(heartbeat, job["id"])

    beater = asyncio.create_task(beat())
    try:
        await HANDLERS[job["kind"]](job)
    except Exception as e:
        logger.exception("Job %s (%s) crashed", job["id"], job["kind"])
        await asyncio.to_thread(finish, job["id"], False, str(e))
        if job.get("paper_id"):
            await asyncio.to_thread(_mark_paper_failed, job["kind"], job["paper_id"])
    else:
        await asyncio.to_thread(finish, job["id"], True)
    finally:
        beater.cancel()


async def drain(kinds: Optional[list[str]] = None) -> int:
    """同步执行完所有排队任务（测试与命令行用）。返回执行条数。"""
    count = 0
    while True:
        job = claim("drain", kinds or list(HANDLERS))
        if job is None:
            return count
        await run_job(job)
        count += 1


class Worker:
    def __init__(self) -> None:
        self.name = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self.running: dict[str, int] = {k: 0 for k in KIND_CONCURRENCY}
        self._task: Optional[asyncio.Task] = None
        self._wake = asyncio.Event()

    def wake(self) -> None:
        self._wake.set()

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self, job: dict) -> None:
        try:
            await run_job(job)
        finally:
            self.running[job["kind"]] -= 1
            self.wake()

    async def _loop(self) -> None:
        try:
            await asyncio.to_thread(requeue_local_orphans, self.name)
        except Exception:
            logger.exception("Failed to requeue orphaned jobs")
        last_sweep = 0.0
        loop = asyncio.get_running_loop()
        while True:
            try:
                if loop.time() - last_sweep > 60:
                    await asyncio.to_thread(requeue_stale)
                    last_sweep = loop.time()
                while True:
                    free = [k for k, n in KIND_CONCURRENCY.items() if self.running[k] < n]
                    job = await asyncio.to_thread(claim, self.name, free)
                    if job is None:
                        break
                    self.running[job["kind"]] += 1
                    asyncio.create_task(self._run(job))
            except Exception:
                logger.exception("Job worker loop error")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass


worker: Optional[Worker] = None


def notify() -> None:
    """入队后唤醒本进程 worker（其他进程靠 5 秒轮询发现）。"""
    if worker is not None:
        worker.wake()


def submit(kind: str, paper_id: Optional[str], user_id: Optional[str], payload: Optional[dict] = None) -> str:
    job_id = enqueue(kind, paper_id, user_id, payload)
    notify()
    return job_id
