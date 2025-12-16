import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        # Login
        resp = await client.post("http://localhost:8000/api/v1/auth/login", json={
            "email": "admin@readitdeep.com", "password": "admin123"
        })
        if resp.status_code != 200:
            print(f"Login failed: {resp.text}")
            return
            
        token = resp.json()["access_token"]
        headers = {'Authorization': f'Bearer {token}'}
        
        # List Papers
        resp = await client.get("http://localhost:8000/api/v1/library/", headers=headers)
        if resp.status_code != 200:
            print(f"List failed: {resp.text}")
            return
            
        papers = resp.json()["items"]
        if not papers:
            print("No papers found.")
            return
            
        # Sort by created_at desc
        papers.sort(key=lambda x: x["created_at"], reverse=True)
        latest = papers[0]
        
        print(f"Latest Paper: {latest['id']}")
        print(f"Status: {latest['status']}")
        
        # Get Detail for error message
        detail_resp = await client.get(f"http://localhost:8000/api/v1/papers/{latest['id']}", headers=headers)
        print(detail_resp.json())

if __name__ == "__main__":
    asyncio.run(main())
