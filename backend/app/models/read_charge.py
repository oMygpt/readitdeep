"""
Read it DEEP - 按篇计费记录（设计 2026-10-27 v0.2 §4）

每个用户每个 PDF 内容（SHA-256）一行：既是「篇数」计数，也是与主站 read-job 对账的凭据。
失败/取消的行不占篇数；同一用户再次处理同一内容时复用这一行，不重复扣费。
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# 占用篇数、且不允许再次扣费的状态
COUNTED = ("held", "running", "settled", "free", "unknown")


class ReadCharge(Base):
    __tablename__ = "read_charges"
    __table_args__ = (UniqueConstraint("user_id", "content_sha256", name="uq_read_charges_user_content"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content_sha256: Mapped[str] = mapped_column(String(64))
    paper_id: Mapped[Optional[str]] = mapped_column(String(36))  # 论文删了也保留账务记录
    period_key: Mapped[str] = mapped_column(String(10), index=True)  # 2026-10 或 lifetime
    # held（主站已预扣）→ running（已 claim）→ settled | failed | cancelled | unknown；free=不经主站计费
    status: Mapped[str] = mapped_column(String(20), index=True)
    funding: Mapped[str] = mapped_column(String(20))  # paperdaily | off | standalone
    price: Mapped[int] = mapped_column(Integer, default=0)
    price_version: Mapped[Optional[str]] = mapped_column(String(100))
    pages: Mapped[int] = mapped_column(Integer, default=0)
    pd_job_id: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    pd_fence: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(String(500))
    # 已执行完但还没送达主站的 complete 请求体（主站不可达时由对账循环补交）
    completion: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
