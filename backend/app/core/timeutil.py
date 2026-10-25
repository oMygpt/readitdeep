"""
时间工具：库里的时间一律按 UTC 解释。

SQLite 读回的 DateTime 不带时区，PostgreSQL（timestamptz）读回的带时区；
代码里又大量使用 datetime.utcnow()（不带时区）。两者直接比较在 PostgreSQL
上会抛 TypeError。比较前统一用 as_utc() 归一。
"""

from datetime import datetime, timezone
from typing import Optional


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
