"""每条路由都必须带鉴权依赖，除非在下面的公开清单里写明理由。

新增路由忘了鉴权 → 这个测试失败。真要公开，就把它加进 PUBLIC 并写清为什么。
"""

from fastapi.routing import APIRoute

from app.main import app

AUTH_DEPENDENCIES = {
    "get_current_user",
    "get_current_admin",
    "require_paper_access",
    "require_paper_owner",
    "require_ai_quota",
}

PUBLIC = {
    ("GET", "/health"): "健康检查",
    ("POST", "/api/v1/auth/register"): "注册",
    ("POST", "/api/v1/auth/login"): "登录",
    ("POST", "/api/v1/auth/refresh"): "用 refresh token 换 access token，路由内校验",
    ("GET", "/api/v1/quota/plans"): "公开的套餐说明，不含用户数据",
    ("GET", "/api/v1/share/paper/{share_token}"): "分享链接，路由内校验 token",
    ("GET", "/api/v1/share/paper/{share_token}/content"): "分享链接，路由内校验 token",
    ("GET", "/api/v1/share/paper/{share_token}/analysis"): "分享链接，路由内校验 token",
    ("GET", "/api/v1/files/images/{paper_id}/{name}"): "签名链接，路由内验签",
}


def _dependency_names(dependant, acc):
    for sub in dependant.dependencies:
        acc.add(getattr(sub.call, "__name__", ""))
        _dependency_names(sub, acc)
    return acc


def test_every_route_is_authenticated_or_explicitly_public():
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        deps = _dependency_names(route.dependant, set())
        for method in route.methods:
            if (method, route.path) in PUBLIC:
                continue
            if not deps & AUTH_DEPENDENCIES:
                missing.append(f"{method} {route.path}")
    assert not missing, "无鉴权路由:\n" + "\n".join(sorted(missing))


def test_public_list_has_no_stale_entries():
    existing = {(m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert set(PUBLIC) <= existing
