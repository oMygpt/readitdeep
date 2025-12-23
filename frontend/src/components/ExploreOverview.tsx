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

                        {/* Paper Overview */}
                        <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-success/20 to-primary/10 rounded-lg">
                                    <FileText className="w-5 h-5 text-success" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-content-main">Paper Overview</h2>
                                    <p className="text-xs text-content-dim">AI-generated summary of key findings</p>
                                </div>
                            </div>
                            <div className="px-6 py-6">
                                {analysis?.summary ? (
                                    <div className="prose prose-slate max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                // H1 标题 - 主标题样式，带图标和渐变背景
                                                h1: ({ children }) => (
                                                    <h1 className="text-xl font-bold text-content-main mt-0 mb-5 pb-3 border-b border-border flex items-center gap-3">
                                                        <span className="text-2xl">📄</span>
                                                        <span>{children}</span>
                                                    </h1>
                                                ),
                                                // H2 标题 - 带 emoji 和背景的段落标题
                                                h2: ({ children }) => (
                                                    <h2 className="text-base font-bold text-content-main mt-8 mb-4 p-3 bg-gradient-to-r from-surface-elevated to-transparent rounded-lg border-l-4 border-primary flex items-center gap-2">
                                                        {children}
                                                    </h2>
                                                ),
                                                // H3 标题 - 次级标题
                                                h3: ({ children }) => (
                                                    <h3 className="text-sm font-semibold text-content-main mt-5 mb-2 flex items-center gap-2">
                                                        <span className="w-2 h-2 bg-secondary rounded-full"></span>
                                                        {children}
                                                    </h3>
                                                ),
                                                // H4 标题
                                                h4: ({ children }) => (
                                                    <h4 className="text-sm font-medium text-content-muted mt-4 mb-2 uppercase tracking-wide">
                                                        {children}
                                                    </h4>
                                                ),
                                                // 段落 - 优化行高和间距
                                                p: ({ children }) => (
                                                    <p className="text-content-main leading-relaxed mb-4 text-[15px] tracking-wide">
                                                        {children}
                                                    </p>
                                                ),
                                                // 无序列表
                                                ul: ({ children }) => (
                                                    <ul className="my-4 ml-0 space-y-2">
                                                        {children}
                                                    </ul>
                                                ),
                                                // 有序列表
                                                ol: ({ children }) => (
                                                    <ol className="my-4 ml-0 space-y-2 list-decimal list-inside">
                                                        {children}
                                                    </ol>
                                                ),
                                                // 列表项 - 带图标样式
                                                li: ({ children }) => (
                                                    <li className="text-content-main leading-relaxed text-[15px] flex items-start gap-2 pl-0">
                                                        <span className="text-primary mt-1.5 flex-shrink-0">•</span>
                                                        <span className="flex-1">{children}</span>
                                                    </li>
                                                ),
                                                // 强调文字 - 主题色高亮
                                                strong: ({ children }) => (
                                                    <strong className="font-semibold text-primary bg-primary/5 px-1 rounded">
                                                        {children}
                                                    </strong>
                                                ),
                                                // 斜体
                                                em: ({ children }) => (
                                                    <em className="italic text-content-muted">
                                                        {children}
                                                    </em>
                                                ),
                                                // 引用块 - 卡片式设计
                                                blockquote: ({ children }) => (
                                                    <blockquote className="my-5 p-4 bg-gradient-to-r from-primary/10 to-primary/5 border-l-4 border-primary rounded-r-xl text-content-main not-italic shadow-sm">
                                                        <div className="flex items-start gap-3">
                                                            <span className="text-primary text-lg flex-shrink-0">💡</span>
                                                            <div className="flex-1 [&>p]:mb-0">{children}</div>
                                                        </div>
                                                    </blockquote>
                                                ),
                                                // 行内代码
                                                code: ({ children, className }) => {
                                                    const isBlock = className?.includes('language-');
                                                    if (isBlock) {
                                                        return (
                                                            <code className={`block bg-slate-900 text-slate-100 p-4 rounded-lg text-sm font-mono overflow-x-auto ${className}`}>
                                                                {children}
                                                            </code>
                                                        );
                                                    }
                                                    return (
                                                        <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm font-mono">
                                                            {children}
                                                        </code>
                                                    );
                                                },
                                                // 代码块
                                                pre: ({ children }) => (
                                                    <pre className="my-4 rounded-xl overflow-hidden shadow-md">
                                                        {children}
                                                    </pre>
                                                ),
                                                // 表格 - 现代化设计
                                                table: ({ children }) => (
                                                    <div className="my-5 overflow-x-auto rounded-xl border border-border shadow-sm">
                                                        <table className="w-full text-sm">
                                                            {children}
                                                        </table>
                                                    </div>
                                                ),
                                                thead: ({ children }) => (
                                                    <thead className="bg-gradient-to-r from-surface-elevated to-surface border-b border-border">
                                                        {children}
                                                    </thead>
                                                ),
                                                th: ({ children }) => (
                                                    <th className="px-4 py-3 text-left font-semibold text-content-main text-sm">
                                                        {children}
                                                    </th>
                                                ),
                                                td: ({ children }) => (
                                                    <td className="px-4 py-3 text-content-main border-b border-border/50 text-[14px] leading-relaxed">
                                                        {children}
                                                    </td>
                                                ),
                                                tr: ({ children }) => (
                                                    <tr className="hover:bg-surface-elevated/50 transition-colors">
                                                        {children}
                                                    </tr>
                                                ),
                                                // 分割线
                                                hr: () => (
                                                    <hr className="my-6 border-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                                                ),
                                                // 链接
                                                a: ({ href, children }) => (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:text-primary-hover underline underline-offset-2 decoration-primary/30 hover:decoration-primary transition-colors"
                                                    >
                                                        {children}
                                                    </a>
                                                ),
                                            }}
                                        >
                                            {analysis.summary}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="text-center py-8">
                                        <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center mx-auto mb-3">
                                            <FileText className="w-6 h-6 text-content-dim" />
                                        </div>
                                        <p className="text-content-dim">No summary available yet</p>
                                        <p className="text-xs text-content-dim mt-1">Analysis will appear after processing</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Methods - HIDDEN (保留代码，暂时不显示)
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
                        */}

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
