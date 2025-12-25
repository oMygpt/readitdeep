/**
 * Share to Team Modal
 * 
 * 选择团队并分享论文的弹窗组件
 * 支持单篇或批量分享
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    X,
    Loader2,
    Users,
    Check,
    AlertCircle,
    Share2,
    FileText,
} from 'lucide-react';
import { teamsApi } from '../lib/api';

interface ShareToTeamModalProps {
    paperId?: string;           // 单篇分享
    paperTitle?: string;        // 单篇标题
    paperIds?: string[];        // 批量分享
    onClose: () => void;
    onSuccess?: () => void;
}

export default function ShareToTeamModal({
    paperId,
    paperTitle,
    paperIds,
    onClose,
    onSuccess,
}: ShareToTeamModalProps) {
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [successCount, setSuccessCount] = useState(0);
    const [errorCount, setErrorCount] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const queryClient = useQueryClient();

    // 获取要分享的论文ID列表
    const allPaperIds = paperIds || (paperId ? [paperId] : []);
    const isBulk = allPaperIds.length > 1;

    // 获取用户的团队列表
    const { data: teams, isLoading } = useQuery({
        queryKey: ['teams'],
        queryFn: teamsApi.list,
    });

    // 批量分享 mutation
    const [alreadySharedCount, setAlreadySharedCount] = useState(0);

    const shareMutation = useMutation({
        mutationFn: async (teamId: string) => {
            let success = 0;
            let errors = 0;
            let alreadyShared = 0;

            for (const pid of allPaperIds) {
                try {
                    await teamsApi.sharePaper(pid, teamId);
                    success++;
                    setSuccessCount(success);
                } catch (e: unknown) {
                    // 检查是不是"已分享"的错误
                    const error = e as { response?: { status?: number; data?: { detail?: string } } };
                    if (error?.response?.status === 400 &&
                        error?.response?.data?.detail?.includes('已分享')) {
                        alreadyShared++;
                        setAlreadySharedCount(alreadyShared);
                        console.log(`Paper ${pid} already shared to this team`);
                    } else {
                        errors++;
                        setErrorCount(errors);
                        console.error(`Failed to share paper ${pid}:`, e);
                    }
                }
            }

            return { success, errors, alreadyShared };
        },
        onSuccess: (result, teamId) => {
            setIsComplete(true);
            queryClient.invalidateQueries({ queryKey: ['team-papers', teamId] });

            // 如果没有真正的错误（已分享不算错误），1.5秒后关闭
            if (result.errors === 0) {
                setTimeout(() => {
                    onSuccess?.();
                    onClose();
                }, 1500);
            }
        },
    });

    const handleShare = () => {
        if (selectedTeamId) {
            setSuccessCount(0);
            setErrorCount(0);
            setAlreadySharedCount(0);
            setIsComplete(false);
            shareMutation.mutate(selectedTeamId);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-surface rounded-2xl shadow-xl w-full max-w-md border border-border"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                            <Share2 className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-content-main">
                                {isBulk ? '批量分享到团队' : '分享到团队'}
                            </h2>
                            {isBulk ? (
                                <p className="text-sm text-content-muted flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    已选择 {allPaperIds.length} 篇论文
                                </p>
                            ) : (
                                <p className="text-sm text-content-muted truncate max-w-[250px]" title={paperTitle}>
                                    {paperTitle}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-surface-elevated rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-content-muted" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Success/Progress Message */}
                    {isComplete && successCount > 0 && (
                        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl mb-4">
                            <Check className="w-5 h-5 text-green-600" />
                            <span className="text-green-700">
                                {isBulk
                                    ? `成功分享 ${successCount}/${allPaperIds.length} 篇论文`
                                    : `已分享到 ${teams?.find(t => t.id === selectedTeamId)?.name || '团队'}`
                                }
                            </span>
                        </div>
                    )}

                    {/* Already Shared Message */}
                    {isComplete && alreadySharedCount > 0 && (
                        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                            <AlertCircle className="w-5 h-5 text-amber-600" />
                            <span className="text-amber-700">
                                {alreadySharedCount === 1 && !isBulk
                                    ? '该论文已分享到此团队'
                                    : `${alreadySharedCount} 篇论文已经分享过了`
                                }
                            </span>
                        </div>
                    )}

                    {/* Error Message */}
                    {isComplete && errorCount > 0 && (
                        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
                            <AlertCircle className="w-5 h-5 text-red-600" />
                            <span className="text-red-700">
                                {errorCount} 篇论文分享失败
                            </span>
                        </div>
                    )}

                    {/* Sharing Progress */}
                    {shareMutation.isPending && (
                        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl mb-4">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                            <span className="text-blue-700">
                                正在分享... ({successCount + errorCount}/{allPaperIds.length})
                            </span>
                        </div>
                    )}

                    {/* Loading */}
                    {isLoading && (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    )}

                    {/* No Teams */}
                    {!isLoading && (!teams || teams.length === 0) && (
                        <div className="text-center py-8">
                            <Users className="w-12 h-12 text-content-dim mx-auto mb-3" />
                            <p className="text-content-muted">您还没有加入任何团队</p>
                            <p className="text-sm text-content-dim mt-1">
                                先创建或加入一个团队
                            </p>
                        </div>
                    )}

                    {/* Team List */}
                    {!isLoading && teams && teams.length > 0 && !isComplete && (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {teams.map((team) => (
                                <button
                                    key={team.id}
                                    onClick={() => setSelectedTeamId(team.id)}
                                    disabled={shareMutation.isPending}
                                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${selectedTeamId === team.id
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border hover:border-primary/30 hover:bg-surface-elevated'
                                        } ${shareMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedTeamId === team.id
                                        ? 'bg-primary text-white'
                                        : 'bg-blue-500/10 text-blue-500'
                                        }`}>
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-content-main truncate">
                                            {team.name}
                                        </div>
                                        <div className="text-xs text-content-dim">
                                            {team.member_count} 人
                                        </div>
                                    </div>
                                    {selectedTeamId === team.id && (
                                        <Check className="w-5 h-5 text-primary" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!isLoading && teams && teams.length > 0 && !isComplete && (
                    <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-content-muted hover:text-content-main transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleShare}
                            disabled={!selectedTeamId || shareMutation.isPending}
                            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {shareMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isBulk ? `分享 ${allPaperIds.length} 篇` : '分享'}
                        </button>
                    </div>
                )}

                {/* Done - Close Button */}
                {isComplete && (
                    <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
                        <button
                            onClick={() => {
                                onSuccess?.();
                                onClose();
                            }}
                            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                        >
                            完成
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
