import asyncio
import os
import subprocess
import sys
import textwrap
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.core import jobs
from app.core.data_import import recover_stuck
from app.core.store import store
from app.models.job import Job


def paper(user_id, **fields):
    pid = str(uuid.uuid4())
    store.set(pid, {"id": pid, "filename": "a.pdf", "status": "parsing", "user_id": user_id, **fields})
    return pid


async def test_enqueue_dedupes_active_jobs(users):
    pid = paper(users["alice"]["id"])
    a = jobs.enqueue("parse", pid, users["alice"]["id"], {"f": 1})
    assert jobs.enqueue("parse", pid, users["alice"]["id"]) == a
    assert jobs.enqueue("translate", pid, users["alice"]["id"]) != a
    job = jobs.claim("w1", ["parse"])
    assert job["id"] == a and job["status"] == "running" and job["attempts"] == 1
    assert jobs.claim("w2", ["parse"]) is None
    jobs.finish(a, True)
    assert jobs.get(a)["status"] == "done"
    assert jobs.enqueue("parse", pid, None) != a  # 已完成的不再去重


async def test_two_processes_never_claim_the_same_job(users):
    ids = {jobs.enqueue("analyze", paper(users["alice"]["id"]), None) for _ in range(20)}
    backend = str(__import__("pathlib").Path(__file__).resolve().parent.parent)
    script = textwrap.dedent(f"""
        import sys; sys.path.insert(0, {backend!r})
        from app.core import jobs
        while True:
            j = jobs.claim(sys.argv[1], ["analyze"])
            if j is None: break
            print(j["id"], flush=True)
    """)
    procs = [subprocess.Popen([sys.executable, "-c", script, f"w{i}"], env=dict(os.environ), stdout=subprocess.PIPE, text=True) for i in range(2)]
    claimed = []
    for p in procs:
        out, _ = p.communicate(timeout=120)
        claimed += [w for w in out.split() if len(w) == 36 and w.count("-") == 4]  # 忽略启动日志
    assert sorted(claimed) == sorted(ids)  # 每条恰好被认领一次


async def test_requeue_stale_then_give_up(users):
    pid = paper(users["alice"]["id"])
    jid = jobs.enqueue("parse", pid, None)
    later = datetime.now(timezone.utc) + timedelta(minutes=10)
    for attempt in range(1, jobs.MAX_ATTEMPTS + 1):
        job = jobs.claim("w", ["parse"])
        assert job["attempts"] == attempt
        assert jobs.requeue_stale(now=datetime.now(timezone.utc)) == {"requeued": 0, "failed": 0}  # 心跳新鲜
        result = jobs.requeue_stale(now=later)
        if attempt < jobs.MAX_ATTEMPTS:
            assert result == {"requeued": 1, "failed": 0} and jobs.get(jid)["status"] == "queued"
    assert result == {"requeued": 0, "failed": 1}
    assert jobs.get(jid)["status"] == "failed"
    assert store.get(pid)["status"] == "failed" and "中断" in store.get(pid)["error_message"]


async def test_crashing_handler_marks_job_and_paper_failed(users, monkeypatch):
    pid = paper(users["alice"]["id"], status="completed", translation_status="translating")

    async def boom(job):
        raise RuntimeError("kaput")

    monkeypatch.setitem(jobs.HANDLERS, "translate", boom)
    jid = jobs.enqueue("translate", pid, None)
    assert await jobs.drain() == 1
    assert jobs.get(jid)["status"] == "failed" and jobs.get(jid)["error"] == "kaput"
    assert store.get(pid)["translation_status"] == "failed"


async def test_worker_runs_submitted_jobs_with_kind_limits(users, monkeypatch):
    running, peak, done = [0], [0], []

    async def slow(job):
        running[0] += 1
        peak[0] = max(peak[0], running[0])
        await asyncio.sleep(0.1)
        running[0] -= 1
        done.append(job["paper_id"])

    monkeypatch.setitem(jobs.HANDLERS, "translate", slow)
    worker = jobs.Worker()
    jobs.worker = worker
    worker.start()
    try:
        pids = [paper(users["alice"]["id"]) for _ in range(3)]
        for pid in pids:
            jobs.submit("translate", pid, None)
        for _ in range(100):
            if len(done) == 3:
                break
            await asyncio.sleep(0.05)
    finally:
        await worker.stop()
        jobs.worker = None
    assert sorted(done) == sorted(pids)
    assert peak[0] == jobs.KIND_CONCURRENCY["translate"] == 1


async def test_upload_reanalyze_translate_enqueue(client, users):
    h = users["alice"]["headers"]
    pid = (await client.post("/api/v1/papers/upload", files={"file": ("a.pdf", b"%PDF", "application/pdf")}, headers=h)).json()["id"]
    store.update(pid, {"status": "completed", "markdown_content": "# x\n\nbody"})
    assert (await client.post(f"/api/v1/papers/{pid}/analyze", headers=h)).json()["status"] == "triggered"
    assert (await client.post(f"/api/v1/papers/{pid}/translate", headers=h)).json()["status"] == "translating"
    with store.engine.connect() as conn:
        kinds = sorted(r.kind for r in conn.execute(Job.__table__.select().where(Job.paper_id == pid)))
    assert kinds == ["analyze", "parse", "translate"]
    assert store.get(pid)["translation_status"] == "translating"


async def test_recover_stuck_leaves_queued_papers_to_the_queue(users):
    queued = paper(users["alice"]["id"])
    orphan = paper(users["alice"]["id"])
    jobs.enqueue("parse", queued, None)
    later = datetime.now(timezone.utc) + timedelta(hours=2)
    assert recover_stuck(now=later)["failed"] == 1
    assert store.get(queued)["status"] == "parsing" and store.get(orphan)["status"] == "failed"


async def test_local_orphans_requeued_on_startup(users):
    import socket

    host = socket.gethostname()
    pids = [paper(users["alice"]["id"]) for _ in range(4)]
    ids = [jobs.enqueue("parse", pid, None) for pid in pids]
    owners = [
        f"{host}:999999:dead0000",            # 本机、进程已不存在 → 接管
        f"{host}:{os.getpid()}:oldboot0",     # 本机、pid 复用但启动串不同（容器重启）→ 接管
        f"{host}:{os.getpid()}:meboot00",     # 就是本进程 → 不动
        "other-host:1:abcd0000",              # 别的主机 → 交给心跳超时
    ]
    with store.engine.begin() as conn:
        for jid, w in zip(ids, owners):
            conn.execute(update(Job.__table__).where(Job.id == jid).values(status="running", worker=w))
    assert jobs.requeue_local_orphans(f"{host}:{os.getpid()}:meboot00") == 2
    assert [jobs.get(j)["status"] for j in ids] == ["queued", "queued", "running", "running"]
