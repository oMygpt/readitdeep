"""
委托 key 的加密存储：AES-256-GCM，随机 12 字节 nonce，关联数据绑定 user/client/grant/session，
密文可解出但无法挪给别的会话使用。PAPERDAILY_TOKEN_KEYS="v2:<base64>,v1:<base64>"，
第一把用于加密，其余只用于解密（轮换期间旧会话仍可用）。
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings


class TokenKeyError(RuntimeError):
    pass


def _keys() -> list[tuple[str, bytes]]:
    raw = get_settings().paperdaily_token_keys
    keys = []
    for part in (p.strip() for p in raw.split(",") if p.strip()):
        version, _, b64 = part.partition(":")
        key = base64.b64decode(b64)
        if len(key) != 32:
            raise TokenKeyError(f"PAPERDAILY_TOKEN_KEYS 中 {version} 不是 32 字节")
        keys.append((version, key))
    if not keys:
        raise TokenKeyError("PAPERDAILY_TOKEN_KEYS 未配置")
    return keys


def associated_data(user_id: str, client_id: str, grant_id: str, session_id: str) -> bytes:
    return f"{user_id}|{client_id}|{grant_id}|{session_id}".encode()


def encrypt(token: str, aad: bytes) -> tuple[str, bytes, bytes]:
    version, key = _keys()[0]
    nonce = os.urandom(12)
    return version, nonce, AESGCM(key).encrypt(nonce, token.encode(), aad)


def decrypt(version: str, nonce: bytes, ciphertext: bytes, aad: bytes) -> str:
    for v, key in _keys():
        if v == version:
            return AESGCM(key).decrypt(nonce, ciphertext, aad).decode()
    raise TokenKeyError(f"找不到密钥版本 {version}（可能已轮换移除）")
