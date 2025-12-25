/**
 * HighlightOverlay - 高亮渲染与交互组件
 * 
 * 功能：
 * - 在内容中渲染已保存的高亮
 * - 悬停显示标注者信息
 * - 高亮筛选功能
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, User, Users, Eye, EyeOff, Trash2, MessageCircle, Send, Loader2, MessagesSquare } from 'lucide-react';
import { getHighlightBackgroundColor } from '../lib/highlight';
import { annotationsApi } from '../lib/api';
import type { Annotation } from '../lib/api';
import DiscussionThread from './DiscussionThread';

// ================== Types ==================

interface HighlightOverlayProps {
    annotations: Annotation[];
    contentRef: React.RefObject<HTMLElement>;
    currentUserId?: string;
    paperId?: string;
    onDeleteAnnotation?: (annotationId: string) => void;
    onAnnotationChanged?: () => void;  // Callback when annotations change (reply added)
}

interface HighlightMark {
    annotation: Annotation;
    elements: HTMLElement[];
}

type FilterMode = 'all' | 'mine' | 'others';

// ================== Helper Functions ==================

/**
 * 在 DOM 中查找包含指定文本的元素
 */
function findTextInDOM(container: HTMLElement, searchText: string): Range | null {
    if (!searchText || searchText.length < 5) return null;

    const treeWalker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
    );

    // 规范化搜索文本
    const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
    const searchWords = normalizedSearch.split(' ').slice(0, 10); // 只取前10个词

    let node: Text | null;
    while ((node = treeWalker.nextNode() as Text)) {
        const nodeText = node.textContent?.replace(/\s+/g, ' ').toLowerCase() || '';

        // 检查是否包含搜索词的开头部分
        const firstWords = searchWords.slice(0, 5).join(' ');
        const startIndex = nodeText.indexOf(firstWords);

        if (startIndex !== -1) {
            try {
                const range = document.createRange();
                // 找到匹配的起始位置
                const matchLength = Math.min(searchText.length, node.length - startIndex);
                range.setStart(node, startIndex);
                range.setEnd(node, Math.min(startIndex + matchLength, node.length));
                return range;
            } catch (e) {
                continue;
            }
        }
    }

    return null;
}

/**
 * 为指定范围创建高亮标记
 */
function createHighlightMark(range: Range, annotation: Annotation): HTMLElement[] {
    const elements: HTMLElement[] = [];

    try {
        // 使用 CSS 高亮而不是包装元素，避免破坏 DOM 结构
        const rects = range.getClientRects();

        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            const mark = document.createElement('div');
            mark.className = 'highlight-mark';
            mark.dataset.annotationId = annotation.id;
            mark.dataset.userId = annotation.user_id;
            mark.style.cssText = `
                position: absolute;
                left: ${rect.left}px;
                top: ${rect.top}px;
                width: ${rect.width}px;
                height: ${rect.height}px;
                background-color: ${getHighlightBackgroundColor(annotation.color || '#FFE082', 0.35)};
                pointer-events: auto;
                cursor: pointer;
                border-radius: 2px;
                transition: background-color 0.2s ease;
                z-index: 1;
            `;
            elements.push(mark);
        }
    } catch (e) {
        console.warn('Failed to create highlight mark:', e);
    }

    return elements;
}

// ================== Tooltip Component ==================

interface HighlightTooltipProps {
    annotation: Annotation;
    position: { x: number; y: number };
    onClose: () => void;
    onDelete?: () => void;
    onReply?: () => void;
    onViewThread?: () => void;
    canDelete: boolean;
}

function HighlightTooltip({
    annotation,
    position,
    onClose,
    onDelete,
    onReply,
    onViewThread,
    canDelete
}: HighlightTooltipProps) {
    const user = annotation.user;
    const displayName = user?.username || user?.email?.split('@')[0] || '未知用户';
    const createdAt = annotation.created_at
        ? new Date(annotation.created_at).toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : '';

    return (
        <div
            className="fixed z-[200] bg-surface rounded-xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{
                left: Math.min(position.x, window.innerWidth - 280),
                top: Math.min(position.y + 10, window.innerHeight - 200),
                minWidth: '240px',
                maxWidth: '320px',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div
                className="px-3 py-2 flex items-center justify-between"
                style={{ backgroundColor: getHighlightBackgroundColor(annotation.color || '#FFE082', 0.2) }}
            >
                <div className="flex items-center gap-2">
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: annotation.color || '#FFE082' }}
                    >
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="text-sm font-medium text-content-main">{displayName}</div>
                        <div className="text-xs text-content-muted">{createdAt}</div>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-black/10 rounded transition-colors"
                >
                    <X className="w-4 h-4 text-content-muted" />
                </button>
            </div>

            {/* Content */}
            {annotation.content && (
                <div className="px-3 py-2 text-sm text-content-main border-t border-border">
                    {annotation.content}
                </div>
            )}

            {/* Selected Text Preview */}
            <div className="px-3 py-2 border-t border-border">
                <div className="text-xs text-content-muted mb-1">高亮内容</div>
                <div className="text-sm text-content-main line-clamp-2 italic">
                    "{annotation.selected_text?.substring(0, 100)}{(annotation.selected_text?.length || 0) > 100 ? '...' : ''}"
                </div>
            </div>

            {/* Actions */}
            <div className="px-3 py-2 border-t border-border flex items-center gap-2">
                {annotation.replies_count > 0 && onViewThread && (
                    <button
                        onClick={onViewThread}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-colors"
                    >
                        <MessagesSquare className="w-3.5 h-3.5" />
                        查看讨论 ({annotation.replies_count})
                    </button>
                )}
                {onReply && (
                    <button
                        onClick={onReply}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                    >
                        <MessageCircle className="w-3.5 h-3.5" />
                        回复
                    </button>
                )}
                {canDelete && onDelete && (
                    <button
                        onClick={onDelete}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 rounded transition-colors ml-auto"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                    </button>
                )}
            </div>
        </div>
    );
}

// ================== Reply Dialog Component ==================

interface ReplyDialogProps {
    annotation: Annotation;
    paperId: string;
    position: { x: number; y: number };
    onClose: () => void;
    onSuccess: () => void;
}

function ReplyDialog({ annotation, paperId: _paperId, position, onClose, onSuccess }: ReplyDialogProps) {
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = async () => {
        if (!content.trim() || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await annotationsApi.reply(annotation.id, {
                content: content.trim(),
            });
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Failed to reply:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed z-[200] bg-surface rounded-xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{
                left: Math.min(position.x, window.innerWidth - 340),
                top: Math.min(position.y + 10, window.innerHeight - 250),
                width: '320px',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="px-3 py-2 flex items-center justify-between bg-primary/10">
                <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-content-main">回复高亮</span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-black/10 rounded transition-colors"
                >
                    <X className="w-4 h-4 text-content-muted" />
                </button>
            </div>

            {/* Original highlight preview */}
            <div className="px-3 py-2 border-b border-border bg-surface-elevated">
                <div className="text-xs text-content-muted mb-1">原文</div>
                <div className="text-sm text-content-main line-clamp-2 italic">
                    "{annotation.selected_text?.substring(0, 80)}{(annotation.selected_text?.length || 0) > 80 ? '...' : ''}"
                </div>
            </div>

            {/* Reply input */}
            <div className="p-3">
                <textarea
                    ref={inputRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="输入您的回复..."
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-content-main resize-none"
                    rows={3}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            handleSubmit();
                        }
                    }}
                />
                <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-content-muted">Cmd+Enter 发送</span>
                    <button
                        onClick={handleSubmit}
                        disabled={!content.trim() || isSubmitting}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    >
                        {isSubmitting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                        发送
                    </button>
                </div>
            </div>
        </div>
    );
}

// ================== Filter Component ==================

interface HighlightFilterProps {
    mode: FilterMode;
    onModeChange: (mode: FilterMode) => void;
    annotations: Annotation[];
    currentUserId?: string;
    isVisible: boolean;
    onToggleVisibility: () => void;
}

function HighlightFilter({
    mode,
    onModeChange,
    annotations,
    currentUserId,
    isVisible,
    onToggleVisibility
}: HighlightFilterProps) {
    const myCount = annotations.filter(a => a.user_id === currentUserId).length;
    const othersCount = annotations.filter(a => a.user_id !== currentUserId).length;

    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-elevated rounded-lg border border-border shadow-sm">
            {/* Visibility Toggle */}
            <button
                onClick={onToggleVisibility}
                className={`p-1.5 rounded transition-colors ${isVisible
                    ? 'text-primary bg-primary/10'
                    : 'text-content-muted hover:bg-surface'
                    }`}
                title={isVisible ? '隐藏高亮' : '显示高亮'}
            >
                {isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            <div className="w-px h-5 bg-border" />

            {/* Filter Buttons */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onModeChange('all')}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${mode === 'all'
                        ? 'bg-primary text-primary-content'
                        : 'text-content-muted hover:bg-surface'
                        }`}
                >
                    <Users className="w-3.5 h-3.5" />
                    全部 ({annotations.length})
                </button>
                <button
                    onClick={() => onModeChange('mine')}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${mode === 'mine'
                        ? 'bg-primary text-primary-content'
                        : 'text-content-muted hover:bg-surface'
                        }`}
                >
                    <User className="w-3.5 h-3.5" />
                    我的 ({myCount})
                </button>
                <button
                    onClick={() => onModeChange('others')}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${mode === 'others'
                        ? 'bg-primary text-primary-content'
                        : 'text-content-muted hover:bg-surface'
                        }`}
                >
                    他人 ({othersCount})
                </button>
            </div>
        </div>
    );
}

// ================== Main Component ==================

export default function HighlightOverlay({
    annotations,
    contentRef,
    currentUserId,
    paperId,
    onDeleteAnnotation,
    onAnnotationChanged,
}: HighlightOverlayProps) {
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [isVisible, setIsVisible] = useState(true);
    const [hoveredAnnotation, setHoveredAnnotation] = useState<{
        annotation: Annotation;
        position: { x: number; y: number };
    } | null>(null);
    const [replyingAnnotation, setReplyingAnnotation] = useState<{
        annotation: Annotation;
        position: { x: number; y: number };
    } | null>(null);
    const [discussionAnnotation, setDiscussionAnnotation] = useState<Annotation | null>(null);
    const [highlightMarks, setHighlightMarks] = useState<HighlightMark[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);

    // Filter annotations based on mode
    const filteredAnnotations = useMemo(() => {
        if (!isVisible) return [];

        const highlights = annotations.filter(a => a.type === 'highlight');

        switch (filterMode) {
            case 'mine':
                return highlights.filter(a => a.user_id === currentUserId);
            case 'others':
                return highlights.filter(a => a.user_id !== currentUserId);
            default:
                return highlights;
        }
    }, [annotations, filterMode, currentUserId, isVisible]);

    // Create highlight marks in the DOM
    useEffect(() => {
        if (!contentRef.current || !isVisible) {
            // Clear existing marks
            highlightMarks.forEach(mark => {
                mark.elements.forEach(el => el.remove());
            });
            setHighlightMarks([]);
            return;
        }

        // Clear previous marks
        highlightMarks.forEach(mark => {
            mark.elements.forEach(el => el.remove());
        });

        // Create new marks
        const newMarks: HighlightMark[] = [];

        filteredAnnotations.forEach(annotation => {
            if (!annotation.selected_text) return;

            const range = findTextInDOM(contentRef.current!, annotation.selected_text);
            if (range) {
                const elements = createHighlightMark(range, annotation);
                if (elements.length > 0) {
                    // Add to overlay
                    elements.forEach(el => {
                        overlayRef.current?.appendChild(el);

                        // Add hover handlers
                        el.addEventListener('mouseenter', (e) => {
                            setHoveredAnnotation({
                                annotation,
                                position: { x: e.clientX, y: e.clientY }
                            });
                            // Brighten on hover
                            el.style.backgroundColor = getHighlightBackgroundColor(
                                annotation.color || '#FFE082',
                                0.5
                            );
                        });

                        el.addEventListener('mouseleave', () => {
                            el.style.backgroundColor = getHighlightBackgroundColor(
                                annotation.color || '#FFE082',
                                0.35
                            );
                        });
                    });

                    newMarks.push({ annotation, elements });
                }
            }
        });

        setHighlightMarks(newMarks);

        // Cleanup
        return () => {
            newMarks.forEach(mark => {
                mark.elements.forEach(el => el.remove());
            });
        };
    }, [filteredAnnotations, contentRef, isVisible]);

    // Update positions on scroll/resize
    useEffect(() => {
        const updatePositions = () => {
            if (!contentRef.current) return;

            highlightMarks.forEach(mark => {
                if (!mark.annotation.selected_text) return;

                const range = findTextInDOM(contentRef.current!, mark.annotation.selected_text);
                if (range) {
                    const rects = range.getClientRects();
                    mark.elements.forEach((el, i) => {
                        if (i < rects.length) {
                            const rect = rects[i];
                            el.style.left = `${rect.left}px`;
                            el.style.top = `${rect.top}px`;
                            el.style.width = `${rect.width}px`;
                            el.style.height = `${rect.height}px`;
                        }
                    });
                }
            });
        };

        window.addEventListener('scroll', updatePositions, true);
        window.addEventListener('resize', updatePositions);

        return () => {
            window.removeEventListener('scroll', updatePositions, true);
            window.removeEventListener('resize', updatePositions);
        };
    }, [highlightMarks, contentRef]);

    const handleDelete = useCallback(() => {
        if (hoveredAnnotation && onDeleteAnnotation) {
            onDeleteAnnotation(hoveredAnnotation.annotation.id);
            setHoveredAnnotation(null);
        }
    }, [hoveredAnnotation, onDeleteAnnotation]);

    const handleReply = useCallback(() => {
        if (hoveredAnnotation) {
            setReplyingAnnotation({
                annotation: hoveredAnnotation.annotation,
                position: hoveredAnnotation.position,
            });
            setHoveredAnnotation(null);
        }
    }, [hoveredAnnotation]);

    // Only show filter if there are highlights
    const hasHighlights = annotations.some(a => a.type === 'highlight');

    return (
        <>
            {/* Overlay container for highlight marks */}
            <div
                ref={overlayRef}
                className="fixed inset-0 pointer-events-none z-[5]"
                style={{ isolation: 'isolate' }}
            />

            {/* Filter bar */}
            {hasHighlights && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[50]">
                    <HighlightFilter
                        mode={filterMode}
                        onModeChange={setFilterMode}
                        annotations={annotations.filter(a => a.type === 'highlight')}
                        currentUserId={currentUserId}
                        isVisible={isVisible}
                        onToggleVisibility={() => setIsVisible(!isVisible)}
                    />
                </div>
            )}

            {/* Tooltip */}
            {hoveredAnnotation && (
                <HighlightTooltip
                    annotation={hoveredAnnotation.annotation}
                    position={hoveredAnnotation.position}
                    onClose={() => setHoveredAnnotation(null)}
                    onDelete={handleDelete}
                    onReply={handleReply}
                    onViewThread={() => {
                        setDiscussionAnnotation(hoveredAnnotation.annotation);
                        setHoveredAnnotation(null);
                    }}
                    canDelete={hoveredAnnotation.annotation.user_id === currentUserId}
                />
            )}

            {/* Reply Dialog */}
            {replyingAnnotation && paperId && (
                <ReplyDialog
                    annotation={replyingAnnotation.annotation}
                    paperId={paperId}
                    position={replyingAnnotation.position}
                    onClose={() => setReplyingAnnotation(null)}
                    onSuccess={() => {
                        setReplyingAnnotation(null);
                        onAnnotationChanged?.();
                    }}
                />
            )}

            {/* Discussion Thread Modal */}
            {discussionAnnotation && paperId && (
                <DiscussionThread
                    annotation={discussionAnnotation}
                    paperId={paperId}
                    currentUserId={currentUserId}
                    onClose={() => setDiscussionAnnotation(null)}
                    onAnnotationChanged={() => {
                        onAnnotationChanged?.();
                    }}
                />
            )}
        </>
    );
}

// Export sub-components for flexibility
export { HighlightFilter, HighlightTooltip };
export type { FilterMode, HighlightOverlayProps };
