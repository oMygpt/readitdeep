/**
 * Read it DEEP - Share Link Modal
 * 
 * 分享链接管理弹窗
 * - 生成新链接
 * - 复制链接
 * - 查看访问统计
 * - 撤销链接
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    X,
    Link2,
    Copy,
    Check,
    Trash2,
    Loader2,
    ExternalLink,
    Eye,
    Clock,
    Plus,
} from 'lucide-react';
import { shareApi } from '../lib/api';
import type { ShareLink } from '../lib/api';

interface ShareLinkModalProps {
    paperId: string;
    paperTitle: string;
    isOpen: boolean;
    onClose: () => void;
}

export default function ShareLinkModal({
    paperId,
    paperTitle,
    isOpen,
    onClose,
}: ShareLinkModalProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [expiryDays, setExpiryDays] = useState<number>(14);

    // Fetch existing links for this paper
    const { data: linksData, isLoading } = useQuery({
        queryKey: ['share-links', paperId],
        queryFn: () => shareApi.getPaperLinks(paperId),
        enabled: isOpen,
    });

    // Create new link mutation
    const createMutation = useMutation({
        mutationFn: () => shareApi.createLink(paperId, expiryDays),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['share-links', paperId] });
        },
    });

    // Revoke link mutation
    const revokeMutation = useMutation({
        mutationFn: (shareToken: string) => shareApi.revokeLink(shareToken),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['share-links', paperId] });
        },
    });

    const handleCopy = async (shareLink: ShareLink) => {
        const url = `${window.location.origin}${shareLink.share_url}`;
        await navigator.clipboard.writeText(url);
        setCopiedToken(shareLink.share_token);
        setTimeout(() => setCopiedToken(null), 2000);
    };

    const handleCreateLink = () => {
        createMutation.mutate();
    };

    const handleRevoke = (shareToken: string) => {
        if (window.confirm(t('share.confirmRevoke', '确定要撤销此分享链接吗？撤销后访客将无法访问。'))) {
            revokeMutation.mutate(shareToken);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const isExpired = (expiresAt: string | null) => {
        if (!expiresAt) return false;
        return new Date(expiresAt) < new Date();
    };

    if (!isOpen) return null;

    const links = linksData?.links || [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden border border-border">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Link2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-content-main">
                                {t('share.title', '分享链接')}
                            </h2>
                            <p className="text-xs text-content-muted truncate max-w-[250px]">
                                {paperTitle}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-content-muted hover:text-content-main hover:bg-surface-hover rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {/* Create New Link Section */}
                    <div className="mb-6 p-4 bg-surface-elevated rounded-xl border border-border">
                        <h3 className="text-sm font-semibold text-content-main mb-3">
                            {t('share.createNew', '创建新链接')}
                        </h3>
                        <div className="flex items-center gap-3">
                            <select
                                value={expiryDays}
                                onChange={(e) => setExpiryDays(Number(e.target.value))}
                                className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-content-main focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value={7}>{t('share.expires7days', '7 天后过期')}</option>
                                <option value={14}>{t('share.expires14days', '14 天后过期')}</option>
                                <option value={30}>{t('share.expires30days', '30 天后过期')}</option>
                                <option value={90}>{t('share.expires90days', '90 天后过期')}</option>
                                <option value={0}>{t('share.neverExpires', '永不过期')}</option>
                            </select>
                            <button
                                onClick={handleCreateLink}
                                disabled={createMutation.isPending}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
                            >
                                {createMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Plus className="w-4 h-4" />
                                )}
                                {t('share.generate', '生成')}
                            </button>
                        </div>
                    </div>

                    {/* Existing Links */}
                    <div>
                        <h3 className="text-sm font-semibold text-content-main mb-3">
                            {t('share.existingLinks', '已有链接')} ({links.length})
                        </h3>

                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                            </div>
                        ) : links.length === 0 ? (
                            <div className="text-center py-8 text-content-muted">
                                <Link2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">{t('share.noLinks', '暂无分享链接')}</p>
                                <p className="text-xs mt-1">{t('share.createFirst', '点击上方按钮创建第一个')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {links.map((link) => (
                                    <div
                                        key={link.id}
                                        className={`p-4 rounded-xl border transition-colors ${isExpired(link.expires_at)
                                                ? 'bg-error/5 border-error/20'
                                                : 'bg-surface-elevated border-border hover:border-primary/30'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                                                    {link.share_token.substring(0, 12)}...
                                                </code>
                                                {isExpired(link.expires_at) && (
                                                    <span className="text-xs text-error bg-error/10 px-2 py-0.5 rounded">
                                                        {t('share.expired', '已过期')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleCopy(link)}
                                                    className="p-1.5 text-content-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                                    title={t('share.copy', '复制链接')}
                                                >
                                                    {copiedToken === link.share_token ? (
                                                        <Check className="w-4 h-4 text-success" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
                                                </button>
                                                <a
                                                    href={link.share_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-1.5 text-content-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                                    title={t('share.preview', '预览')}
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                </a>
                                                <button
                                                    onClick={() => handleRevoke(link.share_token)}
                                                    disabled={revokeMutation.isPending}
                                                    className="p-1.5 text-content-muted hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                                                    title={t('share.revoke', '撤销')}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-content-muted">
                                            <span className="flex items-center gap-1">
                                                <Eye className="w-3 h-3" />
                                                {link.access_count} {t('share.views', '次访问')}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {link.expires_at
                                                    ? t('share.expiresAt', '过期: {{date}}', {
                                                        date: formatDate(link.expires_at),
                                                    })
                                                    : t('share.never', '永不过期')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border bg-surface-elevated">
                    <p className="text-xs text-content-muted text-center">
                        {t('share.guestInfo', '访客可以查看论文内容和分析结果，但无法查看您的笔记和高亮')}
                    </p>
                </div>
            </div>
        </div>
    );
}
