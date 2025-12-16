import httpx
import asyncio

PAPER_ID = "73ef02d0-c394-4242-b736-3a7d438142c1"

async def main():
    async with httpx.AsyncClient() as client:
        # Login
        resp = await client.post("http://localhost:8000/api/v1/auth/login", json={
            "email": "admin@readitdeep.com", "password": "admin123"
        })
        token = resp.json()["access_token"]
        headers = {'Authorization': f'Bearer {token}'}
        
        # Get Paper
        resp = await client.get(f"http://localhost:8000/api/v1/papers/{PAPER_ID}", headers=headers)
        print(f"Status: {resp.status_code}")
        print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
