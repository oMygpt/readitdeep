/**
 * Read it DEEP - Quota Badge Component
 * 
 * 显示用户当前会员计划和配额使用情况
 */

import { useQuery } from '@tanstack/react-query';
import { Crown, Zap, Sparkles, AlertTriangle } from 'lucide-react';
import { quotaApi } from '../lib/api';

interface QuotaStatus {
    plan: string;
    plan_display: string;
    expires_at: string | null;
    papers: {
        daily_used: number;
        daily_limit: number;
        monthly_used: number;
        monthly_limit: number;
    };
    ai: {
        daily_used: number;
        daily_limit: number;
    };
    can_parse: boolean;
    can_use_ai: boolean;
    subscription_enabled: boolean;
}

interface QuotaBadgeProps {
    onUpgradeClick?: () => void;
    showDetails?: boolean;
}

export default function QuotaBadge({ onUpgradeClick, showDetails = false }: QuotaBadgeProps) {

    const { data: quota, isLoading } = useQuery<QuotaStatus>({
        queryKey: ['quota-status'],
        queryFn: quotaApi.getStatus,
        staleTime: 30000, // 30 seconds
        refetchInterval: 60000, // 1 minute
    });

    if (isLoading || !quota) {
        return (
            <div className="animate-pulse bg-surface-elevated rounded-lg h-8 w-24" />
        );
    }

    // 订阅功能关闭时隐藏整个组件
    if (!quota.subscription_enabled) {
        return null;
    }

    const planColors = {
        free: {
            bg: 'bg-surface-elevated',
            text: 'text-content-main',
            border: 'border-border',
            icon: Zap,
        },
        pro: {
            bg: 'bg-gradient-to-r from-primary to-secondary',
            text: 'text-primary-content',
            border: 'border-primary',
            icon: Sparkles,
        },
        ultra: {
            bg: 'bg-gradient-to-r from-warning to-error',
            text: 'text-white',
            border: 'border-warning',
            icon: Crown,
        },
    };

    const plan = quota.plan as keyof typeof planColors;
    const colors = planColors[plan] || planColors.free;
    const Icon = colors.icon;

    // 计算配额使用百分比
    const paperUsage = quota.papers.daily_limit === -1
        ? 0
        : (quota.papers.daily_used / quota.papers.daily_limit) * 100;

    const isQuotaLow = paperUsage >= 80 && quota.papers.daily_limit !== -1;
    const isQuotaExhausted = !quota.can_parse;

    // 简洁模式
    if (!showDetails) {
        return (
            <button
                onClick={onUpgradeClick}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:shadow-md ${colors.bg} ${colors.text}`}
            >
                <Icon className="w-3.5 h-3.5" />
                <span>{quota.plan_display}</span>
                {isQuotaExhausted && (
                    <AlertTriangle className="w-3 h-3 text-error" />
                )}
            </button>
        );
    }

    // 详细模式
    return (
        <div
            className={`rounded-xl border p-4 ${colors.border} bg-surface shadow-sm cursor-pointer hover:shadow-md transition-shadow`}
            onClick={onUpgradeClick}
        >
            {/* Plan Header */}
            <div className="flex items-center justify-between mb-3">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${colors.bg} ${colors.text}`}>
                    <Icon className="w-4 h-4" />
                    <span className="font-semibold text-sm">{quota.plan_display}</span>
                </div>
                {quota.expires_at && (
                    <span className="text-xs text-content-dim">
                        {new Date(quota.expires_at).toLocaleDateString()} 到期
                    </span>
                )}
            </div>

            {/* Quota Details */}
            <div className="space-y-3">
                {/* Paper Quota */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-content-muted">论文解析</span>
                        <span className={isQuotaExhausted ? 'text-error font-medium' : 'text-content-main'}>
                            {quota.papers.daily_limit === -1
                                ? '无限制'
                                : `${quota.papers.daily_used} / ${quota.papers.daily_limit} 篇/天`
                            }
                        </span>
                    </div>
                    {quota.papers.daily_limit !== -1 && (
                        <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${isQuotaExhausted ? 'bg-error' :
                                    isQuotaLow ? 'bg-warning' : 'bg-primary'
                                    }`}
                                style={{ width: `${Math.min(100, paperUsage)}%` }}
                            />
                        </div>
                    )}
                    {/* Monthly quota for free users */}
                    {quota.plan === 'free' && quota.papers.monthly_limit !== -1 && (
                        <div className="mt-1 text-xs text-content-dim">
                            本月: {quota.papers.monthly_used} / {quota.papers.monthly_limit} 篇
                        </div>
                    )}
                </div>

                {/* AI Quota */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-content-muted">AI 提问</span>
                        <span className={!quota.can_use_ai ? 'text-error font-medium' : 'text-content-main'}>
                            {quota.ai.daily_limit === -1
                                ? '无限制'
                                : `${quota.ai.daily_used} / ${quota.ai.daily_limit} 次/天`
                            }
                        </span>
                    </div>
                    {quota.ai.daily_limit !== -1 && (
                        <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${!quota.can_use_ai ? 'bg-error' : 'bg-secondary'
                                    }`}
                                style={{ width: `${Math.min(100, (quota.ai.daily_used / quota.ai.daily_limit) * 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Upgrade Prompt */}
            {quota.plan === 'free' && (
                <div className="mt-4 pt-3 border-t border-border">
                    <button className="w-full py-2 bg-gradient-to-r from-primary to-secondary text-primary-content text-sm font-medium rounded-lg hover:shadow-lg transition-shadow">
                        升级会员解锁更多
                    </button>
                </div>
            )}
        </div>
    );
}
