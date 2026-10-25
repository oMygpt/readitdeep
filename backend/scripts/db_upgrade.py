#!/usr/bin/env python3
"""
手动执行数据库升级与旧 JSON 导入（应用启动时也会自动执行）。

  python scripts/db_upgrade.py                 # 升级结构 + 首次导入 data/*.json
  python scripts/db_upgrade.py --reimport      # 强制重新导入（幂等，输出对账报告）
  python scripts/db_upgrade.py --data-dir DIR  # 指定 papers.json / workbench.json 所在目录
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--reimport", action="store_true")
    args = parser.parse_args()

    from app.core.data_import import _record, import_json, import_json_if_needed
    from app.core.migrations import upgrade_database
    from app.core.store import store

    print("schema:", upgrade_database(store.engine))
    data_dir = Path(args.data_dir)
    if args.reimport:
        report = import_json(data_dir / "papers.json", data_dir / "workbench.json")
        _record(report)
    else:
        report = import_json_if_needed(data_dir)
    print(json.dumps(report, ensure_ascii=False, indent=2) if report else "json import: nothing to do")
    return 0


if __name__ == "__main__":
    sys.exit(main())
