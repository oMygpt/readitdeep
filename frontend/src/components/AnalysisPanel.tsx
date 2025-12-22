/**
 * Read it DEEP - Analysis Panel Component
 * 
 * 显示 LangGraph 多智能体分析结果：
 * - 📝 Summary: 论文概要
 * - 🔬 Methods: 研究方法 (可点击跳转)
 * - 📊 Datasets: 数据集 (可点击跳转)
 * - 💻 Code: 代码引用 (可点击跳转)
 * - 🏗️ Structure: 文档结构
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    FileText,
    FlaskConical,
    Database,
    Code,
    Loader2,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    RefreshCw,
} from 'lucide-react';
import { analysisApi } from '../lib/api';
import type { TextLocation } from '../lib/api';

import CollapsibleMarkdown from './CollapsibleMarkdown';

interface AnalysisPanelProps {
    paperId: string;
    onJumpToLine: (location: TextLocation) => void;
}

export default function AnalysisPanel({ paperId, onJumpToLine }: AnalysisPanelProps) {
    const queryClient = useQueryClient();
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        new Set(['summary', 'methods', 'datasets', 'code'])
    );

    // 获取分析结果
    const { data: analysis, error } = useQuery({
        queryKey: ['analysis', paperId],
        queryFn: () => analysisApi.get(paperId),
        retry: false,
        refetchInterval: (query) => {
            // 如果正在分析中，每 3 秒轮询一次
            if (query.state.data?.status === 'analyzing') return 3000;
            return false;
        },
    });

    // 触发分析
    const triggerMutation = useMutation({
        mutationFn: () => analysisApi.trigger(paperId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['analysis', paperId] });
        },
    });

    const toggleSection = (section: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(section)) {
                next.delete(section);
            } else {
                next.add(section);
            }
            return next;
        });
    };

    const handleJump = (location?: TextLocation) => {
        if (location) {
            onJumpToLine(location);
        }
    };

    // 如果没有分析结果或分析失败，显示触发按钮
    if (!analysis || analysis.status === 'pending' || analysis.status === 'failed' || error) {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-content-main mb-3 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" />
                    内容分析
                </h3>
                {error && (
                    <p className="text-xs text-red-500 mb-2">
                        加载分析结果失败，请重新分析
                    </p>
                )}
                <button
                    onClick={() => triggerMutation.mutate()}
                    disabled={triggerMutation.isPending}
                    className="w-full px-3 py-2 bg-primary text-primary-content rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {triggerMutation.isPending ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            启动中...
                        </>
                    ) : (
                        <>
                            <FlaskConical className="w-4 h-4" />
                            开始分析
                        </>
                    )}
                </button>
                <p className="text-xs text-content-muted mt-2 text-center">
                    自动分析论文结构、方法和数据集
                </p>
            </div>
        );
    }

    // 分析中状态
    if (analysis.status === 'analyzing') {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-content-main mb-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    分析中...
                </h3>
                <div className="space-y-2">
                    {['Summary', 'Methods', 'Datasets', 'Code', 'Structure'].map((item) => (
                        <div
                            key={item}
                            className="flex items-center gap-2 text-sm text-content-muted"
                        >
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>{item} Agent</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-content-main flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" />
                    内容和研究方法分析
                </h3>
                <button
                    onClick={() => triggerMutation.mutate()}
                    disabled={triggerMutation.isPending}
                    className={`p-1 rounded transition-colors ${triggerMutation.isPending ? 'text-primary animate-spin' : 'text-content-muted hover:text-content-main'}`}
                    title="重新分析"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Summary Section */}
            <Section
                icon={<FileText className="w-4 h-4" />}
                title="概要"
                expanded={expandedSections.has('summary')}
                onToggle={() => toggleSection('summary')}
            >
                {analysis.summary ? (
                    <CollapsibleMarkdown
                        content={analysis.summary}
                        maxHeight={800} // Summary usually longer, give more space
                        fontSize="text-sm"
                    />
                ) : (
                    <p className="text-xs text-content-dim italic">暂无概要</p>
                )}
            </Section>

            {/* Methods Section */}
            <Section
                icon={<FlaskConical className="w-4 h-4" />}
                title={`研究方法 (${analysis.methods.length})`}
                expanded={expandedSections.has('methods')}
                onToggle={() => toggleSection('methods')}
            >
                {analysis.methods.length > 0 ? (
                    <div className="space-y-2">
                        {analysis.methods.map((method, i) => (
                            <ClickableItem
                                key={i}
                                title={method.name}
                                category={method.category}
                                description={method.description}
                                location={method.location}
                                onClick={() => handleJump(method.location)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-content-dim italic">未识别到研究方法</p>
                )}
            </Section>

            {/* Datasets Section */}
            <Section
                icon={<Database className="w-4 h-4" />}
                title={`数据集 (${analysis.datasets.length})`}
                expanded={expandedSections.has('datasets')}
                onToggle={() => toggleSection('datasets')}
            >
                {analysis.datasets.length > 0 ? (
                    <div className="space-y-2">
                        {analysis.datasets.map((dataset, i) => (
                            <ClickableItem
                                key={i}
                                title={dataset.name}
                                description={dataset.description}
                                usage={dataset.usage}
                                location={dataset.location}
                                url={dataset.url}
                                onClick={() => handleJump(dataset.location)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-content-dim italic">未识别到数据集</p>
                )}
            </Section>

            {/* Code Section */}
            <Section
                icon={<Code className="w-4 h-4" />}
                title={`代码 (${analysis.code_refs.length})`}
                expanded={expandedSections.has('code')}
                onToggle={() => toggleSection('code')}
            >
                {analysis.code_refs.length > 0 ? (
                    <div className="space-y-2">
                        {analysis.code_refs.map((code, i) => (
                            <ClickableItem
                                key={i}
                                title={code.repo_url || '代码引用'}
                                description={code.description}
                                location={code.location}
                                url={code.repo_url}
                                onClick={() => handleJump(code.location)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-content-dim italic">未识别到代码引用</p>
                )}
            </Section>
        </div>
    );
}

// Section Component
function Section({
    icon,
    title,
    expanded,
    onToggle,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    expanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-2 bg-surface-elevated hover:bg-surface-hover transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
                ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-content-muted" />
                )}
                <span className="text-content-dim">{icon}</span>
                <span className="text-xs font-medium text-content-main">{title}</span>
            </button>
            {expanded && <div className="px-3 py-2 bg-surface">{children}</div>}
        </div>
    );
}

// Clickable Item Component
function ClickableItem({
    title,
    category,
    description,
    usage,
    location,
    url,
    onClick,
}: {
    title: string;
    category?: string;
    description: string;
    usage?: string;
    location?: TextLocation;
    url?: string;
    onClick: () => void;
}) {
    return (
        <div
            className={`p-2 rounded border border-border ${location ? 'cursor-pointer hover:bg-primary/5 hover:border-primary/20' : ''
                }`}
            onClick={location ? onClick : undefined}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-content-main">{title}</span>
                    {category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                            {category}
                        </span>
                    )}
                </div>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:text-primary-hover"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>

            {/* Render description with markdown and truncation */}
            <div className="mt-1">
                <CollapsibleMarkdown
                    content={description}
                    maxHeight={150} // Larger max height for better readability
                    className="text-content-muted"
                />
            </div>

            {usage && (
                <div className="text-xs text-secondary mt-1">
                    <span className="font-semibold">📋 用途: </span>
                    <CollapsibleMarkdown
                        content={usage}
                        maxHeight={60}
                        className="inline-block align-top"
                    />
                </div>
            )}

            {location && (
                <p className="text-xs text-primary mt-1">
                    → 点击跳转到第 {location.start_line} 行
                </p>
            )}
        </div>
    );
}

