
import httpx
import asyncio
import sys

PAPER_ID = "d572a494-7e2b-4328-819b-57bc6f24cdc8"

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
        
        print(f"--- Fetching Paper {PAPER_ID} ---")
        try:
            resp = await client.get(f"http://localhost:8000/api/v1/papers/{PAPER_ID}", headers=headers)
            if resp.status_code != 200:
                print(f"Get Paper Failed: {resp.status_code} {resp.text}")
            else:
                data = resp.json()
                print(f"Status: {data.get('status')}")
                print(f"Error: {data.get('error_message')}")
                content = data.get('markdown_content', '')
                print(f"Content Length: {len(content) if content else 0}")
                if content:
                    print("--- Content Snippet (First 500 chars) ---")
                    print(content[:500])
                    print("--- Content Snippet (Last 500 chars) ---")
                    print(content[-500:])
        except Exception as e:
            print(f"Error fetching paper: {e}")

        print(f"\n--- Fetching Analysis {PAPER_ID} ---")
        try:
            resp = await client.get(f"http://localhost:8000/api/v1/papers/{PAPER_ID}/analysis", headers=headers)
            if resp.status_code != 200:
                print(f"Get Analysis Failed: {resp.status_code} {resp.text}")
            else:
                adata = resp.json()
                print(f"Summary: {adata.get('summary')}")
                print(f"Methods Count: {len(adata.get('methods', []))}")
                print(f"Structure: {adata.get('structure')}")
        except Exception as e:
            print(f"Error fetching analysis: {e}")

if __name__ == "__main__":
    asyncio.run(main())
