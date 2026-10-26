#!/usr/bin/env python3
"""
把一个已有的本地账号绑定到 PaperDaily 用户（关联模式切换前后由运维执行）。

主站首发不下发邮箱，无法自动按邮箱关联；例如原来的本地管理员要继续使用自己的论文与工作台，
就需要先绑定：

  python scripts/link_paperdaily_account.py --email admin@example.com --subject <PaperDaily user_id>

绑定后用该 PaperDaily 账号登录即进入这个本地账号（角色与数据保留）。--unlink 解除绑定。
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--subject")
    parser.add_argument("--unlink", action="store_true")
    args = parser.parse_args()
    if not args.unlink and not args.subject:
        parser.error("--subject 必填（或使用 --unlink）")

    from sqlalchemy import select

    from app.core.database import async_session_maker
    from app.models.user import User

    async with async_session_maker() as db:
        user = (await db.execute(select(User).where(User.email == args.email.lower()))).scalar_one_or_none()
        if user is None:
            print(f"找不到本地账号 {args.email}", file=sys.stderr)
            return 1
        if args.unlink:
            user.external_provider = user.external_subject = None
        else:
            other = (await db.execute(select(User).where(User.external_provider == "paperdaily",
                                                         User.external_subject == args.subject))).scalar_one_or_none()
            if other is not None and other.id != user.id:
                print(f"该 PaperDaily 用户已绑定到 {other.email}，请先解除", file=sys.stderr)
                return 1
            user.external_provider, user.external_subject = "paperdaily", args.subject
        await db.commit()
    print("已解除绑定" if args.unlink else f"已绑定 {args.email} ↔ PaperDaily {args.subject}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
