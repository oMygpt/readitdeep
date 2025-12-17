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
    onClose: () => void;
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
            className="fixed z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
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
            <div className="drag-handle flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white cursor-move">
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
                                                ? 'bg-indigo-500 text-white'
                                                : 'bg-slate-100 text-slate-700'
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
                                        <div className="bg-slate-100 px-4 py-2 rounded-xl">
                                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Chat Input */}
                            <div className="p-3 border-t border-slate-100">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                                        placeholder="输入问题..."
                                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    />
                                    <button
                                        onClick={handleSendChat}
                                        disabled={!chatInput.trim() || isLoading}
                                        className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                                    <span className="ml-2 text-slate-500">分析中...</span>
                                </div>
                            ) : (
                                <div className="prose prose-sm prose-slate max-w-none">
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
    onClose,
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
            if (zone === 'method') {
                await api.post('/workbench/analyze/method', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: '',
                });
            } else if (zone === 'asset') {
                await api.post('/workbench/analyze/asset', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: '',
                });
            } else {
                await api.post('/workbench/notes', {
                    text,
                    paper_id: paperId,
                    paper_title: paperTitle,
                    location: '',
                    is_title_note: false,
                    reflection: '',
                });
            }
            setWorkbenchStatus({ type: zone, success: true });
            setTimeout(() => setWorkbenchStatus(null), 2000);
        } catch (error) {
            console.error('Failed to add to workbench:', error);
            setWorkbenchStatus({ type: zone, success: false });
            setTimeout(() => setWorkbenchStatus(null), 2000);
        }
    }, [text, paperId, paperTitle]);

    const handleAction = useCallback(async (action: SmartAction) => {
        const windowPos = {
            x: Math.min(position.x + 50, window.innerWidth - 450),
            y: Math.min(position.y + 50, window.innerHeight - 400),
        };

        if (action.id === 'chat') {
            // 初始化 Chat with PDF
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

        // 其他分析类型
        setActiveWindow({
            type: action.id,
            title: action.label,
            icon: action.icon,
            content: '',
            isLoading: true,
            position: windowPos,
        });

        try {
            const response = await api.post('/workbench/analyze/smart', {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                action_type: action.id,
            });

            setActiveWindow(prev => prev ? {
                ...prev,
                content: response.data.result || response.data.analysis || '分析完成',
                isLoading: false,
            } : null);
        } catch (error) {
            setActiveWindow(prev => prev ? {
                ...prev,
                content: `分析失败: ${(error as Error).message}`,
                isLoading: false,
            } : null);
        }
    }, [text, paperId, paperTitle, position]);

    const handleChatMessage = useCallback(async (message: string) => {
        setChatHistory(prev => [...prev, { role: 'user', content: message }]);
        setIsChatLoading(true);

        try {
            const response = await api.post('/workbench/analyze/smart', {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                action_type: 'chat',
                context: fullContent?.slice(0, 8000),
                chat_history: chatHistory,
                user_message: message,
            });

            setChatHistory(prev => [
                ...prev,
                { role: 'assistant', content: response.data.result || '抱歉，我无法回答这个问题。' },
            ]);
        } catch (error) {
            setChatHistory(prev => [
                ...prev,
                { role: 'assistant', content: `出错了: ${(error as Error).message}` },
            ]);
        } finally {
            setIsChatLoading(false);
        }
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
                <div className="flex items-center gap-1 bg-white rounded-full shadow-xl border border-slate-200 px-2 py-1.5">
                    {/* 智能分析按钮 */}
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            onClick={() => handleAction(action)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-full transition-all"
                            title={action.label}
                        >
                            <span className="text-base">{action.icon}</span>
                            <span className="hidden sm:inline">{action.label}</span>
                        </button>
                    ))}

                    {/* 分隔线 */}
                    <div className="w-px h-5 bg-slate-200 mx-1" />

                    {/* 工作台快捷按钮 */}
                    <button
                        onClick={() => handleWorkbenchAdd('method')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
                        title="添加到方法炼金台"
                    >
                        <span className="text-sm">🔬</span>
                        <span className="hidden lg:inline">方法</span>
                    </button>
                    <button
                        onClick={() => handleWorkbenchAdd('asset')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-full transition-all"
                        title="添加到资产仓库"
                    >
                        <span className="text-sm">📊</span>
                        <span className="hidden lg:inline">资产</span>
                    </button>
                    <button
                        onClick={() => handleWorkbenchAdd('note')}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded-full transition-all"
                        title="添加到智能笔记"
                    >
                        <span className="text-sm">💡</span>
                        <span className="hidden lg:inline">笔记</span>
                    </button>

                    {/* 分隔线 */}
                    <div className="w-px h-5 bg-slate-200 mx-1" />

                    {/* 关闭按钮 */}
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* 工作台操作反馈 */}
                {workbenchStatus && (
                    <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg animate-in fade-in zoom-in-95 ${workbenchStatus.success
                            ? 'bg-green-500 text-white'
                            : 'bg-red-500 text-white'
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
