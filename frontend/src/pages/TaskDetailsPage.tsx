/**
 * TaskDetailsPage - 任务详情页面
 * 
 * 功能：
 * - 显示任务详情
 * - 分配成员
 * - 提交阅读总结
 * - 查看其他成员总结
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Loader2,
    Calendar,
    Users,
    AlertCircle,
    CheckCircle2,
    Clock,
    PlayCircle,
    FileText,
    Send,
} from 'lucide-react';
import { tasksApi, teamsApi } from '../lib/api';
import type { ReadingTask, TaskAssignee, TeamMember, AssigneeStatus } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// ================== Assignee Card Component ==================

interface AssigneeCardProps {
    assignee: TaskAssignee;
    isCurrentUser: boolean;
    onStartReading: () => void;
    onSubmitSummary: () => void;
    onApproveSummary: () => void;
    canApprove: boolean;
}

function AssigneeCard({
    assignee,
    isCurrentUser,
    onStartReading,
    onSubmitSummary,
    onApproveSummary,
    canApprove,
}: AssigneeCardProps) {
    const displayName = assignee.user?.username || assignee.user?.email?.split('@')[0] || '未知用户';

    const statusColors: Record<AssigneeStatus, string> = {
        assigned: 'bg-gray-100 text-gray-600',
        reading: 'bg-blue-100 text-blue-600',
        submitted: 'bg-yellow-100 text-yellow-600',
        approved: 'bg-green-100 text-green-600',
    };

    const statusLabels: Record<AssigneeStatus, string> = {
        assigned: '待开始',
        reading: '阅读中',
        submitted: '已提交',
        approved: '已通过',
    };

    return (
        <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                    <div className="font-medium text-content-main">{displayName}</div>
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${statusColors[assignee.status]}`}>
                        {statusLabels[assignee.status]}
                    </span>
                </div>
            </div>

            {/* Actions for current user */}
            {isCurrentUser && assignee.status === 'assigned' && (
                <button
                    onClick={onStartReading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    <PlayCircle className="w-4 h-4" />
                    开始阅读
                </button>
            )}

            {isCurrentUser && assignee.status === 'reading' && (
                <button
                    onClick={onSubmitSummary}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors"
                >
                    <Send className="w-4 h-4" />
                    提交总结
                </button>
            )}

            {/* Summary display */}
            {assignee.summary && (
                <div className="mt-3 p-3 bg-surface-elevated rounded-lg">
                    <div className="text-xs text-content-muted mb-1">阅读总结</div>
                    <div className="text-sm text-content-main whitespace-pre-wrap">
                        {assignee.summary.substring(0, 500)}
                        {assignee.summary.length > 500 ? '...' : ''}
                    </div>
                </div>
            )}

            {/* Approve button for admins */}
            {canApprove && assignee.status === 'submitted' && (
                <button
                    onClick={onApproveSummary}
                    className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                    <CheckCircle2 className="w-4 h-4" />
                    批准总结
                </button>
            )}
        </div>
    );
}

// ================== Submit Summary Dialog ==================

interface SubmitSummaryDialogProps {
    taskId: string;
    userId: string;
    onClose: () => void;
    onSubmitted: () => void;
}

function SubmitSummaryDialog({ taskId, userId, onClose, onSubmitted }: SubmitSummaryDialogProps) {
    const [summary, setSummary] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!summary.trim()) return;

        setIsSubmitting(true);
        try {
            await tasksApi.submitSummary(taskId, userId, { summary: summary.trim() });
            onSubmitted();
            onClose();
        } catch (error) {
            console.error('Failed to submit summary:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="bg-surface rounded-xl shadow-2xl border border-border w-full max-w-2xl p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-semibold text-content-main mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    提交阅读总结
                </h2>

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-content-main mb-2">
                            总结内容 *
                        </label>
                        <textarea
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="请总结论文的主要贡献、方法、局限性等..."
                            rows={12}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content-main focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                            required
                        />
                        <div className="text-xs text-content-muted mt-1">
                            建议包含：主要贡献、研究方法、实验结果、局限性、个人见解
                        </div>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={!summary.trim() || isSubmitting}
                            className="px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            提交总结
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ================== Main TaskDetailsPage ==================

export default function TaskDetailsPage() {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [task, setTask] = useState<ReadingTask | null>(null);
    const [_members, setMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showSummaryDialog, setShowSummaryDialog] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    const loadData = useCallback(async () => {
        if (!taskId) return;

        setIsLoading(true);
        setError(null);

        try {
            const taskData = await tasksApi.get(taskId);
            setTask(taskData);

            // Load team members and check admin status
            const membersData = await teamsApi.getMembers(taskData.team_id);
            setMembers(membersData);

            const currentMember = membersData.find(m => m.user_id === user?.id);
            setIsAdmin(currentMember?.role === 'owner' || currentMember?.role === 'admin');
        } catch (err) {
            console.error('Failed to load task:', err);
            setError('加载失败');
        } finally {
            setIsLoading(false);
        }
    }, [taskId, user?.id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleStartReading = async () => {
        if (!taskId || !user?.id) return;
        try {
            await tasksApi.startReading(taskId, user.id);
            loadData();
        } catch (error) {
            console.error('Failed to start reading:', error);
        }
    };

    const handleApproveSummary = async (userId: string) => {
        if (!taskId) return;
        try {
            await tasksApi.approveSummary(taskId, userId);
            loadData();
        } catch (error) {
            console.error('Failed to approve summary:', error);
        }
    };

    const priorityColors: Record<string, string> = {
        low: 'bg-gray-100 text-gray-600',
        medium: 'bg-blue-100 text-blue-600',
        high: 'bg-orange-100 text-orange-600',
        urgent: 'bg-red-100 text-red-600',
    };

    const priorityLabels: Record<string, string> = {
        low: '低优先级',
        medium: '中优先级',
        high: '高优先级',
        urgent: '紧急',
    };

    const statusLabels: Record<string, string> = {
        pending: '待开始',
        in_progress: '进行中',
        completed: '已完成',
        cancelled: '已取消',
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    if (error || !task) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <AlertCircle className="w-12 h-12 text-error" />
                <p className="text-content-muted">{error || '任务不存在'}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-primary text-primary-content rounded-lg"
                >
                    返回
                </button>
            </div>
        );
    }



    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b border-border bg-surface sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div className="flex-1">
                            <h1 className="text-xl font-semibold text-content-main">
                                {task.title}
                            </h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`px-2 py-0.5 text-xs rounded ${priorityColors[task.priority]}`}>
                                    {priorityLabels[task.priority]}
                                </span>
                                <span className="text-sm text-content-muted">
                                    {statusLabels[task.status]}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 py-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Description */}
                        {task.description && (
                            <div className="bg-surface rounded-xl border border-border p-6">
                                <h2 className="font-medium text-content-main mb-3">任务描述</h2>
                                <p className="text-content-muted whitespace-pre-wrap">
                                    {task.description}
                                </p>
                            </div>
                        )}

                        {/* Assignees */}
                        <div className="bg-surface rounded-xl border border-border p-6">
                            <h2 className="font-medium text-content-main mb-4 flex items-center gap-2">
                                <Users className="w-5 h-5" />
                                分配成员 ({task.assignees.length})
                            </h2>

                            {task.assignees.length === 0 ? (
                                <p className="text-content-muted text-sm">暂无分配成员</p>
                            ) : (
                                <div className="space-y-3">
                                    {task.assignees.map((assignee) => (
                                        <AssigneeCard
                                            key={assignee.id}
                                            assignee={assignee}
                                            isCurrentUser={assignee.user_id === user?.id}
                                            onStartReading={handleStartReading}
                                            onSubmitSummary={() => setShowSummaryDialog(true)}
                                            onApproveSummary={() => handleApproveSummary(assignee.user_id)}
                                            canApprove={isAdmin}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-4">
                        {/* Task Info */}
                        <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
                            <div>
                                <div className="text-xs text-content-muted mb-1">截止日期</div>
                                <div className="flex items-center gap-2 text-sm text-content-main">
                                    <Calendar className="w-4 h-4" />
                                    {task.due_date
                                        ? new Date(task.due_date).toLocaleDateString('zh-CN')
                                        : '未设置'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-content-muted mb-1">创建时间</div>
                                <div className="flex items-center gap-2 text-sm text-content-main">
                                    <Clock className="w-4 h-4" />
                                    {task.created_at
                                        ? new Date(task.created_at).toLocaleDateString('zh-CN')
                                        : '-'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Submit Summary Dialog */}
            {showSummaryDialog && taskId && user?.id && (
                <SubmitSummaryDialog
                    taskId={taskId}
                    userId={user.id}
                    onClose={() => setShowSummaryDialog(false)}
                    onSubmitted={loadData}
                />
            )}
        </div>
    );
}
