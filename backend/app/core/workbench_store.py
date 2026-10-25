"""
Read it DEEP - 工作台存储

功能:
- 工作台项目持久化 (data/workbench.json)
- 论文关联 + 全局汇总
- CRUD 操作
"""

import json
import os
import uuid
from typing import Optional, List
from datetime import datetime
from dataclasses import dataclass, asdict


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
    """工作台存储管理"""

    def __init__(self, file_path: str = "data/workbench.json"):
        self.file_path = file_path
        self._data = {
            "items": {},  # id -> WorkbenchItem
            "global_workbench": {
                "methods": [],
                "datasets": [],
                "notes": [],
            },
            "paper_workbenches": {},  # paper_id -> zones
        }
        self._ensure_dir()
        self._load()

    def _ensure_dir(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)

    def _load(self):
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, 'r', encoding='utf-8') as f:
                    self._data = json.load(f)
            except Exception as e:
                print(f"Error loading workbench store: {e}")

    def _save(self):
        try:
            with open(self.file_path, 'w', encoding='utf-8') as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving workbench store: {e}")

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
    ) -> WorkbenchItem:
        """添加工作台项目"""
        item_id = f"wb-{uuid.uuid4().hex[:8]}"
        item = WorkbenchItem(
            id=item_id,
            type=type,
            title=title,
            description=description,
            source_paper_id=source_paper_id,
            zone=zone,
            data=data or {},
            user_id=user_id,
        )

        # 保存项目
        self._data["items"][item_id] = asdict(item)

        # 添加到全局工作台
        if zone in self._data["global_workbench"]:
            self._data["global_workbench"][zone].append(item_id)

        # 添加到论文工作台
        if source_paper_id:
            if source_paper_id not in self._data["paper_workbenches"]:
                self._data["paper_workbenches"][source_paper_id] = {
                    "methods": [],
                    "datasets": [],
                    "notes": [],
                }
            if zone in self._data["paper_workbenches"][source_paper_id]:
                self._data["paper_workbenches"][source_paper_id][zone].append(item_id)

        self._save()
        return item

    def get_item(self, item_id: str) -> Optional[dict]:
        """获取单个项目"""
        return self._data["items"].get(item_id)

    def update_item(self, item_id: str, updates: dict) -> bool:
        """更新项目"""
        if item_id not in self._data["items"]:
            return False

        old_zone = self._data["items"][item_id].get("zone")
        self._data["items"][item_id].update(updates)
        new_zone = self._data["items"][item_id].get("zone")

        # 如果区域变化，更新索引
        if old_zone != new_zone:
            self._move_item_zone(item_id, old_zone, new_zone)

        self._save()
        return True

    def delete_item(self, item_id: str) -> bool:
        """删除项目"""
        if item_id not in self._data["items"]:
            return False

        item = self._data["items"][item_id]
        zone = item.get("zone", "notes")
        paper_id = item.get("source_paper_id")

        # 从全局工作台移除
        if zone in self._data["global_workbench"]:
            if item_id in self._data["global_workbench"][zone]:
                self._data["global_workbench"][zone].remove(item_id)

        # 从论文工作台移除
        if paper_id and paper_id in self._data["paper_workbenches"]:
            if zone in self._data["paper_workbenches"][paper_id]:
                if item_id in self._data["paper_workbenches"][paper_id][zone]:
                    self._data["paper_workbenches"][paper_id][zone].remove(item_id)

        # 删除项目
        del self._data["items"][item_id]
        self._save()
        return True

    def _move_item_zone(self, item_id: str, old_zone: str, new_zone: str):
        """移动项目区域"""
        paper_id = self._data["items"][item_id].get("source_paper_id")

        # 全局工作台
        if old_zone in self._data["global_workbench"]:
            if item_id in self._data["global_workbench"][old_zone]:
                self._data["global_workbench"][old_zone].remove(item_id)
        if new_zone in self._data["global_workbench"]:
            self._data["global_workbench"][new_zone].append(item_id)

        # 论文工作台
        if paper_id and paper_id in self._data["paper_workbenches"]:
            pw = self._data["paper_workbenches"][paper_id]
            if old_zone in pw and item_id in pw[old_zone]:
                pw[old_zone].remove(item_id)
            if new_zone in pw:
                pw[new_zone].append(item_id)

    # --- Query ---

    def owner_of(self, item: dict) -> Optional[str]:
        """条目归属：显式 user_id，否则回落到来源论文的所有者；都没有则无主（仅管理员可见）。"""
        if item.get("user_id"):
            return item["user_id"]
        paper_id = item.get("source_paper_id")
        if paper_id:
            from app.core.store import store

            paper = store.get(paper_id) or {}
            return paper.get("user_id")
        return None

    def _zones_of(self, items: List[dict]) -> dict:
        result = {"methods": [], "datasets": [], "notes": []}
        for item in items:
            zone = item.get("zone", "notes")
            if zone in result:
                result[zone].append(item)
        return result

    def get_items_for_user(self, user_id: str) -> List[dict]:
        return [i for i in self._data["items"].values() if self.owner_of(i) == user_id]

    def get_global_workbench(self, user_id: str) -> dict:
        """获取某用户的全局工作台（其所有条目按区域汇总）"""
        return self._zones_of(self.get_items_for_user(user_id))

    def get_paper_workbench(self, paper_id: str, user_id: str) -> dict:
        """获取某用户在某论文上的工作台"""
        return self._zones_of(self.get_items_by_paper(paper_id, owner_id=user_id))

    def get_all_items(self) -> List[dict]:
        """获取所有项目"""
        return list(self._data["items"].values())

    def get_items_by_paper(self, paper_id: str, owner_id: Optional[str] = None) -> List[dict]:
        """获取某论文的项目；给定 owner_id 时只返回该用户的条目"""
        return [
            item for item in self._data["items"].values()
            if item.get("source_paper_id") == paper_id
            and (owner_id is None or self.owner_of(item) == owner_id)
        ]

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
