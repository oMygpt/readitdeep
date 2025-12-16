import asyncio
import os
import sys

sys.path.append(os.getcwd())

from app.core.config_manager import ConfigManager
from app.core.database import async_session_maker
from app.config import get_settings

async def main():
    # Print Env settings first
    settings = get_settings()
    print(f"Settings Mineru URL: '{settings.mineru_api_url}'")

    async with async_session_maker() as db:
        config = await ConfigManager.get_effective_config(db, "64d94413-f66a-4369-b6a0-66dcef7b83ee")
        print(f"Effective Mineru URL: '{config.get('mineru_api_url')}'")
        print(f"Effective Mineru Key: '{config.get('mineru_api_key')[:5]}...'" if config.get('mineru_api_key') else "No Key")

if __name__ == "__main__":
    asyncio.run(main())
