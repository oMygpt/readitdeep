
import re
import httpx
import asyncio

PAPER_ID = "d572a494-7e2b-4328-819b-57bc6f24cdc8"

async def main():
    # 1. Fetch Content
    async with httpx.AsyncClient() as client:
        # Login
        resp = await client.post("http://localhost:8000/api/v1/auth/login", json={
            "email": "admin@readitdeep.com", "password": "admin123"
        })
        token = resp.json()["access_token"]
        headers = {'Authorization': f'Bearer {token}'}
        
        resp = await client.get(f"http://localhost:8000/api/v1/papers/{PAPER_ID}", headers=headers)
        content = resp.json().get("markdown_content", "")
        
    print(f"Total Content Length: {len(content)}")
    
    # 2. Simulate JS Regex Logic
    # Regex from ReaderPage.tsx: 
    # /(?:^|\n)(?:#+\s*|\*\*)?(?:Abstract|摘要)(?:\*\*|:|—|\.|：)?\s*(?:[\r\n]+)?([\s\S]*?)(?:(?:\r?\n){2,}|\n(?=#))/i
    
    # Python equivalent approximations
    # JS: (?:^|\n) -> (?<=^)|(?<=\n) or just handled by matching
    pattern = r'(?:^|\n)(?:#+\s*|\*\*)?(?:Abstract|摘要)(?:\*\*|:|—|\.|：)?\s*(?:[\r\n]+)?([\s\S]*?)(?:(?:\r?\n){2,}|\n(?=#))'
    
    match = re.search(pattern, content, re.IGNORECASE)
    
    if match:
        print("\n--- Match Found ---")
        captured_abstract = match.group(1).strip()
        print(f"Captured Abstract Length: {len(captured_abstract)}")
        print(f"Captured Abstract Start: {captured_abstract[:50]}...")
        print(f"Captured Abstract End: {captured_abstract[-50:]}")
        
        full_match_text = match.group(0)
        match_end_index = match.end()
        
        print(f"Match End Index: {match_end_index}")
        
        remaining = content[match_end_index:].strip()
        print(f"\nRemaining Body Length: {len(remaining)}")
        
        if len(remaining) < 1000:
             print("!!! CRITICAL: Body is almost empty. The regex swallowed the paper.")
             print("Remaining Body Content:")
             print(remaining)
    else:
        print("No Abstract Match Found")

if __name__ == "__main__":
    asyncio.run(main())
