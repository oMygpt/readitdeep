"""
Read it DEEP - 创建管理员账户脚本

用法:
    cd backend
    python scripts/create_admin.py
    
或自定义:
    python scripts/create_admin.py --email your@email.com --password yourpassword
"""

import asyncio
import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def create_admin(email: str, password: str, username: str = None):
    """创建管理员账户"""
    from sqlalchemy import select
    from app.core.database import async_session_maker, init_db
    from app.models.user import User
    
    # 初始化数据库
    await init_db()
    
    async with async_session_maker() as db:
        # 检查是否已存在
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        
        if existing:
            print(f"⚠️  用户 {email} 已存在")
            print(f"   Role: {existing.role}")
            print(f"   Active: {existing.is_active}")
            
            # 如果需要，可以重置密码
            confirm = input("是否重置密码? (y/N): ")
            if confirm.lower() == 'y':
                existing.set_password(password)
                existing.role = "admin"  # 确保是管理员
                existing.is_active = True
                await db.commit()
                print(f"✅ 密码已重置，角色已设为 admin")
            return
        
        # 创建新用户
        user = User(
            email=email,
            username=username or email.split('@')[0],
            role="admin",
            is_active=True,
        )
        user.set_password(password)
        
        db.add(user)
        await db.commit()
        await db.refresh(user)
        
        print(f"✅ 管理员账户创建成功!")
        print(f"   Email: {email}")
        print(f"   Password: {password}")
        print(f"   User ID: {user.id}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="创建管理员账户")
    parser.add_argument("--email", default="admin@readitdeep.com", help="管理员邮箱")
    parser.add_argument("--password", default="admin123", help="管理员密码")
    parser.add_argument("--username", default=None, help="用户名")
    
    args = parser.parse_args()
    
    print("""
╔═══════════════════════════════════════════════════════════╗
║     Read it DEEP - 管理员账户创建工具                       ║
╚═══════════════════════════════════════════════════════════╝
""")
    
    asyncio.run(create_admin(args.email, args.password, args.username))
