"""
Read it DEEP - 工作台存储

功能:
- 工作台条目持久化（workbench_items 表；原 data/workbench.json 由迁移脚本导入）
- 按用户归属：全局视图 = 本人全部条目，论文视图 = 本人在该论文上的条目
- CRUD 操作
"""

import uuid
from typing import Optional, List
from datetime import datetime
from dataclasses import dataclass


@dataclass
class WorkbenchItem:
    """工作台项目"""
    id: str
    type: str  # method, dataset, code, note
    title: str
    description: str
    source_paper_id: Optional[str] = None
    zone: str = "notes"  # methods, datasets, notes
    created_at: str = ""
    data: dict = None
    # 归属用户。旧数据没有该字段，归属回落到 source_paper 的所有者（见 owner_of）
    user_id: Optional[str] = None

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat()
        if self.data is None:
            self.data = {}


class WorkbenchStore:
    """工作台存储（数据库实现，与 app.core.store 共用同步引擎）"""

    ZONES = ("methods", "datasets", "notes")

    @property
    def engine(self):
        from app.core.store import store

        return store.engine

    @staticmethod
    def _row_to_item(row) -> dict:
        m = row._mapping
        return {
            "id": m["id"],
            "type": m["type"],
            "title": m["title"] or "",
            "description": m["description"] or "",
            "source_paper_id": m["paper_id"],
            "zone": m["zone"],
            "created_at": m["created_at"] or "",
            "data": m["data"] or {},
            "user_id": m["user_id"],
        }

    def _select(self, *where) -> List[dict]:
        from sqlalchemy import select
        from app.models.workbench_item import WorkbenchItem as Row

        stmt = select(Row.__table__).where(*where).order_by(Row.created_at, Row.id)
        with self.engine.connect() as conn:
            return [self._row_to_item(r) for r in conn.execute(stmt)]

    # --- Item CRUD ---

    def add_item(
        self,
        type: str,
        title: str,
        description: str,
        source_paper_id: Optional[str] = None,
        zone: str = "notes",
        data: dict = None,
        user_id: Optional[str] = None,
        item_id: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> WorkbenchItem:
        """添加工作台项目；未给 user_id 时归属来源论文的所有者"""
        from app.models.workbench_item import WorkbenchItem as Row

        if user_id is None and source_paper_id:
            from app.core.store import store

            user_id = (store.get(source_paper_id) or {}).get("user_id")
        item = WorkbenchItem(
            id=item_id or f"wb-{uuid.uuid4().hex[:8]}",
            type=type,
            title=title,
            description=description,
            source_paper_id=source_paper_id,
            zone=zone,
            created_at=created_at or "",
            data=data or {},
            user_id=user_id,
        )
        with self.engine.begin() as conn:
            conn.execute(
                Row.__table__.insert().values(
                    id=item.id, user_id=item.user_id, paper_id=item.source_paper_id, type=item.type,
                    zone=item.zone, title=item.title, description=item.description, data=item.data,
                    created_at=item.created_at,
                )
            )
        return item

    def get_item(self, item_id: str) -> Optional[dict]:
        from app.models.workbench_item import WorkbenchItem as Row

        items = self._select(Row.id == item_id)
        return items[0] if items else None

    def update_item(self, item_id: str, updates: dict) -> bool:
        """更新项目（title / description / zone / data / type）"""
        from app.models.workbench_item import WorkbenchItem as Row

        values = {k: v for k, v in updates.items() if k in ("title", "description", "zone", "data", "type")}
        if not values:
            return self.get_item(item_id) is not None
        with self.engine.begin() as conn:
            result = conn.execute(Row.__table__.update().where(Row.id == item_id).values(**values))
        return result.rowcount > 0

    def delete_item(self, item_id: str) -> bool:
        from app.models.workbench_item import WorkbenchItem as Row

        with self.engine.begin() as conn:
            result = conn.execute(Row.__table__.delete().where(Row.id == item_id))
        return result.rowcount > 0

    # --- Query ---

    def owner_of(self, item: dict) -> Optional[str]:
        """条目归属。导入时已显式写入；为空的历史条目再回落到来源论文的所有者。"""
        if item.get("user_id"):
            return item["user_id"]
        paper_id = item.get("source_paper_id")
        if paper_id:
            from app.core.store import store

            return (store.get(paper_id) or {}).get("user_id")
        return None

    def _zones_of(self, items: List[dict]) -> dict:
        result = {zone: [] for zone in self.ZONES}
        for item in items:
            zone = item.get("zone", "notes")
            if zone in result:
                result[zone].append(item)
        return result

    def get_items_for_user(self, user_id: str) -> List[dict]:
        from app.models.workbench_item import WorkbenchItem as Row

        return self._select(Row.user_id == user_id)

    def get_global_workbench(self, user_id: str) -> dict:
        """获取某用户的全局工作台（其所有条目按区域汇总）"""
        return self._zones_of(self.get_items_for_user(user_id))

    def get_paper_workbench(self, paper_id: str, user_id: str) -> dict:
        """获取某用户在某论文上的工作台"""
        return self._zones_of(self.get_items_by_paper(paper_id, owner_id=user_id))

    def get_all_items(self) -> List[dict]:
        return self._select()

    def get_items_by_paper(self, paper_id: str, owner_id: Optional[str] = None) -> List[dict]:
        """获取某论文的项目；给定 owner_id 时只返回该用户的条目"""
        from app.models.workbench_item import WorkbenchItem as Row

        where = [Row.paper_id == paper_id]
        if owner_id is not None:
            where.append(Row.user_id == owner_id)
        return self._select(*where)

    def get_stats(self, user_id: str) -> dict:
        """获取某用户的统计信息"""
        items = self.get_items_for_user(user_id)
        zones = self._zones_of(items)
        return {
            "total_items": len(items),
            "methods_count": len(zones["methods"]),
            "datasets_count": len(zones["datasets"]),
            "notes_count": len(zones["notes"]),
            "papers_count": len({i.get("source_paper_id") for i in items if i.get("source_paper_id")}),
        }


# 全局实例
workbench_store = WorkbenchStore()
