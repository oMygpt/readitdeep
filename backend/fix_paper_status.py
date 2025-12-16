import httpx
import asyncio

async def main():
    # Helper to check and fix
    from app.core.store import store
    from app.core.database import async_session_maker
    
    # We can use store directly
    count = 0
    all_papers = store.get_all()
    for paper in all_papers:
        if paper.get("status") == "analyzed":
            print(f"Fixing paper {paper['id']} (analyzed -> completed)")
            paper["status"] = "completed"
            store.set(paper['id'], paper)
            count += 1
            
    print(f"Fixed {count} papers.")

if __name__ == "__main__":
    asyncio.run(main())
