"""
Read it DEEP - PaperDaily 关联模式的会话与事件（docs/plans/paperdaily-connect-contract.md）
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ConnectState(Base):
    """授权跳转中的 state 与 PKCE verifier（10 分钟有效，用后即删）"""

    __tablename__ = "connect_states"

    state: Mapped[str] = mapped_column(String(100), primary_key=True)
    browser_nonce: Mapped[str] = mapped_column(String(100))  # 与浏览器 cookie 绑定，防登录 CSRF
    code_verifier: Mapped[str] = mapped_column(String(200))
    return_to: Mapped[str] = mapped_column(String(1000), default="/")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProviderSession(Base):
    """一次 PaperDaily 授权对应的本地会话；委托 key 只以 AES-GCM 密文保存"""

    __tablename__ = "provider_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(50), default="paperdaily")
    grant_id: Mapped[str] = mapped_column(String(100), index=True)
    key_id: Mapped[Optional[str]] = mapped_column(String(100))  # 主站委托 key 的标识（read-jobs 签名用）
    auth_version: Mapped[int] = mapped_column(Integer, default=0)
    key_version: Mapped[str] = mapped_column(String(20))
    key_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    scope: Mapped[Optional[str]] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProviderEvent(Base):
    """主站推送/对账拉取到的事件（先落库再 ack；event_id 去重）"""

    __tablename__ = "provider_events"

    event_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    type: Mapped[str] = mapped_column(String(50))
    cursor: Mapped[Optional[int]] = mapped_column(BigInteger, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class AccountTombstone(Base):
    """主站删号后留下的标记：拦截该外部身份迟到的登录、导入与写回"""

    __tablename__ = "account_tombstones"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    subject: Mapped[str] = mapped_column(String(100), primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
