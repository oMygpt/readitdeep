/**
 * DiscussionThread - 讨论线程组件
 * 
 * 功能：
 * - 显示高亮/笔记的回复列表
 * - 支持嵌套回复显示
 * - 添加新回复
 */

import { useState, useEffect } from 'react';
import {
    MessageCircle,
    X,
    Send,
    Loader2,
    ChevronDown,
    ChevronUp,
    Lock,
    Users,
    Reply,
} from 'lucide-react';
import { annotationsApi } from '../lib/api';
import type { Annotation } from '../lib/api';
import { getHighlightBackgroundColor } from '../lib/highlight';
import MentionInput, { renderMentionText } from './MentionInput';

interface DiscussionThreadProps {
    annotation: Annotation;
    paperId: string;
    currentUserId?: string;
    onClose: () => void;
    onAnnotationChanged?: () => void;
}

interface ReplyItemProps {
    reply: Annotation;
    depth: number;
    currentUserId?: string;
    onReplyToReply?: (replyId: string) => void;
    onDeleteReply?: (replyId: string) => void;
}

function ReplyItem({ reply, depth, currentUserId, onReplyToReply, onDeleteReply }: ReplyItemProps) {
    const user = reply.user;
    const displayName = user?.username || user?.email?.split('@')[0] || '未知用户';
    const createdAt = reply.created_at
        ? new Date(reply.created_at).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
        : '';
    const canDelete = reply.user_id === currentUserId;
    const maxDepth = 3;
    const bgClass = depth % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated';

    return (
        <div
            className={`${bgClass} rounded-lg p-3 ${depth > 0 ? 'ml-4 border-l-2 border-primary/20' : ''}`}
            style={{ marginLeft: Math.min(depth, maxDepth) * 16 }}
        >
            {/* Reply header */}
            <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                    {displayName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-content-main">{displayName}</span>
                <span className="text-xs text-content-muted">{createdAt}</span>
            </div>

            {/* Reply content */}
            <div className="text-sm text-content-main pl-8">
                {renderMentionText(reply.content || '')}
            </div>

            {/* Reply actions */}
            <div className="flex items-center gap-2 mt-2 pl-8">
                {onReplyToReply && (
                    <button
                        onClick={() => onReplyToReply(reply.id)}
                        className="flex items-center gap-1 text-xs text-content-muted hover:text-primary transition-colors"
                    >
                        <Reply className="w-3 h-3" />
                        回复
                    </button>
                )}
                {canDelete && onDeleteReply && (
                    <button
                        onClick={() => onDeleteReply(reply.id)}
                        className="flex items-center gap-1 text-xs text-content-muted hover:text-error transition-colors"
                    >
                        <X className="w-3 h-3" />
                        删除
                    </button>
                )}
            </div>

            {/* Nested replies - Note: In current implementation, replies don't have nested replies yet */}
        </div>
    );
}

export default function DiscussionThread({
    annotation,
    paperId: _paperId,
    currentUserId,
    onClose,
    onAnnotationChanged,
}: DiscussionThreadProps) {
    const [replies, setReplies] = useState<Annotation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newReply, setNewReply] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showReplies, setShowReplies] = useState(true);

    // Get team ID from annotation
    const teamId = annotation.team_id;

    const user = annotation.user;
    const displayName = user?.username || user?.email?.split('@')[0] || '未知用户';
    const isTeamVisible = annotation.visibility === 'team';
    const highlightColor = annotation.color || '#8B5CF6';

    // Load replies
    useEffect(() => {
        const loadReplies = async () => {
            try {
                const data = await annotationsApi.getReplies(annotation.id);
                setReplies(data);
            } catch (error) {
                console.error('Failed to load replies:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadReplies();
    }, [annotation.id]);

    const handleSubmitReply = async () => {
        if (!newReply.trim() || isSubmitting) return;
        setIsSubmitting(true);

        try {
            await annotationsApi.reply(annotation.id, {
                content: newReply.trim(),
            });

            // Reload replies
            const data = await annotationsApi.getReplies(annotation.id);
            setReplies(data);
            setNewReply('');
            onAnnotationChanged?.();
        } catch (error) {
            console.error('Failed to submit reply:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteReply = async (replyId: string) => {
        try {
            await annotationsApi.delete(replyId);
            setReplies(prev => prev.filter(r => r.id !== replyId));
            onAnnotationChanged?.();
        } catch (error) {
            console.error('Failed to delete reply:', error);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-in fade-in duration-200">
            <div
                className="bg-surface rounded-xl shadow-2xl border border-border overflow-hidden max-w-lg w-full max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-border bg-surface-elevated">
                    <div className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-primary" />
                        <span className="font-medium text-content-main">讨论线程</span>
                        <span className="text-xs text-content-muted">
                            {replies.length} 条回复
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-content-muted hover:text-content-main hover:bg-surface rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Original annotation */}
                <div className="px-4 py-3 border-b border-border">
                    {/* Type indicator */}
                    <div className="flex items-center gap-2 mb-2">
                        <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: highlightColor }}
                        />
                        <span className="text-xs font-medium text-content-muted">
                            {annotation.type === 'highlight' ? '高亮' : '笔记'}
                        </span>
                        {isTeamVisible ? (
                            <span className="flex items-center gap-0.5 text-xs text-purple-500">
                                <Users className="w-3 h-3" />
                                团队
                            </span>
                        ) : (
                            <span className="flex items-center gap-0.5 text-xs text-content-muted">
                                <Lock className="w-3 h-3" />
                                私密
                            </span>
                        )}
                    </div>

                    {/* Selected text */}
                    {annotation.selected_text && (
                        <div
                            className="p-2 rounded-lg mb-2 text-sm italic"
                            style={{ backgroundColor: getHighlightBackgroundColor(highlightColor, 0.15) }}
                        >
                            "{annotation.selected_text.substring(0, 200)}{annotation.selected_text.length > 200 ? '...' : ''}"
                        </div>
                    )}

                    {/* Note content */}
                    {annotation.content && (
                        <div className="text-sm text-content-main mb-2">
                            {annotation.content}
                        </div>
                    )}

                    {/* Author info */}
                    <div className="flex items-center gap-2 text-xs text-content-muted">
                        <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ backgroundColor: highlightColor }}
                        >
                            {displayName.charAt(0).toUpperCase()}
                        </div>
                        <span>{displayName}</span>
                        <span>·</span>
                        <span>
                            {annotation.created_at && new Date(annotation.created_at).toLocaleString('zh-CN', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </span>
                    </div>
                </div>

                {/* Replies section */}
                <div className="flex-1 overflow-y-auto">
                    {/* Toggle */}
                    <button
                        onClick={() => setShowReplies(!showReplies)}
                        className="w-full px-4 py-2 flex items-center justify-between hover:bg-surface-elevated transition-colors"
                    >
                        <span className="text-sm font-medium text-content-main">
                            回复 ({replies.length})
                        </span>
                        {showReplies ? (
                            <ChevronUp className="w-4 h-4 text-content-muted" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-content-muted" />
                        )}
                    </button>

                    {showReplies && (
                        <div className="px-4 pb-4 space-y-2">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                                </div>
                            ) : replies.length === 0 ? (
                                <div className="text-center py-8 text-content-muted text-sm">
                                    还没有回复，来第一个发言吧
                                </div>
                            ) : (
                                replies.map((reply) => (
                                    <ReplyItem
                                        key={reply.id}
                                        reply={reply}
                                        depth={0}
                                        currentUserId={currentUserId}
                                        onDeleteReply={handleDeleteReply}
                                    />
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Reply input */}
                <div className="px-4 py-3 border-t border-border bg-surface-elevated">
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <MentionInput
                                value={newReply}
                                onChange={setNewReply}
                                teamId={teamId}
                                placeholder="输入回复，@ 提及成员..."
                                rows={2}
                                onSubmit={handleSubmitReply}
                                disabled={isSubmitting}
                            />
                        </div>
                        <button
                            onClick={handleSubmitReply}
                            disabled={!newReply.trim() || isSubmitting}
                            className="px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-start"
                        >
                            {isSubmitting ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <Send className="w-5 h-5" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
