/**
 * SmartSelectionPopup - 智能文本选择浮窗
 * 
 * 功能：
 * - 选中文本后显示智能操作按钮
 * - 公式优先显示 Math 解析
 * - 分析结果在可拖动的浮窗中显示
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Loader2, GripHorizontal, Minimize2, Maximize2, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { api } from '../lib/api';

import type { TextLocation } from '../lib/api';

interface SmartAction {
    id: string;
    label: string;
    icon: string;
    priority: number;
}

interface SelectionPosition {
    x: number;
    y: number;
}

interface SmartSelectionPopupProps {
    text: string;
    position: SelectionPosition;
    paperId: string;
    paperTitle: string;
    fullContent?: string;  // For Chat with PDF context
    location?: TextLocation | null;
    onClose: () => void;
    onNoteAdded?: () => void;  // Callback when notes/methods/assets are added to workbench
}

// 检测是否为公式文本
function detectMath(text: string): boolean {
    // LaTeX 公式标记
    if (/\$[^$]+\$/.test(text)) return true;
    if (/\\\(.*?\\\)/.test(text)) return true;
    if (/\\\[.*?\\\]/.test(text)) return true;
    // 常见数学符号
    if (/[∀∃∈∉∑∏∫∂∇√∞≈≠≤≥±×÷αβγδεζηθλμπσφψω]/.test(text)) return true;
    // 公式常见模式
    if (/[a-zA-Z]\s*[=<>≤≥]\s*[a-zA-Z0-9]/.test(text)) return true;
    if (/\b(sin|cos|tan|log|ln|exp|lim|max|min)\b/i.test(text)) return true;
    return false;
}

// 获取智能操作列表
function getSmartActions(text: string): SmartAction[] {
    const isMath = detectMath(text);

    const actions: SmartAction[] = [
        { id: 'math', label: 'Math 解析', icon: '📐', priority: isMath ? 1 : 10 },
        { id: 'feynman', label: '费曼教学', icon: '🎓', priority: isMath ? 2 : 1 },
        { id: 'deep', label: '深度研究', icon: '🔬', priority: isMath ? 3 : 2 },
        { id: 'chat', label: 'Chat with PDF', icon: '💬', priority: 4 },
    ];

    return actions.sort((a, b) => a.priority - b.priority);
}

// 可拖动的结果窗口
interface ResultWindowProps {
    title: string;
    icon: string;
    content: string;
    isLoading: boolean;
    position: { x: number; y: number };
    onClose: () => void;
    isChat?: boolean;
    onSendMessage?: (message: string) => void;
    chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function ResultWindow({
    title,
    icon,
    content,
    isLoading,
    position,
    onClose,
    isChat = false,
    onSendMessage,
    chatHistory = [],
}: ResultWindowProps) {
    const [pos, setPos] = useState(position);
    const [isDragging, setIsDragging] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const dragOffset = useRef({ x: 0, y: 0 });
    const windowRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) {
            setIsDragging(true);
            dragOffset.current = {
                x: e.clientX - pos.x,
                y: e.clientY - pos.y,
            };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPos({
                    x: e.clientX - dragOffset.current.x,
                    y: e.clientY - dragOffset.current.y,
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const handleSendChat = () => {
        if (chatInput.trim() && onSendMessage) {
            onSendMessage(chatInput.trim());
            setChatInput('');
        }
    };

    return (
        <div
            ref={windowRef}
            className="fixed z-[100] bg-surface rounded-xl shadow-2xl border border-border overflow-hidden"
            style={{
                left: pos.x,
                top: pos.y,
                minWidth: isMinimized ? '200px' : '400px',
                maxWidth: '600px',
                maxHeight: isMinimized ? '40px' : '80vh',
            }}
            onMouseDown={handleMouseDown}
        >
            {/* Header - Drag Handle */}
            <div className="drag-handle flex items-center justify-between px-3 py-2 bg-gradient-to-r from-primary to-secondary text-primary-content cursor-move">
                <div className="flex items-center gap-2">
                    <GripHorizontal className="w-4 h-4 opacity-60" />
                    <span className="text-lg">{icon}</span>
                    <span className="font-medium text-sm">{title}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="p-1 hover:bg-white/20 rounded transition-colors"
                    >
                        {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/20 rounded transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content */}
            {!isMinimized && (
                <div className="overflow-auto" style={{ maxHeight: 'calc(80vh - 40px)' }}>
                    {isChat ? (
                        // Chat Interface
                        <div className="flex flex-col h-full">
                            {/* Chat History */}
                            <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[50vh]">
                                {chatHistory.map((msg, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${msg.role === 'user'
                                                ? 'bg-primary text-primary-content'
                                                : 'bg-surface-elevated text-content-main'
                                                }`}
                                        >
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex justify-start">
                                        <div className="bg-surface-elevated px-4 py-2 rounded-xl">
                                            <Loader2 className="w-4 h-4 animate-spin text-content-muted" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Chat Input */}
                            <div className="p-3 border-t border-border">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                                        placeholder="输入问题..."
                                        className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-content-main"
                                    />
                                    <button
                                        onClick={handleSendChat}
                                        disabled={!chatInput.trim() || isLoading}
                                        className="px-3 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        // Analysis Result
                        <div className="p-4">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                    <span className="ml-2 text-content-muted">分析中...</span>
                                </div>
                            ) : (
                                <div className="prose prose-sm prose-slate max-w-none text-content-main">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                    >
                                        {content}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// 主组件
export default function SmartSelectionPopup({
    text,
    position,
    paperId,
    paperTitle,
    fullContent,
    location,
    onClose,
    onNoteAdded,
}: SmartSelectionPopupProps) {
    const [activeWindow, setActiveWindow] = useState<{
        type: string;
        title: string;
        icon: string;
        content: string;
        isLoading: boolean;
        position: { x: number; y: number };
    } | null>(null);

    const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [workbenchStatus, setWorkbenchStatus] = useState<{ type: string; success: boolean } | null>(null);

    const actions = getSmartActions(text);

    // 添加到工作台
    const handleWorkbenchAdd = useCallback(async (zone: 'method' | 'asset' | 'note') => {
        try {
            const locationStr = location ? JSON.stringify(location) : '';

            if (zone === 'method') {
                await api.post('/workbench/analyze/method', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: locationStr,
                });
            } else if (zone === 'asset') {
                await api.post('/workbench/analyze/asset', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: locationStr,
                });
            } else {
                await api.post('/workbench/notes', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: locationStr,
                    is_title_note: false,
                    reflection: '',
                });
            }
            setWorkbenchStatus({ type: zone, success: true });
            // Trigger workbench refresh
            onNoteAdded?.();
            setTimeout(() => setWorkbenchStatus(null), 2000);
        } catch (error) {
            console.error('Failed to add to workbench:', error);
            setWorkbenchStatus({ type: zone, success: false });
            setTimeout(() => setWorkbenchStatus(null), 2000);
        }
    }, [text, paperId, paperTitle, location, onNoteAdded]);

    // Stream reader helper
    const streamAnalyze = async (
        url: string,
        body: any,
        onContent: (content: string) => void,
        onComplete: () => void,
        onError: (err: any) => void
    ) => {
        try {
            const token = localStorage.getItem('readitdeep_token');
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error || response.statusText);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error('No readable stream');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.error) throw new Error(data.error);
                            if (data.content) onContent(data.content);
                            if (data.done) onComplete();
                        } catch (e) {
                            // Skip invalid JSON or partial chunks
                        }
                    }
                }
            }
        } catch (error) {
            onError(error);
        }
    };

    const handleAction = useCallback(async (action: SmartAction) => {
        const windowPos = {
            x: Math.min(position.x + 50, window.innerWidth - 450),
            y: Math.min(position.y + 50, window.innerHeight - 400),
        };

        if (action.id === 'chat') {
            // Initialize Chat with PDF
            setChatHistory([
                {
                    role: 'assistant',
                    content: `我已准备好讨论这篇论文。您选中的内容是：\n\n> ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}\n\n请问您有什么问题？`,
                },
            ]);
            setActiveWindow({
                type: 'chat',
                title: 'Chat with PDF',
                icon: action.icon,
                content: '',
                isLoading: false,
                position: windowPos,
            });
            return;
        }

        // Other analysis types
        setActiveWindow({
            type: action.id,
            title: action.label,
            icon: action.icon,
            content: '',
            isLoading: true,
            position: windowPos,
        });

        // Use streaming with fallback to non-streaming
        try {
            await streamAnalyze(
                '/api/v1/workbench/analyze/smart/stream',
                {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    action_type: action.id,
                },
                (content) => {
                    setActiveWindow(prev => prev ? {
                        ...prev,
                        content: prev.content + content,
                    } : null);
                },
                () => {
                    setActiveWindow(prev => prev ? {
                        ...prev,
                        isLoading: false,
                    } : null);
                },
                async (error) => {
                    // Fallback to non-streaming API
                    console.warn('Stream failed, falling back to non-streaming:', error);
                    try {
                        const response = await api.post('/workbench/analyze/smart', {
                            text,
                            paper_id: paperId,
                            paper_title: paperTitle,
                            action_type: action.id,
                        });
                        if (response.data.success) {
                            setActiveWindow(prev => prev ? {
                                ...prev,
                                content: response.data.result,
                                isLoading: false,
                            } : null);
                        } else {
                            setActiveWindow(prev => prev ? {
                                ...prev,
                                content: `**分析失败**: ${response.data.error || '未知错误'}`,
                                isLoading: false,
                            } : null);
                        }
                    } catch (fallbackError) {
                        setActiveWindow(prev => prev ? {
                            ...prev,
                            content: `**分析出错**: ${(error as Error).message}`,
                            isLoading: false,
                        } : null);
                    }
                }
            );
        } catch (e) {
            console.error('Analysis failed:', e);
        }
    }, [text, paperId, paperTitle, position]);

    const handleChatMessage = useCallback(async (message: string) => {
        setChatHistory(prev => [...prev, { role: 'user', content: message }]);
        setIsChatLoading(true);

        // Append empty assistant message for streaming
        setChatHistory(prev => [...prev, { role: 'assistant', content: '' }]);

        await streamAnalyze(
            '/api/v1/workbench/analyze/smart/stream',
            {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                action_type: 'chat',
                context: fullContent?.slice(0, 8000),
                chat_history: chatHistory,
                user_message: message,
            },
            (content) => {
                setChatHistory(prev => {
                    const newHistory = [...prev];
                    const lastMsg = newHistory[newHistory.length - 1];
                    if (lastMsg.role === 'assistant') {
                        lastMsg.content += content;
                    }
                    return newHistory;
                });
            },
            () => {
                setIsChatLoading(false);
            },
            (error) => {
                setChatHistory(prev => {
                    const newHistory = [...prev];
                    const lastMsg = newHistory[newHistory.length - 1];
                    if (lastMsg.role === 'assistant') {
                        lastMsg.content += `\n\n**出错**: ${(error as Error).message}`;
                    }
                    return newHistory;
                });
                setIsChatLoading(false);
            }
        );
    }, [text, paperId, paperTitle, fullContent, chatHistory]);

    return (
        <>
            {/* 操作按钮浮窗 */}
            <div
                className="fixed z-[99] animate-in fade-in zoom-in-95 duration-200 smart-selection-popup"
                style={{
                    left: position.x,
                    top: position.y - 50,
                    transform: 'translateX(-50%)',
                }}
            >
                <div className="flex items-center gap-1 bg-surface rounded-full shadow-xl border border-border px-2 py-1.5">
                    {/* 智能分析按钮 */}
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            onClick={() => handleAction(action)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-content-main hover:bg-primary/10 hover:text-primary rounded-full transition-all"
                            title={action.label}
                        >
                            <span className="text-base">{action.icon}</span>
                            <span className="hidden sm:inline">{action.label}</span>
                        </button>
                    ))}

                    {/* 分隔线 */}
                    <div className="w-px h-5 bg-border mx-1" />

                    {/* 工作台快捷按钮 */}
                    <button
                        onClick={() => handleWorkbenchAdd('method')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-full transition-all"
                        title="添加到方法炼金台"
                    >
                        <span className="text-sm">🔬</span>
                        <span className="hidden lg:inline">方法</span>
                    </button>
                    <button
                        onClick={() => handleWorkbenchAdd('asset')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-info hover:bg-info/10 rounded-full transition-all"
                        title="添加到资产仓库"
                    >
                        <span className="text-sm">📊</span>
                        <span className="hidden lg:inline">资产</span>
                    </button>
                    <button
                        onClick={() => handleWorkbenchAdd('note')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-secondary hover:bg-secondary/10 rounded-full transition-all"
                        title="添加到智能笔记"
                    >
                        <span className="text-sm">💡</span>
                        <span className="hidden lg:inline">笔记</span>
                    </button>

                    {/* 分隔线 */}
                    <div className="w-px h-5 bg-border mx-1" />

                    {/* 关闭按钮 */}
                    <button
                        onClick={onClose}
                        className="p-1.5 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-full transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* 工作台操作反馈 */}
                {workbenchStatus && (
                    <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg animate-in fade-in zoom-in-95 ${workbenchStatus.success
                        ? 'bg-success text-success-content'
                        : 'bg-error text-error-content'
                        }`}>
                        {workbenchStatus.success
                            ? `✓ 已添加到${workbenchStatus.type === 'method' ? '方法炼金台' : workbenchStatus.type === 'asset' ? '资产仓库' : '智能笔记'}`
                            : '添加失败，请重试'
                        }
                    </div>
                )}
            </div>

            {/* 结果窗口 */}
            {activeWindow && (
                <ResultWindow
                    title={activeWindow.title}
                    icon={activeWindow.icon}
                    content={activeWindow.content}
                    isLoading={activeWindow.type === 'chat' ? isChatLoading : activeWindow.isLoading}
                    position={activeWindow.position}
                    onClose={() => setActiveWindow(null)}
                    isChat={activeWindow.type === 'chat'}
                    onSendMessage={handleChatMessage}
                    chatHistory={chatHistory}
                />
            )}
        </>
    );
}
