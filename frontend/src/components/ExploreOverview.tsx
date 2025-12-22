/**
 * Read it DEEP - Explore Overview Component
 * 
 * 全屏瀑布流式概览界面：
 * - 📈 论文关系图 (Citation Graph)
 * - 📋 论文摘要 (Summary)
 * - 🔬 研究方法 (Methods)
 * - 📦 数据集与代码 (Datasets & Code)
 */

import { useQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    BookOpen,
    Loader2,
    FileText,
    FlaskConical,
    Database,
    Code,
    Network,
    ChevronRight,
    ExternalLink,
    Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { analysisApi } from '../lib/api';
import PaperGraph from './PaperGraph';

interface ExploreOverviewProps {
    paperId: string;
    paperTitle: string;
    onStartReading: () => void;
    onBack: () => void;
}

export default function ExploreOverview({
    paperId,
    paperTitle,
    onStartReading,
    onBack,
}: ExploreOverviewProps) {
    // Fetch analysis data
    const { data: analysis, isLoading: isAnalysisLoading } = useQuery({
        queryKey: ['analysis', paperId],
        queryFn: () => analysisApi.get(paperId),
        retry: false,
    });

    const isLoading = isAnalysisLoading;

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="bg-surface/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-content-main line-clamp-1">
                                {paperTitle}
                            </h1>
                            <p className="text-sm text-content-muted flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                Explore Mode
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onStartReading}
                        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors font-medium shadow-lg shadow-primary/20"
                    >
                        <BookOpen className="w-4 h-4" />
                        开始深度阅读
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </header>

            {/* Main Content - Waterfall Layout */}
            <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-center">
                            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                            <p className="text-content-muted">正在加载分析结果...</p>
                        </div>
                    </div>
                )}

                {!isLoading && (
                    <>
                        {/* Citation Graph */}
                        <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                                <div className="p-2 bg-info/10 rounded-lg">
                                    <Network className="w-5 h-5 text-info" />
                                </div>
                                <h2 className="text-lg font-bold text-content-main">论文关系图谱 <span className="text-xs font-normal text-content-dim">v0.1</span></h2>
                            </div>
                            {/* Height adapts: min 300px, grows based on content */}
                            <div className="min-h-[300px]">
                                <PaperGraph paperId={paperId} />
                            </div>
                        </section>

                        {/* Summary */}
                        <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                                <div className="p-2 bg-success/10 rounded-lg">
                                    <FileText className="w-5 h-5 text-success" />
                                </div>
                                <h2 className="text-lg font-bold text-content-main">论文摘要</h2>
                            </div>
                            <div className="px-6 py-5">
                                {analysis?.summary ? (
                                    <div className="prose prose-slate max-w-none text-content-main leading-relaxed">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {analysis.summary}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="text-content-dim italic">暂无摘要分析</p>
                                )}
                            </div>
                        </section>

                        {/* Methods */}
                        <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <FlaskConical className="w-5 h-5 text-primary" />
                                </div>
                                <h2 className="text-lg font-bold text-content-main">研究方法</h2>
                            </div>
                            <div className="px-6 py-5">
                                {analysis?.methods && analysis.methods.length > 0 ? (
                                    <div className="space-y-4">
                                        {analysis.methods.map((method, idx) => (
                                            <div key={idx} className="p-4 bg-surface-elevated rounded-lg border border-border">
                                                <h4 className="font-semibold text-primary mb-2">{method.name}</h4>
                                                <p className="text-content-main leading-relaxed">{method.description}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-content-dim italic">暂无方法分析</p>
                                )}
                            </div>
                        </section>

                        {/* Datasets & Code */}
                        <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                                <div className="p-2 bg-warning/10 rounded-lg">
                                    <Database className="w-5 h-5 text-warning" />
                                </div>
                                <h2 className="text-lg font-bold text-content-main">数据集与代码</h2>
                            </div>
                            <div className="px-6 py-5 grid md:grid-cols-2 gap-6">
                                {/* Datasets */}
                                <div>
                                    <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                                        <Database className="w-4 h-4" />
                                        Datasets
                                    </h3>
                                    {analysis?.datasets && analysis.datasets.length > 0 ? (
                                        <ul className="space-y-2">
                                            {analysis.datasets.map((item, idx) => (
                                                <li
                                                    key={idx}
                                                    className="p-3 bg-surface-elevated rounded-lg border border-border"
                                                >
                                                    <div className="font-medium text-content-main">
                                                        {item.name}
                                                    </div>
                                                    {item.description && (
                                                        <p className="text-sm text-content-muted mt-1">
                                                            {item.description}
                                                        </p>
                                                    )}
                                                    {item.url && (
                                                        <a
                                                            href={item.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                            {item.url}
                                                        </a>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-content-dim italic text-sm">未识别到数据集</p>
                                    )}
                                </div>

                                {/* Code */}
                                <div>
                                    <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                                        <Code className="w-4 h-4" />
                                        Code Repositories
                                    </h3>
                                    {analysis?.code_refs && analysis.code_refs.length > 0 ? (
                                        <ul className="space-y-2">
                                            {analysis.code_refs.map((item, idx) => (
                                                <li
                                                    key={idx}
                                                    className="p-3 bg-surface-elevated rounded-lg border border-border"
                                                >
                                                    <div className="font-medium text-content-main flex items-center gap-2">
                                                        <Code className="w-4 h-4 text-content-dim" />
                                                        Repository
                                                    </div>
                                                    {item.repo_url && (
                                                        <a
                                                            href={item.repo_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                            {item.repo_url}
                                                        </a>
                                                    )}
                                                    {item.description && (
                                                        <p className="text-sm text-content-muted mt-1">
                                                            {item.description}
                                                        </p>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-content-dim italic text-sm">未识别到代码仓库</p>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* Start Reading CTA */}
                        <div className="text-center py-8">
                            <button
                                onClick={onStartReading}
                                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-primary-content rounded-xl hover:from-primary-hover hover:to-secondary-hover transition-all font-semibold text-lg shadow-xl shadow-primary/20 hover:shadow-2xl hover:-translate-y-0.5"
                            >
                                <BookOpen className="w-5 h-5" />
                                🚀 开始深度阅读
                            </button>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
