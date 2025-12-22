/**
 * Read it DEEP - Upgrade Modal Component
 * 
 * 会员升级和邀请码兑换弹窗
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Crown,
    Sparkles,
    Zap,
    Check,
    X,
    Loader2,
    Gift,
    Copy,
    CheckCircle,
    AlertCircle
} from 'lucide-react';
import { quotaApi } from '../lib/api';

interface PlanInfo {
    name: string;
    display: string;
    price: number;
    papers_daily: number;
    papers_monthly: number;
    ai_daily: number;
}

interface UpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function UpgradeModal({ isOpen, onClose }: UpgradeModalProps) {
    const queryClient = useQueryClient();

    const [activeTab, setActiveTab] = useState<'plans' | 'redeem' | 'invite'>('plans');
    const [invitationCode, setInvitationCode] = useState('');
    const [redeemMessage, setRedeemMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // 获取计划列表
    const { data: plans } = useQuery<PlanInfo[]>({
        queryKey: ['plans'],
        queryFn: quotaApi.getPlans,
        enabled: isOpen,
    });

    // 兑换邀请码
    const redeemMutation = useMutation({
        mutationFn: (code: string) => quotaApi.redeemCode(code),
        onSuccess: (data) => {
            setRedeemMessage({ type: 'success', text: data.message });
            queryClient.invalidateQueries({ queryKey: ['quota-status'] });
            setInvitationCode('');
        },
        onError: (error: any) => {
            setRedeemMessage({
                type: 'error',
                text: error.response?.data?.detail || '兑换失败，请检查邀请码'
            });
        },
    });

    // 生成邀请码
    const generateCodeMutation = useMutation({
        mutationFn: () => quotaApi.generateCode(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['my-invitation-codes'] });
        },
    });

    // 我的邀请码列表
    const { data: myCodes } = useQuery({
        queryKey: ['my-invitation-codes'],
        queryFn: quotaApi.getMyCodes,
        enabled: isOpen && activeTab === 'invite',
    });

    // 获取当前配额状态
    const { data: quotaStatus } = useQuery({
        queryKey: ['quota-status'],
        queryFn: quotaApi.getStatus,
        enabled: isOpen,
    });

    if (!isOpen) return null;

    // 订阅功能关闭时隐藏整个弹窗
    if (quotaStatus && !quotaStatus.subscription_enabled) {
        return null;
    }

    const handleRedeem = () => {
        if (!invitationCode.trim()) return;
        setRedeemMessage(null);
        redeemMutation.mutate(invitationCode.trim());
    };

    const copyToClipboard = (code: string) => {
        navigator.clipboard.writeText(code);
        // 可以添加 toast 提示
    };

    const planFeatures = {
        free: [
            '每天 3 篇论文解析',
            '每月 10 篇论文上限',
            '每天 10 次 AI 提问',
            '基础阅读功能',
        ],
        pro: [
            '每天 10 篇论文解析',
            '无限月度配额',
            '每天 100 次 AI 提问',
            '高级分析功能',
            '邀请好友获奖励',
        ],
        ultra: [
            '无限论文解析',
            '无限 AI 提问',
            '优先解析队列',
            '专属客服支持',
            '邀请好友获奖励',
        ],
    };

    const planIcons = {
        free: Zap,
        pro: Sparkles,
        ultra: Crown,
    };

    const planColors = {
        free: 'border-border bg-surface-elevated',
        pro: 'border-primary/20 bg-gradient-to-br from-primary/5 to-secondary/5',
        ultra: 'border-warning/20 bg-gradient-to-br from-warning/5 to-error/5',
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-surface rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h2 className="text-xl font-bold text-content-main">会员中心</h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-content-dim hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border">
                    <button
                        onClick={() => setActiveTab('plans')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'plans'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-content-muted hover:text-content-main'
                            }`}
                    >
                        会员计划
                    </button>
                    <button
                        onClick={() => setActiveTab('redeem')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'redeem'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-content-muted hover:text-content-main'
                            }`}
                    >
                        兑换邀请码
                    </button>
                    {quotaStatus?.plan !== 'free' && (
                        <button
                            onClick={() => setActiveTab('invite')}
                            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'invite'
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-content-muted hover:text-content-main'
                                }`}
                        >
                            邀请好友
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                    {/* Plans Tab */}
                    {activeTab === 'plans' && (
                        <div className="grid md:grid-cols-3 gap-6">
                            {(plans || []).map((plan) => {
                                const Icon = planIcons[plan.name as keyof typeof planIcons] || Zap;
                                const colors = planColors[plan.name as keyof typeof planColors] || planColors.free;
                                const features = planFeatures[plan.name as keyof typeof planFeatures] || [];
                                const isCurrentPlan = quotaStatus?.plan === plan.name;

                                return (
                                    <div
                                        key={plan.name}
                                        className={`relative rounded-xl border-2 p-6 transition-all ${colors} ${isCurrentPlan ? 'ring-2 ring-primary ring-offset-2' : 'hover:shadow-lg'
                                            }`}
                                    >
                                        {isCurrentPlan && (
                                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-content text-xs font-medium rounded-full">
                                                当前计划
                                            </div>
                                        )}

                                        {/* Plan Icon & Name */}
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className={`p-2 rounded-lg ${plan.name === 'ultra' ? 'bg-warning text-warning-content' :
                                                plan.name === 'pro' ? 'bg-primary text-primary-content' :
                                                    'bg-surface-elevated text-content-main'
                                                }`}>
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-content-main">{plan.display}</h3>
                                            </div>
                                        </div>

                                        {/* Price */}
                                        <div className="mb-6">
                                            {plan.price === 0 ? (
                                                <div className="text-3xl font-bold text-content-main">免费</div>
                                            ) : (
                                                <div className="flex items-baseline gap-1">
                                                    <span className="text-3xl font-bold text-content-main">¥{plan.price}</span>
                                                    <span className="text-content-muted">/月</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Features */}
                                        <ul className="space-y-3 mb-6">
                                            {features.map((feature, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-content-main">
                                                    <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>

                                        {/* Action Button */}
                                        {!isCurrentPlan && (
                                            <button
                                                className={`w-full py-3 rounded-lg font-medium transition-all ${plan.name === 'ultra'
                                                    ? 'bg-gradient-to-r from-warning to-error text-warning-content hover:shadow-lg' :
                                                    plan.name === 'pro'
                                                        ? 'bg-gradient-to-r from-primary to-secondary text-primary-content hover:shadow-lg' :
                                                        'bg-surface-elevated text-content-muted cursor-default'
                                                    }`}
                                                disabled={plan.name === 'free'}
                                            >
                                                {plan.name === 'free' ? '当前版本' : '立即订阅'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Redeem Tab */}
                    {activeTab === 'redeem' && (
                        <div className="max-w-md mx-auto">
                            <div className="text-center mb-8">
                                <div className="inline-flex p-4 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full mb-4">
                                    <Gift className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-bold text-content-main mb-2">兑换邀请码</h3>
                                <p className="text-content-muted text-sm">
                                    输入邀请码即可解锁会员特权
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={invitationCode}
                                        onChange={(e) => setInvitationCode(e.target.value.toUpperCase())}
                                        placeholder="请输入邀请码 (如: READIT-XXXXXXXX)"
                                        className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent text-center text-lg font-mono tracking-wider bg-surface text-content-main"
                                        maxLength={20}
                                    />
                                </div>

                                {redeemMessage && (
                                    <div className={`flex items-center gap-2 p-3 rounded-lg ${redeemMessage.type === 'success'
                                        ? 'bg-success/10 text-success'
                                        : 'bg-error/10 text-error'
                                        }`}>
                                        {redeemMessage.type === 'success'
                                            ? <CheckCircle className="w-5 h-5" />
                                            : <AlertCircle className="w-5 h-5" />
                                        }
                                        <span className="text-sm">{redeemMessage.text}</span>
                                    </div>
                                )}

                                <button
                                    onClick={handleRedeem}
                                    disabled={!invitationCode.trim() || redeemMutation.isPending}
                                    className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-primary-content font-medium rounded-xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {redeemMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {redeemMutation.isPending ? '兑换中...' : '立即兑换'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Invite Tab */}
                    {activeTab === 'invite' && quotaStatus?.plan !== 'free' && (
                        <div className="max-w-lg mx-auto">
                            <div className="text-center mb-8">
                                <div className="inline-flex p-4 bg-gradient-to-br from-success/10 to-success/10 rounded-full mb-4">
                                    <Gift className="w-8 h-8 text-success" />
                                </div>
                                <h3 className="text-xl font-bold text-content-main mb-2">邀请好友</h3>
                                <p className="text-content-muted text-sm">
                                    分享邀请码给好友，对方获得 3 天 Pro 体验，您获得 3 天会员延期
                                </p>
                            </div>

                            {/* Generate Button */}
                            <div className="mb-6">
                                <button
                                    onClick={() => generateCodeMutation.mutate()}
                                    disabled={generateCodeMutation.isPending}
                                    className="w-full py-3 bg-gradient-to-r from-success to-success/80 text-success-content font-medium rounded-xl hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {generateCodeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                                    生成新邀请码
                                </button>
                            </div>

                            {/* My Codes List */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-medium text-content-muted">我的邀请码</h4>
                                {myCodes && myCodes.length > 0 ? (
                                    myCodes.map((code: any) => (
                                        <div
                                            key={code.code}
                                            className={`flex items-center justify-between p-4 rounded-xl border ${code.is_used
                                                ? 'bg-surface-elevated border-border'
                                                : 'bg-surface border-border'
                                                }`}
                                        >
                                            <div>
                                                <div className={`font-mono text-lg ${code.is_used ? 'text-content-dim' : 'text-content-main'}`}>
                                                    {code.code}
                                                </div>
                                                <div className="text-xs text-content-dim mt-1">
                                                    {code.is_used
                                                        ? `已使用于 ${new Date(code.used_at).toLocaleDateString()}`
                                                        : code.is_expired
                                                            ? '已过期'
                                                            : `有效期至 ${new Date(code.expires_at).toLocaleDateString()}`
                                                    }
                                                </div>
                                            </div>
                                            {!code.is_used && !code.is_expired && (
                                                <button
                                                    onClick={() => copyToClipboard(code.code)}
                                                    className="p-2 text-content-dim hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                                >
                                                    <Copy className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-content-dim">
                                        还没有生成过邀请码
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
