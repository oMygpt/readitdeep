"""
Config Manager - 配置管理服务
"""

from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.models.system_config import SystemConfig, DEFAULT_SYSTEM_CONFIG
from app.models.user_config import UserConfig

class ConfigManager:
    """配置管理器"""
    
    @staticmethod
    async def get_effective_config(db: AsyncSession, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        获取生效配置
        优先级: User > System > Env/Default
        """
        # 1. 基础配置 (Defaults)
        config = {k: v["value"] for k, v in DEFAULT_SYSTEM_CONFIG.items()}
        
        # 2. 环境变量覆盖 (Env)
        settings = get_settings()
        
        # Map environment variables/settings to config
        # Only override if value is present (truthy)
        env_mappings = {
            "mineru_api_key": settings.mineru_api_key,
            "mineru_api_url": settings.mineru_api_url,
            "llm_base_url": settings.llm_base_url,
            "llm_api_key": settings.llm_api_key,
            "llm_model": settings.llm_model,
            "embedding_provider": settings.embedding_provider,
            "embedding_base_url": settings.embedding_base_url,
            "embedding_api_key": settings.embedding_api_key,
            "embedding_model": settings.embedding_model,
        }
        
        for key, value in env_mappings.items():
            if value:
                config[key] = value
            
        # 3. 系统配置覆盖 (System DB)
        try:
            result = await db.execute(select(SystemConfig))
            system_configs = result.scalars().all()
            for sc in system_configs:
                if sc.value is not None:
                    config[sc.key] = sc.value
        except Exception as e:
            print(f"Error loading system config: {e}")
            
        # 4. 用户配置覆盖 (User DB)
        if user_id:
            try:
                result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
                user_configs = result.scalars().all()
                for uc in user_configs:
                    if uc.value is not None:
                        config[uc.key] = uc.value
            except Exception as e:
                print(f"Error loading user config: {e}")
                
        return config

    @staticmethod
    async def get_user_config(db: AsyncSession, user_id: str) -> Dict[str, Any]:
        """获取仅用户设定的配置"""
        config = {}
        try:
            result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
            user_configs = result.scalars().all()
            for uc in user_configs:
                config[uc.key] = uc.value
        except Exception:
            pass
        return config

    @staticmethod
    async def set_user_config(db: AsyncSession, user_id: str, updates: Dict[str, Any]):
        """设置用户配置"""
        for key, value in updates.items():
            result = await db.execute(
                select(UserConfig).where(
                    UserConfig.user_id == user_id,
                    UserConfig.key == key
                )
            )
            uc = result.scalar_one_or_none()
            
            if uc:
                uc.value = value
            else:
                uc = UserConfig(user_id=user_id, key=key, value=value)
                db.add(uc)
        
        await db.commit()
