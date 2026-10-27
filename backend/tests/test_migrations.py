from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.core.database import Base, import_all_models
from app.core.migrations import upgrade_database

import_all_models()


def _diff(engine):
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": False})
        return compare_metadata(ctx, Base.metadata)


def test_fresh_database_matches_models(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    assert upgrade_database(engine) == "fresh"
    assert _diff(engine) == []
    assert upgrade_database(engine) == "upgrade"  # 再跑一次不报错


def test_reading_upgrade_preserves_existing_annotations(tmp_path):
    from alembic import command
    from app.core.migrations import _alembic_config

    engine = create_engine(f"sqlite:///{tmp_path / 'before-reading.db'}")
    with engine.begin() as conn:
        command.upgrade(_alembic_config(conn), "0003")
        conn.execute(text("INSERT INTO team_annotations (id,paper_id,user_id,type,visibility,selected_text) "
                          "VALUES ('old-note','old-paper','old-user','note','private','历史原文')"))
    assert upgrade_database(engine) == "upgrade"
    with engine.connect() as conn:
        row = conn.execute(text("SELECT selected_text,anchor,is_evidence FROM team_annotations WHERE id='old-note'" )).first()
        assert tuple(row) == ("历史原文", None, 0)
    assert _diff(engine) == []


def test_legacy_database_is_completed_and_stamped(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    # 模拟 R2 之前的库：create_all 建成，但缺新表、缺新列、缺新索引
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE workbench_items"))
        conn.execute(text("DROP TABLE data_migrations"))
        conn.execute(text("DROP INDEX uq_papers_user_source"))
        for col in ("extra", "extra_large", "source_provider", "source_id"):
            conn.execute(text(f"ALTER TABLE papers DROP COLUMN {col}"))
        conn.execute(text("ALTER TABLE users DROP COLUMN daily_ai_used"))
        conn.execute(text("INSERT INTO users (id, email, password_hash, role, is_active, plan, daily_papers_used, monthly_papers_used, invitation_count, created_at, updated_at) VALUES ('u1', 'a@x.org', 'h', 'user', 1, 'free', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
    assert upgrade_database(engine) == "legacy-stamp"
    insp = inspect(engine)
    assert {"workbench_items", "data_migrations", "alembic_version"} <= set(insp.get_table_names())
    assert {"extra", "source_id"} <= {c["name"] for c in insp.get_columns("papers")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email FROM users")).scalar() == "a@x.org"  # 数据保留
    missing = [d for d in _diff(engine) if d[0] in ("add_table", "add_column", "add_index")]
    assert missing == []
    assert upgrade_database(engine) == "upgrade"


def test_fresh_postgres_matches_models():
    import os

    import pytest
    from sqlalchemy.engine import make_url

    base = os.environ.get("RID_TEST_DATABASE_URL", "")
    if not base.startswith("postgresql"):
        pytest.skip("需要 RID_TEST_DATABASE_URL=postgresql://...")
    url = make_url(base).set(drivername="postgresql+psycopg")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text("DROP DATABASE IF EXISTS rid_migration_check"))
        conn.execute(text("CREATE DATABASE rid_migration_check"))
    engine = create_engine(url.set(database="rid_migration_check"))
    try:
        assert upgrade_database(engine) == "fresh"
        assert _diff(engine) == []
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text("DROP DATABASE IF EXISTS rid_migration_check"))
        admin.dispose()
