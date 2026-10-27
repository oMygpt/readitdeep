"""
Read it DEEP - 配置分层（设计 2026-10-27 v0.2 §5）

linked（PaperDaily 系列站）模式：
- 部署层：模型地址、Key、嵌入模型等只来自环境变量（保险库渲染），数据库里的同名值一律忽略，写接口拒绝；
- 站点运营层：管理员只能从 ALLOWED_MODELS 里为各任务选模型、调整非密钥开关；
- 用户层：只有偏好（目标语言、译文风格、术语表、解析质量、自动翻译）。

standalone（开源独立部署）保持原有「管理员共享 + 用户自定义」行为，只额外多出用户偏好。
"""

from __future__ import annotations

from typing import Any

from app.config import get_settings

# 只能由部署层决定的键：地址、Key，以及会让已有数据失效的嵌入配置
DEPLOYMENT_ONLY_SUFFIXES = ("_api_key", "_url")
DEPLOYMENT_ONLY_KEYS = {
    "llm_mode",
    "translation_mode",
    "mineru_mode",
    "embedding_provider",
    "embedding_model",
    "llm_extra_body",
}

MAX_GLOSSARY = 200
USER_PREFERENCES: dict[str, Any] = {
    "translate_target_lang": "zh",
    "translate_style": "fluent",
    "glossary": [],
    "parse_quality": "vlm",
    "auto_translate": True,
}
TARGET_LANGS = {"zh": "中文", "en": "English", "ja": "日本語", "ko": "한국어", "fr": "Français", "de": "Deutsch", "es": "Español"}
STYLES = {"literal", "fluent"}
QUALITIES = {"vlm", "fast"}


def is_linked() -> bool:
    return get_settings().rid_mode == "linked"


def is_deployment_only(key: str) -> bool:
    return key.endswith(DEPLOYMENT_ONLY_SUFFIXES) or key in DEPLOYMENT_ONLY_KEYS


def allowed_models() -> set[str]:
    return {m.strip() for m in get_settings().allowed_models.split(",") if m.strip()}


def system_value_allowed(key: str, value: Any) -> bool:
    """数据库里的系统配置在当前模式下是否生效"""
    if not is_linked():
        return True
    if is_deployment_only(key):
        return False
    if key.endswith("_model") and value:
        return str(value) in allowed_models()
    return True


def user_value_allowed(key: str) -> bool:
    """数据库里的用户配置在当前模式下是否生效（偏好键在两种模式下都生效）"""
    return key in USER_PREFERENCES or not is_linked()


def check_admin_updates(updates: dict) -> None:
    """管理员写系统配置前校验；不合格抛 ValueError（消息给管理员看）"""
    if not is_linked():
        return
    blocked = sorted(k for k in updates if is_deployment_only(k))
    if blocked:
        raise ValueError(f"以下配置由部署层（保险库）管理，网页不能修改：{', '.join(blocked)}")
    allowed = allowed_models()
    bad = sorted(k for k, v in updates.items() if k.endswith("_model") and v and str(v) not in allowed)
    if bad:
        raise ValueError(f"模型必须从部署允许的列表中选择（{', '.join(sorted(allowed)) or '未配置 ALLOWED_MODELS'}）：{', '.join(bad)}")


def clean_preferences(updates: dict) -> dict:
    """校验并规范用户偏好；未知键或非法值抛 ValueError"""
    unknown = sorted(set(updates) - set(USER_PREFERENCES))
    if unknown:
        raise ValueError(f"不支持的偏好：{', '.join(unknown)}")
    out: dict[str, Any] = {}
    for key, value in updates.items():
        if key == "translate_target_lang":
            if value not in TARGET_LANGS:
                raise ValueError("不支持的目标语言")
        elif key == "translate_style":
            if value not in STYLES:
                raise ValueError("译文风格只能是 literal 或 fluent")
        elif key == "parse_quality":
            if value not in QUALITIES:
                raise ValueError("解析质量只能是 vlm 或 fast")
        elif key == "auto_translate":
            if not isinstance(value, bool):
                raise ValueError("auto_translate 必须是布尔值")
        elif key == "glossary":
            value = _clean_glossary(value)
        out[key] = value
    return out


def _clean_glossary(value: Any) -> list[dict]:
    if not isinstance(value, list) or len(value) > MAX_GLOSSARY:
        raise ValueError(f"术语表最多 {MAX_GLOSSARY} 条")
    items = []
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError("术语表每条须为 {source, target}")
        source = str(entry.get("source") or "").strip()
        target = str(entry.get("target") or "").strip()
        if not source or not target or len(source) > 100 or len(target) > 100:
            raise ValueError("术语表每条的原文和译文都必须填写，且不超过 100 字")
        items.append({"source": source, "target": target})
    return items


def preferences_of(config: dict) -> dict:
    """从生效配置里取用户偏好，缺省补默认值"""
    return {k: config.get(k, default) for k, default in USER_PREFERENCES.items()}
