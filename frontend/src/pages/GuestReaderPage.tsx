/**
 * Read it DEEP - Guest Reader Page
 * 
 * 访客阅读页面 - 通过分享链接访问
 * 只读模式，不包含用户笔记、高亮、翻译等功能
 * 
 * 样式与注册用户 ReaderPage 保持一致
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import {
    Loader2,
    ArrowLeft,
    BookOpen,
    Compass,
    PanelRightClose,
    PanelRight,
    AlertTriangle,
    LogIn,
    ChevronDown,
    ChevronRight,
    Network,
    FileText,
    Database,
    Code,
    ExternalLink,
    Sparkles,
    Users,
} from 'lucide-react';
import { shareApi } from '../lib/api';
import type { StructureSection } from '../lib/api';
import GuestWorkbench from '../components/GuestWorkbench';
import PaperGraph from '../components/PaperGraph';

import 'katex/dist/katex.min.css';

type ViewMode = 'read' | 'explore';

export default function GuestReaderPage() {
    const { t } = useTranslation();
    const { shareToken } = useParams<{ shareToken: string }>();

    const [viewMode, setViewMode] = useState<ViewMode>('explore');
    const [showWorkbench, setShowWorkbench] = useState(true);
    const [tocExpanded, setTocExpanded] = useState(true);
    const [fontSize] = useState<number>(1.2);

    const contentRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLElement>(null);

    // Fetch paper info
    const { data: paperInfo, isLoading: isPaperLoading, error: paperError } = useQuery({
        queryKey: ['guest-paper', shareToken],
        queryFn: () => shareApi.getGuestPaper(shareToken!),
        enabled: !!shareToken,
        retry: false,
    });

    // Fetch paper content
    const { data: content } = useQuery({
        queryKey: ['guest-content', shareToken],
        queryFn: () => shareApi.getGuestContent(shareToken!),
        enabled: !!shareToken && !!paperInfo,
    });

    // Fetch analysis
    const { data: analysis } = useQuery({
        queryKey: ['guest-analysis', shareToken],
        queryFn: () => shareApi.getGuestAnalysis(shareToken!),
        enabled: !!shareToken && !!paperInfo,
    });

    // Parse table of contents from structure
    const tableOfContents = useMemo(() => {
        if (!analysis?.structure?.sections) return [];
        return analysis.structure.sections;
    }, [analysis?.structure]);

    // Jump to line handler
    const handleJumpToLine = useCallback((location: { start_line: number; end_line: number }) => {
        if (!mainContentRef.current || !location.start_line) return;

        const allElements = mainContentRef.current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, span');

        // Try to find by line ID first
        const lineEl = document.getElementById(`line-${location.start_line}`);
        if (lineEl) {
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            lineEl.classList.add('highlight-ref');
            setTimeout(() => lineEl.classList.remove('highlight-ref'), 2000);
            return;
        }

        // Fallback: scroll to first matching element
        if (allElements.length > location.start_line) {
            const el = allElements[location.start_line - 1];
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-ref');
            setTimeout(() => el.classList.remove('highlight-ref'), 2000);
        }
    }, []);

    // Jump to TOC section
    const handleTocClick = (section: StructureSection) => {
        handleJumpToLine({ start_line: section.start_line, end_line: section.start_line });
    };

    // Dynamic Style Generation (matches ReaderPage)
    const getStyles = () => {
        return `
            .citation-sup { vertical-align: super; font-size: 0.75em; }
            .markdown-content code { font-family: 'Courier New', Courier, monospace; background-color: #f1f5f9; color: #334155; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.85em; }
            .markdown-content pre { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 1.25rem; border-radius: 6px; margin-bottom: 1.5rem; overflow-x: auto; }
            .markdown-content blockquote { border-left: 4px solid #e2e8f0; padding-left: 1rem; font-style: italic; color: #4b5563; margin-bottom: 1.5rem; }
            
            /* Table Styling */
            .markdown-content table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-size: 0.9em; border: 1px solid #e2e8f0; }
            .markdown-content th { background-color: #f8fafc; font-weight: bold; border: 1px solid #cbd5e1; padding: 0.75rem; text-align: left; }
            .markdown-content td { border: 1px solid #e2e8f0; padding: 0.75rem; vertical-align: top; }
            .markdown-content tr:nth-child(even) { background-color: #fcfcfc; }

            /* Highlight Animation */
            @keyframes highlight-fade {
                0% { background-color: rgba(253, 224, 71, 0.5); }
                100% { background-color: transparent; }
            }
            .highlight-ref {
                animation: highlight-fade 2s ease-out forwards;
                border-radius: 4px;
                padding: 2px 4px;
            }

            /* Standard ReaditDeep (Zen) Style */
            .markdown-content { font-family: 'Merriweather', 'Source Serif 4', 'Times New Roman', serif; color: var(--color-text-dim); font-style: normal; }
            .markdown-content h1 { font-family: 'Merriweather', 'Source Serif 4', serif; font-size: 2.25rem; font-weight: 700; text-align: center; margin-bottom: 2.5rem; line-height: 1.3; color: var(--color-text-main); }
            .markdown-content h2 { font-family: 'Inter', sans-serif; font-size: 1.5rem; font-weight: 600; margin-top: 3rem; margin-bottom: 1.5rem; color: var(--color-text-main); letter-spacing: -0.025em; }
            .markdown-content h3 { font-family: 'Inter', sans-serif; font-size: 1.25rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; color: var(--color-text-dim); }
            .markdown-content p { font-size: ${fontSize}rem; line-height: 1.8; text-align: justify; margin-bottom: 1.5rem; color: var(--color-text-dim); }
            .markdown-content li { font-size: ${fontSize}rem; line-height: 1.8; margin-bottom: 0.5rem; }
            .markdown-content ul, .markdown-content ol { margin: 1rem 0; padding-left: 1.5rem; }
        `;
    };

    // Error state
    if (paperError) {
        const errorMessage = (paperError as Error & { response?: { status: number } })?.response?.status === 410
            ? t('share.linkExpired', '分享链接已过期')
            : t('share.linkInvalid', '分享链接无效或已失效');

        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-surface rounded-2xl p-8 text-center shadow-lg border border-border">
                    <AlertTriangle className="w-16 h-16 text-warning mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-content-main mb-2">
                        {t('share.accessDenied', '无法访问')}
                    </h1>
                    <p className="text-content-muted mb-6">{errorMessage}</p>
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors"
                    >
                        <LogIn className="w-4 h-4" />
                        {t('auth.login', '登录')}
                    </Link>
                </div>
            </div>
        );
    }

    // Loading state
    if (isPaperLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
                    <p className="text-content-muted">{t('common.loading', '加载中...')}</p>
                </div>
            </div>
        );
    }

    const markdownContent = content?.markdown || '';
    const paperTitle = paperInfo?.title || paperInfo?.filename || 'Untitled';

    // ========== EXPLORE MODE ==========
    if (viewMode === 'explore') {
        return (
            <div className="min-h-screen bg-background">
                {/* Header - Same as ExploreOverview */}
                <header className="bg-surface/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
                    <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link
                                to="/"
                                className="p-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Link>
                            <div className="flex-1 min-w-0">
                                <h1 className="text-xl font-bold text-content-main line-clamp-1">
                                    {paperTitle}
                                </h1>
                                {/* Authors */}
                                {paperInfo?.authors && (() => {
                                    try {
                                        const authors = JSON.parse(paperInfo.authors);
                                        if (Array.isArray(authors) && authors.length > 0) {
                                            const displayAuthors = authors.slice(0, 3).join(', ');
                                            const hasMore = authors.length > 3;
                                            return (
                                                <p className="text-sm text-content-muted flex items-center gap-1 truncate">
                                                    <Users className="w-3 h-3 flex-shrink-0" />
                                                    <span className="truncate">
                                                        {displayAuthors}{hasMore ? ` +${authors.length - 3}人` : ''}
                                                    </span>
                                                </p>
                                            );
                                        }
                                    } catch { } return null;
                                })()}
                                <p className="text-sm text-content-muted flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    {t('share.guestViewOnly', '访客浏览模式')}
                                    {paperInfo?.owner_name && (
                                        <span className="ml-2">
                                            · {t('share.sharedBy', '由 {{name}} 分享', { name: paperInfo.owner_name })}
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setViewMode('read')}
                                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors font-medium shadow-lg shadow-primary/20"
                            >
                                <BookOpen className="w-4 h-4" />
                                开始阅读
                                <ChevronRight className="w-4 h-4" />
                            </button>
                            <Link
                                to="/login"
                                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-colors font-medium"
                            >
                                <LogIn className="w-4 h-4" />
                                登录解锁更多
                            </Link>
                        </div>
                    </div>
                </header>

                {/* Main Content - Waterfall Layout (same as ExploreOverview) */}
                <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                    {/* Citation Graph */}
                    <section className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                            <div className="p-2 bg-info/10 rounded-lg">
                                <Network className="w-5 h-5 text-info" />
                            </div>
                            <h2 className="text-lg font-bold text-content-main">论文关系图谱</h2>
                        </div>
                        <div className="min-h-[300px]">
                            <PaperGraph paperId={paperInfo?.paper_id || ''} />
                        </div>
                    </section>

                    {/* Paper Overview / Summary */}
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
                                    <FileText className="w-12 h-12 text-content-dim mx-auto mb-3 opacity-30" />
                                    <p className="text-content-dim">暂无概要</p>
                                </div>
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
                                            <li key={idx} className="p-3 bg-surface-elevated rounded-lg border border-border">
                                                <div className="font-medium text-content-main">{item.name}</div>
                                                {item.description && (
                                                    <p className="text-sm text-content-muted mt-1">{item.description}</p>
                                                )}
                                                {item.url && (
                                                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
                                                        <ExternalLink className="w-3 h-3" />{item.url}
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
                                            <li key={idx} className="p-3 bg-surface-elevated rounded-lg border border-border">
                                                <div className="font-medium text-content-main flex items-center gap-2">
                                                    <Code className="w-4 h-4 text-content-dim" />
                                                    Repository
                                                </div>
                                                {item.repo_url && (
                                                    <a href={item.repo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
                                                        <ExternalLink className="w-3 h-3" />{item.repo_url}
                                                    </a>
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

                    {/* CTA to Start Reading */}
                    <div className="text-center py-8">
                        <button
                            onClick={() => setViewMode('read')}
                            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-primary-content rounded-xl hover:from-primary-hover hover:to-secondary-hover transition-all font-semibold text-lg shadow-xl shadow-primary/20 hover:shadow-2xl hover:-translate-y-0.5"
                        >
                            <BookOpen className="w-5 h-5" />
                            🚀 开始阅读论文
                        </button>
                        <p className="text-content-muted text-sm mt-4">
                            <Link to="/login" className="text-primary hover:underline">登录</Link>
                            {' '}以添加笔记、高亮和翻译
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    // ========== READ MODE ==========
    return (
        <div className="flex flex-col h-screen bg-background text-content-main font-sans transition-colors duration-500 overflow-hidden relative">
            {/* Dynamic CSS Injection */}
            <style>{getStyles()}</style>

            {/* Top Navigation Toolbar */}
            <header className="h-16 border-b border-border bg-surface flex items-center justify-between px-6 z-50 transition-all duration-300 shadow-sm">
                <div className="flex items-center gap-3">
                    <button onClick={() => setViewMode('explore')} className="p-2 -ml-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-content-main truncate max-w-[300px]">{paperTitle}</span>
                        <span className="text-xs text-content-muted bg-surface-elevated px-2 py-0.5 rounded-full">
                            👁️ 访客阅读
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Mode Switcher */}
                    <div className="flex items-center bg-surface-elevated rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('explore')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors text-content-muted hover:text-content-main hover:bg-surface-hover"
                        >
                            <Compass className="w-4 h-4" />
                            概览
                        </button>
                        <button
                            onClick={() => setViewMode('read')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors bg-primary text-primary-content"
                        >
                            <BookOpen className="w-4 h-4" />
                            阅读
                        </button>
                    </div>

                    {/* Workbench Toggle */}
                    <button
                        onClick={() => setShowWorkbench(!showWorkbench)}
                        className="p-2 text-content-muted hover:text-content-main hover:bg-surface-hover rounded-lg transition-colors"
                        title={showWorkbench ? '隐藏工作台' : '显示工作台'}
                    >
                        {showWorkbench ? <PanelRightClose className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
                    </button>

                    {/* Login CTA */}
                    <Link
                        to="/login"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-content rounded-lg text-sm hover:bg-primary-hover transition-colors"
                    >
                        <LogIn className="w-4 h-4" />
                        登录
                    </Link>
                </div>
            </header>

            {/* Main Content Layout */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - TOC */}
                {tableOfContents.length > 0 && (
                    <aside className="w-64 bg-surface border-r border-border flex-shrink-0 overflow-y-auto">
                        <div className="p-4">
                            <button
                                onClick={() => setTocExpanded(!tocExpanded)}
                                className="flex items-center gap-2 w-full text-sm font-semibold text-content-main mb-3"
                            >
                                {tocExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                目录
                            </button>
                            {tocExpanded && (
                                <nav className="space-y-1">
                                    {tableOfContents.map((section, i) => (
                                        <button
                                            key={i}
                                            onClick={() => handleTocClick(section)}
                                            className="block w-full text-left text-xs text-content-muted hover:text-content-main hover:bg-surface-hover rounded px-2 py-1.5 truncate transition-colors"
                                            style={{ paddingLeft: `${(section.level - 1) * 12 + 8}px` }}
                                        >
                                            {section.title}
                                        </button>
                                    ))}
                                </nav>
                            )}
                        </div>
                    </aside>
                )}

                {/* Main Content - Paper Text */}
                <main ref={mainContentRef} className="flex-1 overflow-y-auto bg-background" id="guest-reader-main">
                    <div className="max-w-4xl mx-auto px-8 py-12" ref={contentRef}>
                        <article className="markdown-content">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeRaw, rehypeKatex]}
                            >
                                {markdownContent}
                            </ReactMarkdown>
                        </article>
                    </div>
                </main>

                {/* Right Sidebar - Workbench */}
                {showWorkbench && (
                    <aside className="w-80 bg-surface border-l border-border flex-shrink-0 overflow-hidden">
                        <GuestWorkbench
                            methods={analysis?.methods || []}
                            datasets={analysis?.datasets || []}
                            codeRefs={analysis?.code_refs || []}
                            onJumpToLocation={handleJumpToLine}
                        />
                    </aside>
                )}
            </div>
        </div>
    );
}
