"""Alembic 环境：元数据来自应用模型，连接串来自应用配置。"""

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.database import Base, import_all_models, sync_database_url

import_all_models()
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=sync_database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = context.config.attributes.get("connection")
    if connectable is not None:
        _run(connectable)
        return
    engine = create_engine(sync_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run(connection)


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
