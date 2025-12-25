/**
 * Read it DEEP - Teams Page
 * 
 * 团队管理页面：
 * - 🏢 团队列表
 * - ➕ 创建团队
 * - 🔗 加入团队
 * - 📚 团队论文
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
    Users,
    Plus,
    ChevronRight,
    Link2,
    Loader2,
    BookOpen,
    Crown,
    Shield,
    User,
    LogOut,
    Check,
    ArrowLeft,
    UserPlus,
    ClipboardList,
    Trash2,
} from 'lucide-react';
import { teamsApi, type Team } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// ==================== 创建团队弹窗 ====================
function CreateTeamModal({
    isOpen,
    onClose,
    onSuccess
}: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const queryClient = useQueryClient();

    const createMutation = useMutation({
        mutationFn: () => teamsApi.create({ name, description: description || undefined }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            onSuccess();
            onClose();
            setName('');
            setDescription('');
        },
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 border border-border">
                <h2 className="text-xl font-bold text-content-main mb-4">创建团队</h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-content-main mb-1">
                            团队名称 *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例如：AI Research Lab"
                            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-content-main mb-1">
                            团队描述
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="描述团队的研究方向..."
                            rows={3}
                            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-content-muted hover:text-content-main transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => createMutation.mutate()}
                        disabled={!name.trim() || createMutation.isPending}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        创建
                    </button>
                </div>
            </div>
        </div>
    );
}

// ==================== 加入团队弹窗 ====================
function JoinTeamModal({
    isOpen,
    onClose,
    onSuccess
}: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [inviteCode, setInviteCode] = useState('');
    const queryClient = useQueryClient();

    const joinMutation = useMutation({
        mutationFn: () => teamsApi.joinByCode(inviteCode),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            onSuccess();
            onClose();
            setInviteCode('');
        },
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 border border-border">
                <h2 className="text-xl font-bold text-content-main mb-4">加入团队</h2>

                <div>
                    <label className="block text-sm font-medium text-content-main mb-1">
                        邀请码
                    </label>
                    <input
                        type="text"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="粘贴邀请码..."
                        className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>

                {joinMutation.error && (
                    <p className="text-error text-sm mt-2">
                        {(joinMutation.error as Error).message || '加入失败'}
                    </p>
                )}

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-content-muted hover:text-content-main transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => joinMutation.mutate()}
                        disabled={!inviteCode.trim() || joinMutation.isPending}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {joinMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        加入
                    </button>
                </div>
            </div>
        </div>
    );
}

// ==================== 团队卡片 ====================
function TeamCard({
    team,
    onClick
}: {
    team: Team;
    onClick: () => void;
}) {
    const roleIcon = {
        owner: <Crown className="w-4 h-4 text-amber-500" />,
        admin: <Shield className="w-4 h-4 text-blue-500" />,
        member: <User className="w-4 h-4 text-content-muted" />,
        guest: <User className="w-4 h-4 text-content-dim" />,
    };

    const roleLabel = {
        owner: '创建者',
        admin: '管理员',
        member: '成员',
        guest: '访客',
    };

    return (
        <button
            onClick={onClick}
            className="w-full p-4 bg-surface rounded-xl border border-border hover:border-primary/30 hover:shadow-md transition-all text-left group"
        >
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Users className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-content-main truncate group-hover:text-primary transition-colors">
                        {team.name}
                    </h3>
                    {team.description && (
                        <p className="text-sm text-content-muted line-clamp-2 mt-1">
                            {team.description}
                        </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-content-dim">
                        <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {team.member_count} 人
                        </span>
                        {team.my_role && (
                            <span className="flex items-center gap-1">
                                {roleIcon[team.my_role as keyof typeof roleIcon]}
                                {roleLabel[team.my_role as keyof typeof roleLabel]}
                            </span>
                        )}
                    </div>
                </div>
                <ChevronRight className="w-5 h-5 text-content-dim group-hover:text-primary transition-colors" />
            </div>
        </button>
    );
}

// ==================== 团队详情页面 ====================
function TeamDetailView({
    teamId,
    onBack
}: {
    teamId: string;
    onBack: () => void;
}) {
    const [copiedCode, setCopiedCode] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const navigate = useNavigate();

    const { data: team, isLoading: teamLoading } = useQuery({
        queryKey: ['team', teamId],
        queryFn: () => teamsApi.get(teamId),
    });

    const { data: members, isLoading: membersLoading } = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => teamsApi.getMembers(teamId),
    });

    const { data: papers } = useQuery({
        queryKey: ['team-papers', teamId],
        queryFn: () => teamsApi.getTeamPapers(teamId),
    });

    const createInviteMutation = useMutation({
        mutationFn: () => teamsApi.createInvitation(teamId, { expires_days: 7 }),
        onSuccess: (data) => {
            navigator.clipboard.writeText(data.invite_code);
            setCopiedCode(data.invite_code);
            setTimeout(() => setCopiedCode(null), 3000);
        },
    });

    const leaveMutation = useMutation({
        mutationFn: () => teamsApi.removeMember(teamId, user?.id || ''),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            onBack();
        },
    });

    const unshareMutation = useMutation({
        mutationFn: (paperId: string) => teamsApi.unsharePaper(paperId, teamId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['team-papers', teamId] });
        },
    });

    if (teamLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!team) {
        return <div className="text-center py-10 text-content-muted">团队不存在</div>;
    }

    const isAdmin = team.my_role === 'owner' || team.my_role === 'admin';
    const isOwner = team.my_role === 'owner';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-surface-elevated rounded-lg transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-content-muted" />
                </button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-content-main">{team.name}</h1>
                    {team.description && (
                        <p className="text-content-muted mt-1">{team.description}</p>
                    )}
                </div>
                {isAdmin && (
                    <button
                        onClick={() => createInviteMutation.mutate()}
                        disabled={createInviteMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                        {copiedCode ? (
                            <>
                                <Check className="w-4 h-4" />
                                已复制邀请码
                            </>
                        ) : createInviteMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                <UserPlus className="w-4 h-4" />
                                邀请成员
                            </>
                        )}
                    </button>
                )}
                <button
                    onClick={() => navigate(`/teams/${teamId}/tasks`)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    <ClipboardList className="w-4 h-4" />
                    任务板
                </button>
            </div>

            {/* Members */}
            <div className="bg-surface rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-content-main mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    成员 ({members?.length || 0})
                </h2>

                {membersLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                ) : (
                    <div className="space-y-2">
                        {members?.map((member) => (
                            <div
                                key={member.id}
                                className="flex items-center gap-3 p-3 bg-background rounded-lg"
                            >
                                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                                    <User className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium text-content-main">
                                        {member.username || member.email}
                                    </div>
                                    <div className="text-xs text-content-dim">{member.email}</div>
                                </div>
                                <span className={`px-2 py-1 text-xs rounded-full ${member.role === 'owner' ? 'bg-amber-100 text-amber-700' :
                                    member.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                    {member.role === 'owner' ? '创建者' :
                                        member.role === 'admin' ? '管理员' :
                                            member.role === 'guest' ? '访客' : '成员'}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Papers */}
            <div className="bg-surface rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-content-main mb-4 flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    团队论文 ({papers?.total || 0})
                </h2>

                {papers?.papers.length === 0 ? (
                    <p className="text-center py-8 text-content-dim">
                        暂无共享论文，从个人知识库分享论文到团队
                    </p>
                ) : (
                    <div className="space-y-2">
                        {papers?.papers.map((paper) => (
                            <div
                                key={paper.id}
                                className="w-full flex items-center gap-3 p-3 bg-background rounded-lg group"
                            >
                                <button
                                    onClick={() => navigate(`/read/${paper.id}`)}
                                    className="flex items-center gap-3 flex-1 min-w-0 text-left hover:bg-surface-elevated rounded-lg transition-colors"
                                >
                                    <BookOpen className="w-5 h-5 text-primary flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-content-main truncate">
                                            {paper.title || paper.filename}
                                        </div>
                                        <div className="text-xs text-content-dim">
                                            由 {paper.shared_by?.username || paper.shared_by?.email || '未知'} 分享
                                        </div>
                                    </div>
                                </button>
                                {(isAdmin || paper.shared_by?.id === user?.id) && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('确定要取消分享这篇论文吗？')) {
                                                unshareMutation.mutate(paper.id);
                                            }
                                        }}
                                        disabled={unshareMutation.isPending}
                                        className="p-2 text-content-dim hover:text-error hover:bg-error/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                        title="取消分享"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Actions */}
            {!isOwner && (
                <div className="flex justify-end">
                    <button
                        onClick={() => {
                            if (confirm('确定要退出该团队吗？')) {
                                leaveMutation.mutate();
                            }
                        }}
                        disabled={leaveMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 text-error hover:bg-error/10 rounded-lg transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        退出团队
                    </button>
                </div>
            )}
        </div>
    );
}

// ==================== 主页面 ====================
export default function TeamsPage() {
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const navigate = useNavigate();

    const { data: teams, isLoading, error } = useQuery({
        queryKey: ['teams'],
        queryFn: teamsApi.list,
    });

    // 如果选中了团队，显示详情
    if (selectedTeamId) {
        return (
            <div className="min-h-screen bg-background">
                <div className="max-w-4xl mx-auto px-6 py-8">
                    <TeamDetailView
                        teamId={selectedTeamId}
                        onBack={() => setSelectedTeamId(null)}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="bg-surface/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/library')}
                            className="p-2 hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-content-muted" />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-content-main">团队协作</h1>
                            <p className="text-sm text-content-muted">管理您的研究团队</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowJoinModal(true)}
                            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-surface-elevated transition-colors"
                        >
                            <Link2 className="w-4 h-4" />
                            加入团队
                        </button>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            创建团队
                        </button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-6 py-8">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : error ? (
                    <div className="text-center py-20 text-error">
                        加载失败，请刷新页面重试
                    </div>
                ) : teams?.length === 0 ? (
                    <div className="text-center py-20">
                        <Users className="w-16 h-16 text-content-dim mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-content-main mb-2">
                            还没有加入任何团队
                        </h2>
                        <p className="text-content-muted mb-6">
                            创建一个新团队或使用邀请码加入已有团队
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => setShowJoinModal(true)}
                                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-surface-elevated transition-colors"
                            >
                                <Link2 className="w-4 h-4" />
                                加入团队
                            </button>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                创建团队
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {teams?.map((team) => (
                            <TeamCard
                                key={team.id}
                                team={team}
                                onClick={() => setSelectedTeamId(team.id)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Modals */}
            <CreateTeamModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSuccess={() => { }}
            />
            <JoinTeamModal
                isOpen={showJoinModal}
                onClose={() => setShowJoinModal(false)}
                onSuccess={() => { }}
            />
        </div>
    );
}
