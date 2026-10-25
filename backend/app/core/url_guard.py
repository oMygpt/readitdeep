"""
Read it DEEP - 出站地址校验

普通用户可以填写的服务地址（LLM / MinerU 等）最终由服务器发起请求。
托管部署时这等于让任意用户借服务器访问内网，所以：
- 默认不允许用户自定义服务地址（ALLOW_USER_ENDPOINTS=false），只能用管理员配置的；
- 允许时，也只接受 http(s) 且解析结果不落在内网/回环/链路本地等保留地址段的地址。
"""

import ipaddress
import socket
from urllib.parse import urlparse

URL_CONFIG_SUFFIXES = ("_url",)


def is_url_config_key(key: str) -> bool:
    return key.endswith(URL_CONFIG_SUFFIXES)


def validate_public_url(url: str) -> None:
    """不合格时抛 ValueError（消息可直接给用户看）。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("服务地址必须是 http(s) URL")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as e:
        raise ValueError(f"无法解析服务地址: {parsed.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ValueError("不允许使用内网或保留地址作为服务地址")
