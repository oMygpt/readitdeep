"""
Read it DEEP - 模型调用统一入口

get_chat_model(task, user_id) 是创建对话模型的唯一入口：
- 配置一律走 ConfigManager（用户 > 系统 > 环境变量），user_id 是**触发者**；
- task: "chat"（主模型）、"translate"（translation_*，未配置地址时回落主模型）、
  "smart:<action>"（smart_analysis_mode=custom 时用 smart_<action>_*）；
- *_base_url 可以填多个地址（逗号或空白分隔，同一模型、同一路径前缀），由
  PoolTransport 在 httpx 传输层做轮询与故障转移，对调用方透明；
- 按端点组分「交互」与「批量」两个并发通道，翻译等长任务不挤占划词分析。
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
import time
from typing import Iterable, Optional

import httpx
from langchain_openai import ChatOpenAI

from app.core.token_tracker import TokenTrackingCallback

logger = logging.getLogger(__name__)

INTERACTIVE = "interactive"
BATCH = "batch"
COOLDOWN_SECONDS = 30.0


class LLMNotConfigured(RuntimeError):
    pass


def split_endpoints(value: Optional[str]) -> list[str]:
    return [b.rstrip("/") for b in re.split(r"[,\s]+", value or "") if b.strip()]


def resolve_model_config(config: dict, task: str) -> tuple[list[str], str, str]:
    """按任务从生效配置中取 (端点列表, api_key, model)。专用配置只在填了地址时才使用它自己的 Key，
    避免把主模型的 Key 发到另一个服务。"""
    main = (split_endpoints(config.get("llm_base_url")), config.get("llm_api_key") or "", config.get("llm_model") or "")
    prefix = None
    if task == "translate":
        prefix = "translation_"
    elif task.startswith("smart:") and config.get("smart_analysis_mode") == "custom":
        prefix = f"smart_{task.split(':', 1)[1]}_"
    if prefix:
        bases = split_endpoints(config.get(f"{prefix}base_url"))
        model = config.get(f"{prefix}model") or main[2]
        if bases:
            return bases, config.get(f"{prefix}api_key") or "", model
        return main[0], config.get(f"{prefix}api_key") or main[1], model
    return main


def parse_extra_body(value) -> Optional[dict]:
    """llm_extra_body 可以是 dict（系统配置）或 JSON 字符串（环境变量）；无效值忽略并告警。"""
    if not value:
        return None
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
    except ValueError:
        logger.warning("LLM_EXTRA_BODY is not valid JSON; ignored")
        return None
    return parsed if isinstance(parsed, dict) else None


def default_channel(task: str) -> str:
    return INTERACTIVE if task.startswith("smart:") or task == "assist" else BATCH


def _limits() -> dict[str, int]:
    from app.config import get_settings

    settings = get_settings()
    return {
        INTERACTIVE: max(1, settings.llm_concurrency_interactive),
        BATCH: max(1, settings.llm_concurrency_batch),
    }


class EndpointPool:
    """一组等价端点：轮询、失败冷却、按通道限并发。同一组端点在进程内共享一个实例。"""

    def __init__(self, bases: list[str], limits: Optional[dict[str, int]] = None) -> None:
        self.bases = bases
        self._rr = itertools.count()
        self._down_until = {b: 0.0 for b in bases}
        self.semaphores = {ch: asyncio.Semaphore(n) for ch, n in (limits or _limits()).items()}

    def candidates(self, now: Optional[float] = None) -> list[str]:
        now = time.monotonic() if now is None else now
        start = next(self._rr) % len(self.bases)
        ordered = self.bases[start:] + self.bases[:start]
        healthy = [b for b in ordered if self._down_until[b] <= now]
        return healthy or ordered  # 全部冷却中时仍按顺序尝试

    def mark_down(self, base: str) -> None:
        self._down_until[base] = time.monotonic() + COOLDOWN_SECONDS
        logger.warning("LLM endpoint %s failed; cooling down %ss", base, COOLDOWN_SECONDS)


class _ReleasingStream(httpx.AsyncByteStream):
    """响应体读完或关闭时释放并发名额（流式响应要等流结束）。"""

    def __init__(self, inner: httpx.AsyncByteStream, release) -> None:
        self._inner = inner
        self._release = release

    async def __aiter__(self):
        async for chunk in self._inner:
            yield chunk

    async def aclose(self) -> None:
        try:
            await self._inner.aclose()
        finally:
            self._release()


class PoolTransport(httpx.AsyncBaseTransport):
    def __init__(self, pool: EndpointPool, channel: str, inner: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.pool = pool
        self.channel = channel
        self.inner = inner or httpx.AsyncHTTPTransport()

    def _rewrite(self, request: httpx.Request, base: str, body: bytes) -> httpx.Request:
        url = str(request.url)
        origin = next((b for b in self.pool.bases if url.startswith(b)), self.pool.bases[0])
        headers = [(k, v) for k, v in request.headers.multi_items() if k.lower() not in ("host", "content-length")]
        return httpx.Request(request.method, base + url[len(origin):], headers=headers, content=body, extensions=request.extensions)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        semaphore = self.pool.semaphores[self.channel]
        await semaphore.acquire()
        released = False

        def release() -> None:
            nonlocal released
            if not released:
                released = True
                semaphore.release()

        try:
            body = await request.aread()
            candidates = self.pool.candidates()
            last_error: Optional[Exception] = None
            for i, base in enumerate(candidates):
                is_last = i == len(candidates) - 1
                try:
                    response = await self.inner.handle_async_request(self._rewrite(request, base, body))
                except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                    self.pool.mark_down(base)
                    last_error = e
                    continue
                if response.status_code >= 500 and not is_last:
                    await response.aclose()
                    self.pool.mark_down(base)
                    continue
                if response.is_closed:
                    release()  # 响应体已完整读出（如内存中构造的响应），不会再有 aclose 回调
                else:
                    response.stream = _ReleasingStream(response.stream, release)
                return response
            raise last_error or httpx.ConnectError("no LLM endpoint available")
        except BaseException:
            release()
            raise

    async def aclose(self) -> None:
        await self.inner.aclose()


_pools: dict[tuple[str, ...], EndpointPool] = {}
_clients: dict[tuple[tuple[str, ...], str, int], httpx.AsyncClient] = {}


def get_pool(bases: Iterable[str]) -> EndpointPool:
    key = tuple(bases)
    if key not in _pools:
        _pools[key] = EndpointPool(list(key))
    return _pools[key]


def _client(bases: list[str], channel: str, timeout: int) -> httpx.AsyncClient:
    key = (tuple(bases), channel, timeout)
    if key not in _clients:
        _clients[key] = httpx.AsyncClient(transport=PoolTransport(get_pool(bases), channel), timeout=timeout)
    return _clients[key]


async def get_chat_model(
    task: str = "chat",
    user_id: Optional[str] = None,
    *,
    streaming: bool = False,
    temperature: float = 0.3,
    timeout: int = 90,
    channel: Optional[str] = None,
    usage_label: Optional[str] = None,
) -> ChatOpenAI:
    from app.core.config_manager import ConfigManager
    from app.core.database import async_session_maker

    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, user_id)
    bases, api_key, model = resolve_model_config(config, task)
    if not bases or not model:
        raise LLMNotConfigured("模型服务未配置：请管理员在后台或环境变量中设置 LLM_BASE_URL 与 LLM_MODEL")
    return ChatOpenAI(
        extra_body=parse_extra_body(config.get("llm_extra_body")),
        base_url=bases[0],
        api_key=api_key or "EMPTY",  # 校内 vLLM 通常不需要 Key
        model=model,
        temperature=temperature,
        streaming=streaming,
        timeout=timeout,
        http_async_client=_client(bases, channel or default_channel(task), timeout),
        stream_usage=True,  # 流式调用也返回用量
        callbacks=[TokenTrackingCallback(usage_label or task.replace(":", "_"))],
    )
