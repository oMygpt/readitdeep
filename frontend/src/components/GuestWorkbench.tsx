/**
 * Read it DEEP - Guest Workbench Component
 * 
 * 只读版 Workbench，只显示自动分析结果（方法、数据集、代码）
 * 不包含用户笔记、高亮、拖拽功能
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Sparkles,
    FlaskConical,
    Database,
    ChevronUp,
    ChevronDown,
    ExternalLink,
} from 'lucide-react';
import type { MethodItem, DatasetItem, CodeRefItem } from '../lib/api';

interface GuestWorkbenchProps {
    methods: MethodItem[];
    datasets: DatasetItem[];
    codeRefs: CodeRefItem[];
    onJumpToLocation?: (location: { start_line: number; end_line: number }) => void;
}

export default function GuestWorkbench({
    methods,
    datasets,
    codeRefs,
    onJumpToLocation,
}: GuestWorkbenchProps) {
    const { t } = useTranslation();
    const [showMethods, setShowMethods] = useState(true);
    const [showDatasets, setShowDatasets] = useState(true);
    const [showCode, setShowCode] = useState(true);

    const totalItems = methods.length + datasets.length + codeRefs.length;

    if (totalItems === 0) {
        return (
            <div className="h-full flex flex-col bg-background">
                <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h2 className="font-bold text-content-main">{t('workbench.title')}</h2>
                </div>
                <div className="flex-1 flex items-center justify-center p-8 text-center">
                    <div className="text-content-muted">
                        <span className="text-4xl mb-4 block">📊</span>
                        <p className="text-sm">{t('workbench.noAnalysis', '暂无分析数据')}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-2 flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="font-bold text-content-main">{t('workbench.title')}</h2>
                <span className="ml-auto px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                    {totalItems}
                </span>
            </div>

            {/* Guest Notice */}
            <div className="px-4 py-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-b border-border flex-shrink-0">
                <p className="text-xs text-content-muted flex items-center gap-1">
                    👁️ {t('share.guestViewOnly', '仅供查看 - 登录以添加笔记和高亮')}
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Methods Section */}
                {methods.length > 0 && (
                    <div className="rounded-xl border border-secondary/20 bg-surface overflow-hidden">
                        <button
                            onClick={() => setShowMethods(!showMethods)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-secondary/5 hover:bg-secondary/10 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <FlaskConical className="w-4 h-4 text-secondary" />
                                <span className="text-xs font-medium text-content-main">
                                    {t('workbench.methods')} ({methods.length})
                                </span>
                            </div>
                            {showMethods ? (
                                <ChevronUp className="w-4 h-4 text-content-muted" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-content-muted" />
                            )}
                        </button>

                        {showMethods && (
                            <div className="p-3 space-y-2">
                                {methods.map((method, i) => (
                                    <div
                                        key={i}
                                        className={`bg-surface-elevated rounded-lg px-3 py-2 text-xs border border-border ${method.location?.start_line
                                            ? 'cursor-pointer hover:border-secondary/50'
                                            : ''
                                            }`}
                                        onClick={() =>
                                            method.location?.start_line &&
                                            onJumpToLocation?.(method.location)
                                        }
                                    >
                                        <div className="font-medium text-content-main">{method.name}</div>
                                        <p className="text-content-muted line-clamp-2 mt-0.5">
                                            {method.description}
                                        </p>
                                        {method.location?.start_line ? (
                                            <p className="text-secondary mt-1">
                                                → 第 {method.location.start_line} 行
                                            </p>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Datasets Section */}
                {datasets.length > 0 && (
                    <div className="rounded-xl border border-info/20 bg-surface overflow-hidden">
                        <button
                            onClick={() => setShowDatasets(!showDatasets)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-info/5 hover:bg-info/10 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Database className="w-4 h-4 text-info" />
                                <span className="text-xs font-medium text-content-main">
                                    {t('workbench.datasets')} ({datasets.length})
                                </span>
                            </div>
                            {showDatasets ? (
                                <ChevronUp className="w-4 h-4 text-content-muted" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-content-muted" />
                            )}
                        </button>

                        {showDatasets && (
                            <div className="p-3 space-y-2">
                                {datasets.map((dataset, i) => (
                                    <div
                                        key={i}
                                        className={`bg-surface-elevated rounded-lg px-3 py-2 text-xs border border-border ${dataset.location?.start_line
                                            ? 'cursor-pointer hover:border-info/50'
                                            : ''
                                            }`}
                                        onClick={() =>
                                            dataset.location?.start_line &&
                                            onJumpToLocation?.(dataset.location)
                                        }
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-content-main">{dataset.name}</span>
                                            {dataset.url && (
                                                <a
                                                    href={dataset.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-info hover:text-info-dark"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            )}
                                        </div>
                                        <p className="text-content-muted line-clamp-2 mt-0.5">
                                            {dataset.description}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Code Section */}
                {codeRefs.length > 0 && (
                    <div className="rounded-xl border border-purple-500/20 bg-surface overflow-hidden">
                        <button
                            onClick={() => setShowCode(!showCode)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-purple-500">💻</span>
                                <span className="text-xs font-medium text-content-main">
                                    {t('workbench.code')} ({codeRefs.length})
                                </span>
                            </div>
                            {showCode ? (
                                <ChevronUp className="w-4 h-4 text-content-muted" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-content-muted" />
                            )}
                        </button>

                        {showCode && (
                            <div className="p-3 space-y-2">
                                {codeRefs.map((code, i) => (
                                    <div
                                        key={i}
                                        className="bg-surface-elevated rounded-lg px-3 py-2 text-xs border border-border"
                                    >
                                        {code.repo_url ? (
                                            <a
                                                href={code.repo_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-purple-500 hover:underline flex items-center gap-1"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                {code.repo_url.replace(/^https?:\/\//, '').substring(0, 40)}
                                                {code.repo_url.length > 50 ? '...' : ''}
                                            </a>
                                        ) : (
                                            <p className="text-content-muted">{code.description}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
