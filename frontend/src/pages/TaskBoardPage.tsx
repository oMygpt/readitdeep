/**
 * TaskBoard - 任务看板页面
 * 
 * 功能：
 * - 三栏看板布局 (待开始/进行中/已完成)
 * - 任务卡片展示
 * - 创建/编辑任务
 * - 分配任务
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Plus,
    Loader2,
    Calendar,
    Users,
    AlertCircle,
    CheckCircle2,
    Clock,
    PlayCircle,
    MoreVertical,
    Trash2,
    Edit,
} from 'lucide-react';
import { tasksApi, teamsApi } from '../lib/api';
import type { ReadingTask, ReadingTaskStatus, TaskPriority, Team, TeamMember } from '../lib/api';

// ================== Task Card Component ==================

interface TaskCardProps {
    task: ReadingTask;
    onEdit: (task: ReadingTask) => void;
    onDelete: (taskId: string) => void;
    onViewDetails: (task: ReadingTask) => void;
}

function TaskCard({ task, onEdit, onDelete, onViewDetails }: TaskCardProps) {
    const [showMenu, setShowMenu] = useState(false);

    const priorityColors: Record<TaskPriority, string> = {
        low: 'bg-gray-100 text-gray-600',
        medium: 'bg-blue-100 text-blue-600',
        high: 'bg-orange-100 text-orange-600',
        urgent: 'bg-red-100 text-red-600',
    };

    const priorityLabels: Record<TaskPriority, string> = {
        low: '低',
        medium: '中',
        high: '高',
        urgent: '紧急',
    };

    const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

    return (
        <div
            className="bg-surface rounded-lg border border-border p-3 hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => onViewDetails(task)}
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="text-sm font-medium text-content-main line-clamp-2 flex-1">
                    {task.title}
                </h4>
                <div className="relative">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(!showMenu);
                        }}
                        className="p-1 text-content-muted hover:text-content-main opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <div
                            className="absolute right-0 top-6 z-10 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={() => { onEdit(task); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-content-main hover:bg-surface-elevated"
                            >
                                <Edit className="w-4 h-4" />
                                编辑
                            </button>
                            <button
                                onClick={() => { onDelete(task.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-error hover:bg-error/10"
                            >
                                <Trash2 className="w-4 h-4" />
                                删除
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Description */}
            {task.description && (
                <p className="text-xs text-content-muted line-clamp-2 mb-2">
                    {task.description}
                </p>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* Priority */}
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priorityColors[task.priority]}`}>
                    {priorityLabels[task.priority]}
                </span>

                {/* Due date */}
                {task.due_date && (
                    <span className={`flex items-center gap-1 text-[10px] ${isOverdue ? 'text-error' : 'text-content-muted'}`}>
                        <Calendar className="w-3 h-3" />
                        {new Date(task.due_date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    </span>
                )}

                {/* Assignees */}
                {task.assignee_count > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-content-muted ml-auto">
                        <Users className="w-3 h-3" />
                        {task.assignee_count}
                    </span>
                )}
            </div>
        </div>
    );
}

// ================== Task Column Component ==================

interface TaskColumnProps {
    title: string;
    status: ReadingTaskStatus;
    tasks: ReadingTask[];
    icon: React.ReactNode;
    color: string;
    onEdit: (task: ReadingTask) => void;
    onDelete: (taskId: string) => void;
    onViewDetails: (task: ReadingTask) => void;
}

function TaskColumn({ title, tasks, icon, color, onEdit, onDelete, onViewDetails }: TaskColumnProps) {
    return (
        <div className={`flex flex-col rounded-xl border ${color} overflow-hidden h-full`}>
            {/* Column header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                {icon}
                <span className="font-medium text-content-main">{title}</span>
                <span className="ml-auto px-2 py-0.5 bg-surface-elevated rounded-full text-xs text-content-muted">
                    {tasks.length}
                </span>
            </div>

            {/* Tasks list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {tasks.length === 0 ? (
                    <div className="text-center text-content-muted text-sm py-8">
                        暂无任务
                    </div>
                ) : (
                    tasks.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onViewDetails={onViewDetails}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// ================== Create Task Dialog ==================

interface CreateTaskDialogProps {
    teamId: string;
    members: TeamMember[];
    onClose: () => void;
    onCreated: () => void;
}

function CreateTaskDialog({ teamId, members, onClose, onCreated }: CreateTaskDialogProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [dueDate, setDueDate] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        setIsSubmitting(true);
        try {
            await tasksApi.create(teamId, {
                title: title.trim(),
                description: description.trim() || undefined,
                priority,
                due_date: dueDate || undefined,
                assignee_ids: selectedMembers.length > 0 ? selectedMembers : undefined,
            });
            onCreated();
            onClose();
        } catch (error) {
            console.error('Failed to create task:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleMember = (userId: string) => {
        setSelectedMembers(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="bg-surface rounded-xl shadow-2xl border border-border w-full max-w-lg p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-semibold text-content-main mb-4">创建阅读任务</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Title */}
                    <div>
                        <label className="block text-sm font-medium text-content-main mb-1">
                            任务标题 *
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="例如：阅读 Attention is All You Need"
                            className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content-main focus:outline-none focus:ring-2 focus:ring-primary"
                            required
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-content-main mb-1">
                            描述
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="任务描述..."
                            rows={3}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content-main focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                    </div>

                    {/* Priority & Due Date */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1">
                                优先级
                            </label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                                className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content-main focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="low">低</option>
                                <option value="medium">中</option>
                                <option value="high">高</option>
                                <option value="urgent">紧急</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1">
                                截止日期
                            </label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content-main focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>

                    {/* Assign Members */}
                    <div>
                        <label className="block text-sm font-medium text-content-main mb-2">
                            分配成员
                        </label>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                            {members.map((member) => {
                                const displayName = member.username || member.email?.split('@')[0] || '未知';
                                const isSelected = selectedMembers.includes(member.user_id);
                                return (
                                    <button
                                        key={member.user_id}
                                        type="button"
                                        onClick={() => toggleMember(member.user_id)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm transition-colors ${isSelected
                                            ? 'bg-primary text-primary-content'
                                            : 'bg-surface-elevated text-content-main hover:bg-surface-elevated/80'
                                            }`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold">
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                        {displayName}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={!title.trim() || isSubmitting}
                            className="px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            创建任务
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ================== Main TaskBoard Page ==================

export default function TaskBoardPage() {
    const { teamId } = useParams<{ teamId: string }>();
    const navigate = useNavigate();

    const [team, setTeam] = useState<Team | null>(null);
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [tasks, setTasks] = useState<ReadingTask[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);

    // Load data
    const loadData = useCallback(async () => {
        if (!teamId) return;

        setIsLoading(true);
        setError(null);

        try {
            const [teamData, membersData, tasksData] = await Promise.all([
                teamsApi.get(teamId),
                teamsApi.getMembers(teamId),
                tasksApi.listByTeam(teamId),
            ]);

            setTeam(teamData);
            setMembers(membersData);
            setTasks(tasksData);
        } catch (err) {
            console.error('Failed to load task board:', err);
            setError('加载失败');
        } finally {
            setIsLoading(false);
        }
    }, [teamId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Group tasks by status
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    // Handlers
    const handleEdit = (task: ReadingTask) => {
        // TODO: Implement edit dialog
        console.log('Edit task:', task);
    };

    const handleDelete = async (taskId: string) => {
        if (!confirm('确定要删除这个任务吗？')) return;

        try {
            await tasksApi.delete(taskId);
            setTasks(prev => prev.filter(t => t.id !== taskId));
        } catch (error) {
            console.error('Failed to delete task:', error);
        }
    };

    const handleViewDetails = (task: ReadingTask) => {
        // Navigate to task details
        navigate(`/tasks/${task.id}`);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <AlertCircle className="w-12 h-12 text-error" />
                <p className="text-content-muted">{error}</p>
                <button
                    onClick={loadData}
                    className="px-4 py-2 bg-primary text-primary-content rounded-lg"
                >
                    重试
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b border-border bg-surface sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/teams')}
                            className="p-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div className="flex-1">
                            <h1 className="text-xl font-semibold text-content-main">
                                {team?.name} - 任务看板
                            </h1>
                            <p className="text-sm text-content-muted">
                                {tasks.length} 个任务 · {members.length} 个成员
                            </p>
                        </div>
                        <button
                            onClick={() => setShowCreateDialog(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            新建任务
                        </button>
                    </div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="max-w-7xl mx-auto px-4 py-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-180px)]">
                    <TaskColumn
                        title="待开始"
                        status="pending"
                        tasks={pendingTasks}
                        icon={<Clock className="w-5 h-5 text-gray-500" />}
                        color="border-gray-200 bg-gray-50/50"
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onViewDetails={handleViewDetails}
                    />
                    <TaskColumn
                        title="进行中"
                        status="in_progress"
                        tasks={inProgressTasks}
                        icon={<PlayCircle className="w-5 h-5 text-blue-500" />}
                        color="border-blue-200 bg-blue-50/50"
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onViewDetails={handleViewDetails}
                    />
                    <TaskColumn
                        title="已完成"
                        status="completed"
                        tasks={completedTasks}
                        icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
                        color="border-green-200 bg-green-50/50"
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onViewDetails={handleViewDetails}
                    />
                </div>
            </div>

            {/* Create Task Dialog */}
            {showCreateDialog && teamId && (
                <CreateTaskDialog
                    teamId={teamId}
                    members={members}
                    onClose={() => setShowCreateDialog(false)}
                    onCreated={loadData}
                />
            )}
        </div>
    );
}
