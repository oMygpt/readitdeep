"""
Read it DEEP - 签名文件访问

GET /api/v1/files/images/{paper_id}/{name}?exp=&sig=
签名由返回论文正文的路由生成（见 app.core.files），本路由只验签不查登录态。
"""

import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.files import images_root, verify_image_signature

router = APIRouter()


@router.get("/images/{paper_id}/{name}")
async def get_image(paper_id: str, name: str, exp: int = Query(...), sig: str = Query(...)):
    if name != os.path.basename(name) or name in (".", "..") or "/" in paper_id or ".." in paper_id:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not verify_image_signature(paper_id, name, exp, sig):
        raise HTTPException(status_code=403, detail="链接无效或已过期")
    path = images_root() / paper_id / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
