"""Owner-delegated research API. No cookie, service key, redirects or URL fallback."""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request

from app.api.v1.auth import decode_token
from app.models.user import User
from app.services.paperdaily import client, sessions

SCOPES = "read:paper read:resources read:reading write:reading"
MAX_BYTES = 32 * 1024 * 1024
CHUNK = 1024 * 1024


async def delegation(request: Request, user: User, required: str | None) -> str:
    if not sessions.is_linked():
        raise HTTPException(409, "此部署未关联 PaperDaily，个人阅读仍可使用")
    header = request.headers.get("authorization", "")
    token = header.partition(" ")[2]
    payload = decode_token(token)
    session = await sessions.verify(payload.get("sid"), user.id, sensitive=True)
    if required and required not in (session.scope or "").split():
        raise HTTPException(403, {"code": "paperdaily_scope_required", "scope": required})
    return sessions._token_of(session)


async def call(
    token: str, method: str, path: str, *, params: dict | None = None, body: dict | None = None
) -> Any:
    try:
        async with client.http_client() as http:
            response = await http.request(
                method,
                client._url(path),
                params=params,
                json=body,
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=False,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(503, {"code": "paperdaily_unavailable"}) from exc
    if response.status_code >= 300:
        code = (
            "paperdaily_unavailable" if response.status_code >= 500 else "paperdaily_request_denied"
        )
        raise HTTPException(
            response.status_code if response.status_code in (401, 403, 404, 409, 422, 429) else 503,
            {"code": code, "upstream_status": response.status_code},
        )
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(502, "PaperDaily 响应格式无效") from exc


def paper_path(paper_id: str) -> str:
    return "/api/v1/papers/" + quote(paper_id, safe="")


async def resource_bytes(token: str, paper_id: str, manifest: dict) -> bytes:
    resource_id = manifest.get("resource_id", "")
    size, digest = manifest.get("byte_length"), manifest.get("content_sha256", "")
    if (
        not re.fullmatch(r"rr_[0-9a-f]{32}", resource_id)
        or type(size) is not int
        or not 0 < size <= MAX_BYTES
        or not re.fullmatch(r"[0-9a-f]{64}", digest)
        or manifest.get("paper_id") != paper_id
        or manifest.get("transfer_policy") != "first_party_read"
        or not manifest.get("policy_version")
        or str(manifest.get("license", "")).lower() in ("", "unknown", "none", "unverified")
    ):
        raise HTTPException(502, "全文资源清单无效")
    data = bytearray()
    async with client.http_client() as http:
        for start in range(0, size, CHUNK):
            end = min(start + CHUNK, size) - 1
            try:
                async with http.stream(
                    "GET",
                    client._url(paper_path(paper_id) + f"/resources/{resource_id}/content"),
                    headers={"Authorization": f"Bearer {token}", "Range": f"bytes={start}-{end}"},
                    follow_redirects=False,
                ) as response:
                    if response.status_code != 206:
                        raise HTTPException(
                            response.status_code
                            if response.status_code in (401, 403, 429, 503)
                            else 502,
                            {"code": "resource_transfer_interrupted"},
                        )
                    if (
                        response.headers.get("content-range") != f"bytes {start}-{end}/{size}"
                        or response.headers.get("x-content-sha256") != digest
                    ):
                        raise HTTPException(502, "全文分段身份不一致")
                    segment = bytearray()
                    async for chunk in response.aiter_bytes():
                        segment.extend(chunk)
                        if len(segment) > end - start + 1:
                            raise HTTPException(502, "全文分段长度异常")
                    if len(segment) != end - start + 1:
                        raise HTTPException(502, "全文分段不完整")
                    data.extend(segment)
            except httpx.HTTPError as exc:
                raise HTTPException(503, {"code": "resource_transfer_interrupted"}) from exc
    if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
        raise HTTPException(502, "全文完整性校验失败")
    return bytes(data)
