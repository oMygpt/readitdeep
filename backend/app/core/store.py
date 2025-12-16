
import json
import os
import asyncio
from typing import Dict, Any
from datetime import datetime

class JSONStore:
    def __init__(self, file_path: str = "data/papers.json"):
        self.file_path = file_path
        self._data: Dict[str, Any] = {}
        self._ensure_dir()
        self._load()

    def _ensure_dir(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)

    def _load(self):
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Convert string dates back to objects if needed, 
                    # but for JSON serializability we might keep them as strings until usage
                    self._data = data
            except Exception as e:
                print(f"Error loading store: {e}")
                self._data = {}
        else:
            self._data = {}

    def _save(self):
        try:
            # Create a backup just in case
            if os.path.exists(self.file_path):
                backup_path = f"{self.file_path}.bak"
                with open(self.file_path, 'r', encoding='utf-8') as src, \
                     open(backup_path, 'w', encoding='utf-8') as dst:
                    dst.write(src.read())
            
            with open(self.file_path, 'w', encoding='utf-8') as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False, default=str)
        except Exception as e:
            print(f"Error saving store: {e}")

    def get(self, key: str) -> dict:
        return self._data.get(key)

    def set(self, key: str, value: dict):
        self._data[key] = value
        self._save()

    def delete(self, key: str):
        if key in self._data:
            del self._data[key]
            self._save()

    def get_all(self) -> list:
        return list(self._data.values())

    def update(self, key: str, updates: dict):
        if key in self._data:
            self._data[key].update(updates)
            self._save()

    def get_by_user(self, user_id: str) -> list:
        """获取指定用户的所有论文"""
        return [
            p for p in self._data.values() 
            if p.get("user_id") == user_id
        ]

    def get_all_or_by_user(self, user_id: str | None = None) -> list:
        """获取所有论文或按用户过滤 (管理员可查看全部)"""
        if user_id:
            return self.get_by_user(user_id)
        return list(self._data.values())

# Global instance
store = JSONStore()
