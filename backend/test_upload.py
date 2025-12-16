import httpx
import asyncio
import os

async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Login
        try:
            resp = await client.post("http://localhost:8000/api/v1/auth/login", json={
                "email": "admin@readitdeep.com",
                "password": "admin123"
            })
            print(f"Login: {resp.status_code}")
            if resp.status_code != 200:
                print(resp.text)
                return
            
            token = resp.json()["access_token"]
            print("Token obtained.")
            
            # Upload
            # Create dummy pdf bytes
            pdf_content = b'%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/Font <<\n/F1 4 0 R\n>>\n>>\n/MediaBox [0 0 612 792]\n/Contents 5 0 R\n>>\nendobj\n4 0 obj\n<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\nendobj\n5 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n70 700 TD\n/F1 24 Tf\n(Hello World) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000117 00000 n\n0000000256 00000 n\n0000000344 00000 n\ntrailer\n<<\n/Size 6\n/Root 1 0 R\n>>\nstartxref\n439\n%%EOF'
            
            files = {'file': ('test_upload_debug.pdf', pdf_content, 'application/pdf')}
            headers = {'Authorization': f'Bearer {token}'}
            
            print("Uploading...")
            resp = await client.post("http://localhost:8000/api/v1/papers/upload", headers=headers, files=files)
            print(f"Upload: {resp.status_code}")
            print(f"Response: {resp.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
