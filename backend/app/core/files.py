"""
Read it DEEP - 解析产物文件的签名访问

论文图片原先挂在无鉴权的 `/uploads` 静态目录下。`<img>` 标签无法携带
Authorization 头，所以改为：返回 Markdown 时把图片链接改写成带过期时间与
HMAC 签名的 `/api/v1/files/images/...` 地址。签名只在服务端能生成，返回正文
的路由本身已做过访问校验，因此拿到签名链接 = 曾经有权看到这篇论文。
"""

import hashlib
import hmac
import re
import time
from pathlib import Path

from app.config import get_settings

# 存量 Markdown 中的链接形如 /uploads/images/<paper_id>/<file>
_IMAGE_LINK = re.compile(r"/uploads/images/([A-Za-z0-9_-]+)/([^)\s\"'?#]+)")
# 签名有效期至少 24 小时；按整点取过期时间，同一小时内 URL 稳定，便于浏览器缓存
_TTL_HOURS = 25


def images_root() -> Path:
    # 与解析任务写图片时的路径解析方式一致（相对路径以工作目录为基准）
    return Path(get_settings().storage_path) / "images"


def _signature(paper_id: str, name: str, exp: int) -> str:
    key = get_settings().secret_key.encode()
    msg = f"images/{paper_id}/{name}:{exp}".encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()[:32]


def signed_image_url(paper_id: str, name: str, now: float | None = None) -> str:
    now = time.time() if now is None else now
    exp = (int(now) // 3600 + _TTL_HOURS) * 3600
    return f"/api/v1/files/images/{paper_id}/{name}?exp={exp}&sig={_signature(paper_id, name, exp)}"


def verify_image_signature(paper_id: str, name: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    return hmac.compare_digest(_signature(paper_id, name, exp), sig)


def sign_markdown_images(markdown: str | None) -> str | None:
    if not markdown:
        return markdown
    return _IMAGE_LINK.sub(lambda m: signed_image_url(m.group(1), m.group(2)), markdown)
