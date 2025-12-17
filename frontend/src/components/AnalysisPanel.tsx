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
    List,
    Loader2,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    RefreshCw,
} from 'lucide-react';
import { analysisApi } from '../lib/api';
import type { TextLocation } from '../lib/api';

interface AnalysisPanelProps {
    paperId: string;
    onJumpToLine: (location: TextLocation) => void;
}

export default function AnalysisPanel({ paperId, onJumpToLine }: AnalysisPanelProps) {
    const queryClient = useQueryClient();
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        new Set(['summary', 'methods', 'datasets', 'code', 'structure'])
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

    // 如果没有分析结果，显示触发按钮
    if (error || !analysis) {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" />
                    内容分析
                </h3>
                <button
                    onClick={() => triggerMutation.mutate()}
                    disabled={triggerMutation.isPending}
                    className="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
                <p className="text-xs text-slate-500 mt-2 text-center">
                    自动分析论文结构、方法和数据集
                </p>
            </div>
        );
    }

    // 分析中状态
    if (analysis.status === 'analyzing') {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                    分析中...
                </h3>
                <div className="space-y-2">
                    {['Summary', 'Methods', 'Datasets', 'Code', 'Structure'].map((item) => (
                        <div
                            key={item}
                            className="flex items-center gap-2 text-sm text-slate-500"
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
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-indigo-600" />
                    内容和研究方法分析
                </h3>
                <button
                    onClick={() => triggerMutation.mutate()}
                    disabled={triggerMutation.isPending}
                    className={`p-1 rounded transition-colors ${triggerMutation.isPending ? 'text-indigo-500 animate-spin' : 'text-slate-400 hover:text-slate-600'}`}
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
                    <p className="text-xs text-slate-600 leading-relaxed">
                        {analysis.summary}
                    </p>
                ) : (
                    <p className="text-xs text-slate-400 italic">暂无概要</p>
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
                                description={method.description}
                                location={method.location}
                                onClick={() => handleJump(method.location)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 italic">未识别到研究方法</p>
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
                    <p className="text-xs text-slate-400 italic">未识别到数据集</p>
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
                    <p className="text-xs text-slate-400 italic">未识别到代码引用</p>
                )}
            </Section>

            {/* Structure Section */}
            <Section
                icon={<List className="w-4 h-4" />}
                title="文档结构"
                expanded={expandedSections.has('structure')}
                onToggle={() => toggleSection('structure')}
            >
                {analysis.structure?.sections && analysis.structure.sections.length > 0 ? (
                    <div className="space-y-1">
                        {analysis.structure.sections.map((section, i) => (
                            <button
                                key={i}
                                onClick={() =>
                                    handleJump({
                                        start_line: section.start_line,
                                        end_line: section.start_line + 5,
                                        text_snippet: section.title,
                                    })
                                }
                                className="w-full text-left text-xs text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded px-2 py-1 transition-colors"
                                style={{ paddingLeft: `${8 + (section.level - 1) * 12}px` }}
                            >
                                {section.title}
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 italic">暂无结构信息</p>
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
        <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span className="text-slate-500">{icon}</span>
                <span className="text-xs font-medium text-slate-700">{title}</span>
            </button>
            {expanded && <div className="px-3 py-2 bg-white">{children}</div>}
        </div>
    );
}

// Clickable Item Component
function ClickableItem({
    title,
    description,
    usage,
    location,
    url,
    onClick,
}: {
    title: string;
    description: string;
    usage?: string;
    location?: TextLocation;
    url?: string;
    onClick: () => void;
}) {
    return (
        <div
            className={`p-2 rounded border border-slate-100 ${location ? 'cursor-pointer hover:bg-indigo-50 hover:border-indigo-200' : ''
                }`}
            onClick={location ? onClick : undefined}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">{title}</span>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-indigo-500 hover:text-indigo-700"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{description}</p>
            {usage && (
                <p className="text-xs text-emerald-600 mt-1 line-clamp-1">
                    📋 用途: {usage}
                </p>
            )}
            {location && (
                <p className="text-xs text-indigo-500 mt-1">
                    → 点击跳转到第 {location.start_line} 行
                </p>
            )}
        </div>
    );
}

