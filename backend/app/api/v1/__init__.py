"""
Read it DEEP - API v1 路由
"""

from fastapi import APIRouter

from app.api.v1 import papers, library, monitor, analysis, graph, classification, translate, workbench

router = APIRouter()

router.include_router(papers.router, prefix="/papers", tags=["Papers"])
router.include_router(library.router, prefix="/library", tags=["Library"])
router.include_router(monitor.router, prefix="/monitor", tags=["Monitor"])
router.include_router(analysis.router, prefix="/papers", tags=["Analysis"])
router.include_router(graph.router, prefix="/papers", tags=["Graph"])
router.include_router(classification.router, prefix="/papers", tags=["Classification"])
router.include_router(classification.tags_router, prefix="/library", tags=["Tags"])
router.include_router(translate.router, prefix="/papers", tags=["Translation"])
router.include_router(workbench.router, prefix="/workbench", tags=["Workbench"])
router.include_router(workbench.paper_workbench_router, prefix="/papers", tags=["Paper Workbench"])
