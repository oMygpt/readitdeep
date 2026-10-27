/**
 * Read it DEEP - 按篇计费提示：本篇价格 · 今日积分 · 本期已用篇数（只在关联 PaperDaily 时显示）
 */

import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { isLinkedMode } from '../lib/api';
import { seriesApi } from '../lib/series';

export function useBillingStatus() {
    return useQuery({
        queryKey: ['billing-status'],
        queryFn: seriesApi.billingStatus,
        enabled: isLinkedMode(),
        staleTime: 30_000,
    });
}

export default function BillingBadge({ className = '' }: { className?: string }) {
    const { data } = useBillingStatus();
    if (!isLinkedMode() || !data) return null;
    const parts: string[] = [];
    if (data.mode === 'paperdaily') {
        parts.push(data.price != null ? `每篇 PDF ${data.price} 积分（含解析、翻译与分析）` : '每篇 PDF 按主站价目扣积分（含解析、翻译与分析）');
        const balance = data.balance ? (data.balance.grant_remaining ?? 0) + (data.balance.earned_balance ?? 0) : null;
        if (balance != null) parts.push(`可用积分 ${balance}`);
    } else {
        parts.push('导入题录免费；上传 PDF 后开始解析');
    }
    if (data.papers_limit != null) {
        parts.push(`${data.period === 'lifetime' ? '累计' : '本月'}已精读 ${data.papers_used}/${data.papers_limit} 篇`);
    }
    return (
        <p className={`flex items-center gap-1.5 text-xs text-content-muted ${className}`}>
            <Coins className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{parts.join(' · ')}</span>
        </p>
    );
}
