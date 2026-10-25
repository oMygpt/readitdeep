"""
Read it DEEP - 数据库升级

启动时调用 upgrade_database()：
- 空库：alembic upgrade head；
- 已有 Alembic 版本记录：alembic upgrade head；
- R2 之前的旧库（由 create_all + 手工补列脚本建成，没有版本记录）：先补齐缺失的表、
  列和索引，再 stamp head。这一步取代了原来的 scripts/migrate_db.py、
  add_quota_fields.py、add_prompt_tables.py。
"""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.schema import CreateIndex

from app.core.database import Base, import_all_models

logger = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"


def _alembic_config(connection: Connection) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    cfg.attributes["connection"] = connection
    return cfg


def ensure_legacy_schema(connection: Connection) -> list[str]:
    """把旧库补齐到当前模型：缺表建表、缺列加列（一律可空）、缺索引建索引。返回所做改动。"""
    import_all_models()
    changes: list[str] = []
    insp = inspect(connection)
    existing_tables = set(insp.get_table_names())
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            table.create(connection)
            changes.append(f"create table {table.name}")
            continue
        columns = {c["name"] for c in insp.get_columns(table.name)}
        for column in table.columns:
            if column.name in columns:
                continue
            ddl_type = column.type.compile(dialect=connection.dialect)
            connection.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {ddl_type}'))
            changes.append(f"add column {table.name}.{column.name}")
        index_names = {i["name"] for i in insp.get_indexes(table.name)}
        for index in table.indexes:
            if index.name not in index_names:
                connection.execute(CreateIndex(index))
                changes.append(f"create index {index.name}")
    return changes


def upgrade_database(engine) -> str:
    """把数据库升级到最新结构。返回执行的路径（fresh / upgrade / legacy-stamp）。"""
    import_all_models()
    with engine.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        cfg = _alembic_config(connection)
        if "alembic_version" not in tables and tables & set(Base.metadata.tables):
            changes = ensure_legacy_schema(connection)
            command.stamp(cfg, "head")
            logger.info("Legacy database brought up to date and stamped: %s", changes or "no changes")
            return "legacy-stamp"
        command.upgrade(cfg, "head")
        return "fresh" if not tables else "upgrade"
