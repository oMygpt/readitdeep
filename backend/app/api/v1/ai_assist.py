"""
AI 讨论助手 API (AI Discussion Assistant API)

处理 @AI 请求，提供：
- 解释功能
- 总结功能
- 搜索功能
- 比较功能
- 拓展功能
"""

import os
import json
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models import User, Team, TeamMember, Paper, TeamAnnotation

router = APIRouter(prefix="/ai", tags=["ai"])


# ================== Pydantic Models ==================

class AIRequestBase(BaseModel):
    """AI 请求基础"""
    command: str = Field(..., description="AI 指令: explain, summarize, search, compare, expand")
    content: str = Field(..., description="用户输入内容")
    paper_id: Optional[str] = None
    team_id: Optional[str] = None
    annotation_id: Optional[str] = None  # 关联的标注/讨论


class AIResponse(BaseModel):
    """AI 响应"""
    success: bool
    command: str
    response: str
    sources: Optional[List[dict]] = None  # 引用来源
    created_at: str


# ================== Helper Functions ==================

def get_llm_client():
    """获取 LLM 客户端"""
    from openai import OpenAI
    
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    return OpenAI(api_key=api_key, base_url=base_url)


def build_context(
    db: Session,
    paper_id: Optional[str] = None,
    team_id: Optional[str] = None,
    annotation_id: Optional[str] = None,
) -> str:
    """构建 AI 上下文"""
    context_parts = []
    
    # 添加论文上下文
    if paper_id:
        paper = db.get(Paper, paper_id)
        if paper:
            context_parts.append(f"## 论文信息\n")
            context_parts.append(f"标题: {paper.title or paper.filename}\n")
            if paper.abstract:
                context_parts.append(f"摘要: {paper.abstract}\n")
            if paper.markdown_content:
                # 只取前 3000 字符避免上下文过长
                content_preview = paper.markdown_content[:3000]
                if len(paper.markdown_content) > 3000:
                    content_preview += "\n...(内容已截断)"
                context_parts.append(f"\n论文内容预览:\n{content_preview}\n")
    
    # 添加标注/讨论上下文
    if annotation_id:
        annotation = db.get(TeamAnnotation, annotation_id)
        if annotation:
            context_parts.append(f"\n## 当前讨论\n")
            if annotation.selected_text:
                context_parts.append(f"选中文本: {annotation.selected_text}\n")
            if annotation.content:
                context_parts.append(f"批注内容: {annotation.content}\n")
            
            # 获取回复
            replies = db.execute(
                select(TeamAnnotation)
                .where(TeamAnnotation.parent_id == annotation_id)
                .order_by(TeamAnnotation.created_at)
            ).scalars().all()
            
            if replies:
                context_parts.append(f"\n讨论回复:\n")
                for reply in replies[:10]:  # 最多 10 条回复
                    user = db.get(User, reply.user_id)
                    username = user.username if user else "未知用户"
                    context_parts.append(f"- {username}: {reply.content}\n")
    
    return "\n".join(context_parts)


def generate_ai_response(
    command: str,
    content: str,
    context: str,
) -> str:
    """调用 LLM 生成响应"""
    client = get_llm_client()
    
    # 根据指令构建提示
    command_prompts = {
        "explain": "你是一个学术助手。请详细解释用户提出的问题或概念。结合提供的上下文(如有)，给出清晰易懂的解释。使用中文回复。",
        "summarize": "你是一个学术助手。请总结提供的内容。提炼关键要点，用简洁的语言概括主要观点。使用中文回复。",
        "search": "你是一个学术助手。根据用户的查询和上下文，提供相关的信息和见解。如果信息不足，说明需要更多资料。使用中文回复。",
        "compare": "你是一个学术助手。请比较用户提到的不同概念、方法或论文。分析它们的异同点、优缺点。使用中文回复。",
        "expand": "你是一个学术助手。请基于当前讨论内容，拓展相关知识，提供进一步的见解、相关工作或研究方向建议。使用中文回复。",
    }
    
    system_prompt = command_prompts.get(command, command_prompts["explain"])
    
    messages = [
        {"role": "system", "content": system_prompt},
    ]
    
    # 添加上下文
    if context:
        messages.append({
            "role": "system",
            "content": f"以下是相关上下文信息:\n\n{context}"
        })
    
    messages.append({
        "role": "user",
        "content": content
    })
    
    try:
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=1500,
            temperature=0.7,
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"抱歉，AI 处理时出现错误: {str(e)}"


# ================== API Endpoints ==================

@router.post("/assist", response_model=AIResponse)
async def ai_assist(
    request: AIRequestBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    处理 @AI 请求
    
    支持的指令:
    - explain: 解释概念或内容
    - summarize: 总结讨论或论文
    - search: 搜索相关信息
    - compare: 比较不同方法/论文
    - expand: 拓展相关知识
    """
    valid_commands = ["explain", "summarize", "search", "compare", "expand"]
    
    if request.command not in valid_commands:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid command. Must be one of: {', '.join(valid_commands)}"
        )
    
    # 检查团队权限 (如果指定了 team_id)
    if request.team_id:
        member = db.execute(
            select(TeamMember).where(
                TeamMember.team_id == request.team_id,
                TeamMember.user_id == current_user.id
            )
        ).scalar_one_or_none()
        
        if not member:
            raise HTTPException(status_code=403, detail="Not a team member")
    
    # 构建上下文
    context = build_context(
        db,
        paper_id=request.paper_id,
        team_id=request.team_id,
        annotation_id=request.annotation_id,
    )
    
    # 生成 AI 响应
    response_text = generate_ai_response(
        command=request.command,
        content=request.content,
        context=context,
    )
    
    return AIResponse(
        success=True,
        command=request.command,
        response=response_text,
        sources=None,  # TODO: 添加引用来源解析
        created_at=datetime.utcnow().isoformat(),
    )


@router.post("/summarize-discussion")
async def summarize_discussion(
    annotation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """总结讨论线程"""
    annotation = db.get(TeamAnnotation, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
    
    # 检查团队权限
    if annotation.team_id:
        member = db.execute(
            select(TeamMember).where(
                TeamMember.team_id == annotation.team_id,
                TeamMember.user_id == current_user.id
            )
        ).scalar_one_or_none()
        
        if not member:
            raise HTTPException(status_code=403, detail="Not a team member")
    
    # 获取所有回复
    replies = db.execute(
        select(TeamAnnotation)
        .where(TeamAnnotation.parent_id == annotation_id)
        .order_by(TeamAnnotation.created_at)
    ).scalars().all()
    
    # 构建讨论内容
    discussion_parts = []
    if annotation.content:
        discussion_parts.append(f"原始批注: {annotation.content}")
    
    for reply in replies:
        user = db.get(User, reply.user_id)
        username = user.username if user else "未知用户"
        discussion_parts.append(f"{username}: {reply.content}")
    
    discussion_text = "\n".join(discussion_parts)
    
    # 生成总结
    response_text = generate_ai_response(
        command="summarize",
        content=f"请总结以下学术讨论的要点:\n\n{discussion_text}",
        context="",
    )
    
    return {
        "success": True,
        "summary": response_text,
        "discussion_count": len(replies) + 1,
        "created_at": datetime.utcnow().isoformat(),
    }
