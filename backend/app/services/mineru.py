"""
Read it DEEP - Mineru PDF 解析服务 (Multi-User Adapted)

流程:
1. 本地文件: 申请上传链接 → PUT 上传文件 → 自动提交解析
2. 轮询状态: pending → running → done/failed
3. 下载 ZIP 结果，解压获取 Markdown
"""

import asyncio
import zipfile
import io
from typing import Optional
from dataclasses import dataclass

import httpx

from app.config import get_settings


@dataclass
class MineruTaskStatus:
    """Mineru 任务状态"""
    task_id: str
    state: str  # pending, running, done, failed, converting
    full_zip_url: Optional[str] = None
    err_msg: Optional[str] = None
    extracted_pages: Optional[int] = None
    total_pages: Optional[int] = None


@dataclass
class MineruParseResult:
    """解析结果"""
    markdown_content: str
    images: dict[str, bytes]  # filename -> image bytes
    success: bool
    error: Optional[str] = None


class MineruService:
    """Mineru PDF 解析服务"""
    
    # Hardcoded to correct value to ignore potentially bad Env configuration
    BASE_URL = "https://mineru.net/api/v4"
    
    def __init__(self, api_key: Optional[str] = None):
        settings = get_settings()
        # Use provided key (User) or fallback to system settings
        self.api_key = api_key if api_key else settings.mineru_api_key
        self._client: Optional[httpx.AsyncClient] = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            # Debug log
            masked_key = f"{self.api_key[:5]}...{self.api_key[-5:]}" if self.api_key else "None"
            print(f"🔧 MineruService initializing with API Key: {masked_key}")
            
            # 增加超时时间，PDF 解析可能很慢
            timeout = httpx.Timeout(
                connect=30.0,      # 连接超时
                read=300.0,        # 读取超时 (5 分钟)
                write=120.0,       # 写入超时 (上传文件)
                pool=30.0,         # 连接池超时
            )
            
            self._client = httpx.AsyncClient(
                timeout=timeout,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                # 添加重试配置
                transport=httpx.AsyncHTTPTransport(retries=3),
            )
        return self._client
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def upload_and_parse(
        self,
        filename: str,
        file_content: bytes,
        data_id: str,
        model_version: str = "vlm",
    ) -> str:
        """上传文件并提交解析任务"""
        # Step 1: 申请上传链接
        url = f"{self.BASE_URL}/file-urls/batch"
        # print(f"DEBUG: Mineru Batch URL: {url}")
        
        response = await self.client.post(
            url,
            json={
                "files": [{"name": filename, "data_id": data_id}],
                "model_version": model_version,
                "enable_formula": True,
                "enable_table": True,
            }
        )
        response.raise_for_status()
        result = response.json()
        
        if result.get("code") != 0:
            raise Exception(f"Mineru API error: {result.get('msg')}")
        
        batch_id = result["data"]["batch_id"]
        upload_url = result["data"]["file_urls"][0]
        
        # Step 2: PUT 上传文件 (增加超时和重试)
        upload_timeout = httpx.Timeout(connect=30.0, read=180.0, write=180.0, pool=30.0)
        async with httpx.AsyncClient(
            timeout=upload_timeout,
            transport=httpx.AsyncHTTPTransport(retries=2),
        ) as upload_client:
            upload_response = await upload_client.put(
                upload_url,
                content=file_content,
            )
            upload_response.raise_for_status()
        
        return batch_id
    
    async def get_batch_status(self, batch_id: str) -> MineruTaskStatus:
        """获取批量任务状态"""
        response = await self.client.get(
            f"{self.BASE_URL}/extract-results/batch/{batch_id}"
        )
        response.raise_for_status()
        result = response.json()
        
        if result.get("code") != 0:
            raise Exception(f"Mineru API error: {result.get('msg')}")
        
        # 取第一个文件的状态
        extract_result = result["data"]["extract_result"][0]
        
        status = MineruTaskStatus(
            task_id=batch_id,
            state=extract_result.get("state", "unknown"),
            full_zip_url=extract_result.get("full_zip_url"),
            err_msg=extract_result.get("err_msg"),
        )
        
        # 解析进度信息 (running 状态)
        progress = extract_result.get("extract_progress", {})
        if progress:
            status.extracted_pages = progress.get("extracted_pages")
            status.total_pages = progress.get("total_pages")
        
        return status
    
    async def wait_for_completion(
        self,
        batch_id: str,
        poll_interval: float = 5.0,
        max_wait: float = 600.0,  # 10 分钟超时
    ) -> MineruTaskStatus:
        """等待任务完成"""
        elapsed = 0.0
        while elapsed < max_wait:
            status = await self.get_batch_status(batch_id)
            
            if status.state == "done":
                return status
            elif status.state == "failed":
                raise Exception(f"Mineru parsing failed: {status.err_msg}")
            
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        
        raise TimeoutError(f"Mineru task {batch_id} timed out after {max_wait}s")
    
    async def download_and_extract_markdown(
        self,
        zip_url: str,
    ) -> MineruParseResult:
        """下载 ZIP 并提取 Markdown 内容"""
        try:
            # 下载 ZIP
            response = await self.client.get(zip_url, follow_redirects=True)
            response.raise_for_status()
            
            # 解压
            zip_buffer = io.BytesIO(response.content)
            markdown_content = ""
            images: dict[str, bytes] = {}
            
            with zipfile.ZipFile(zip_buffer, 'r') as zf:
                file_list = zf.namelist()
                print(f"📦 ZIP Contents for {zip_url}: {file_list}")
                
                for name in file_list:
                    if name.endswith('.md'):
                        try:
                            markdown_content = zf.read(name).decode('utf-8')
                        except:
                            # 尝试其他编码
                            markdown_content = zf.read(name).decode('gbk', errors='ignore')

                    elif name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
                        images[name] = zf.read(name)
            
            return MineruParseResult(
                markdown_content=markdown_content,
                images=images,
                success=True,
            )
        except Exception as e:
            return MineruParseResult(
                markdown_content="",
                images={},
                success=False,
                error=str(e),
            )
    
    async def parse_file(
        self,
        filename: str,
        file_content: bytes,
        data_id: str,
    ) -> MineruParseResult:
        """完整解析流程: 上传 → 等待 → 下载结果"""
        try:
            batch_id = await self.upload_and_parse(
                filename=filename,
                file_content=file_content,
                data_id=data_id,
            )
            
            status = await self.wait_for_completion(batch_id)
            
            if status.full_zip_url:
                result = await self.download_and_extract_markdown(status.full_zip_url)
                await self.close()
                return result
            else:
                await self.close()
                return MineruParseResult(
                    markdown_content="",
                    images={},
                    success=False,
                    error="No ZIP URL returned",
                )
        except Exception as e:
            await self.close()
            return MineruParseResult(
                markdown_content="",
                images={},
                success=False,
                error=str(e),
            )
