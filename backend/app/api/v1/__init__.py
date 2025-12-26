"""
Read it DEEP - API v1 路由
"""

from fastapi import APIRouter

from app.api.v1 import papers, library, monitor, analysis, graph, classification, translate, workbench, auth, admin, quota, prompts, authors, teams, annotations, tasks, ai_assist, share, citation

router = APIRouter()

# Share (访客分享 - 公开端点优先)
router.include_router(share.router, prefix="/share", tags=["Share"])

# AI Assistant (AI 讨论助手)
router.include_router(ai_assist.router, tags=["AI"])

# Authors (作者论文)
router.include_router(authors.router, prefix="/papers", tags=["Authors"])

# Teams (团队协作)
router.include_router(teams.router, prefix="/teams", tags=["Teams"])

# Tasks (阅读任务)
router.include_router(tasks.router, tags=["Tasks"])

# Annotations (协作标注)
router.include_router(annotations.router, tags=["Annotations"])

# Auth (公开端点)
router.include_router(auth.router, prefix="/auth", tags=["Auth"])

# Admin (仅管理员)
router.include_router(admin.router, prefix="/admin", tags=["Admin"])
router.include_router(prompts.router, prefix="/admin/prompts", tags=["Prompts"])

# Quota (配额与邀请码)
router.include_router(quota.router, prefix="/quota", tags=["Quota"])

# Papers 相关
router.include_router(papers.router, prefix="/papers", tags=["Papers"])
router.include_router(library.router, prefix="/library", tags=["Library"])
router.include_router(citation.router, prefix="/library", tags=["Citation"])
router.include_router(monitor.router, prefix="/monitor", tags=["Monitor"])
router.include_router(analysis.router, prefix="/papers", tags=["Analysis"])
router.include_router(graph.router, prefix="/papers", tags=["Graph"])
router.include_router(classification.router, prefix="/papers", tags=["Classification"])
router.include_router(classification.tags_router, prefix="/library", tags=["Tags"])
router.include_router(translate.router, prefix="/papers", tags=["Translation"])
router.include_router(workbench.router, prefix="/workbench", tags=["Workbench"])
router.include_router(workbench.paper_workbench_router, prefix="/papers", tags=["Paper Workbench"])
