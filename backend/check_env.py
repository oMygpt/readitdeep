
# 检查环境变量加载
import os
from dotenv import load_dotenv
from app.config import get_settings

# 1. 直接读取 .env
print("--- Check .env file ---")
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if "MINERU" in line:
                print(f"Content: {line.strip()}")

# 2. 读取 os.environ
load_dotenv(override=True)
print("\n--- Check os.environ ---")
print(f"MINERU_API_KEY env: {os.getenv('MINERU_API_KEY')}")

# 3. 读取 Settings
print("\n--- Check Settings ---")
settings = get_settings()
print(f"Settings mineru_api_key: {settings.mineru_api_key}")
print(f"Settings mineru_api_url: {settings.mineru_api_url}")
