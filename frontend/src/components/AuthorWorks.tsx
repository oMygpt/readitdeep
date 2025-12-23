/**
 * Read it DEEP - Author Works Component
 * 
 * 显示论文作者及其主要论文列表：
 * - 👤 作者信息（名称、机构、论文数、引用数）
 * - 📄 作者的高引用论文列表
 */

import { useQuery } from '@tanstack/react-query';
import {
    User,
    Building,
    BookOpen,
    TrendingUp,
    ExternalLink,
    Loader2,
    ChevronDown,
    ChevronRight,
    AlertCircle,
} from 'lucide-react';
import { useState } from 'react';
import { authorsApi, type AuthorWithWorks, type AuthorWork } from '../lib/api';

interface AuthorWorksProps {
    paperId: string;
}

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function WorkItem({ work }: { work: AuthorWork }) {
    const url = work.doi
        ? `https://doi.org/${work.doi}`
        : work.openalex_url;

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-3 bg-surface-elevated rounded-lg border border-border hover:border-primary/30 transition-colors group"
        >
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-content-main group-hover:text-primary transition-colors line-clamp-2">
                    {work.title}
                </h4>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-content-muted">
                    {work.year && <span>{work.year}</span>}
                    {work.venue && (
                        <span className="truncate max-w-[150px]" title={work.venue}>
                            {work.venue}
                        </span>
                    )}
                    {work.citation_count !== undefined && work.citation_count > 0 && (
                        <span className="flex items-center gap-1 text-amber-600">
                            <TrendingUp className="w-3 h-3" />
                            {formatNumber(work.citation_count)}
                        </span>
                    )}
                </div>
            </div>
            <ExternalLink className="w-4 h-4 text-content-dim group-hover:text-primary flex-shrink-0 mt-0.5" />
        </a>
    );
}

function AuthorCard({ author, defaultExpanded = false }: { author: AuthorWithWorks; defaultExpanded?: boolean }) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-surface">
            {/* Author Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated transition-colors text-left"
            >
                <div className="p-2 bg-purple-500/10 rounded-full">
                    <User className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-content-main truncate">
                        {author.display_name}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-content-muted mt-0.5">
                        {author.affiliation && (
                            <span className="flex items-center gap-1 truncate max-w-[200px]" title={author.affiliation}>
                                <Building className="w-3 h-3" />
                                {author.affiliation}
                            </span>
                        )}
                        <span className="flex items-center gap-1">
                            <BookOpen className="w-3 h-3" />
                            {formatNumber(author.works_count)} 篇
                        </span>
                        <span className="flex items-center gap-1 text-amber-600">
                            <TrendingUp className="w-3 h-3" />
                            {formatNumber(author.cited_by_count)} 引用
                        </span>
                    </div>
                </div>
                {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-content-dim" />
                ) : (
                    <ChevronRight className="w-5 h-5 text-content-dim" />
                )}
            </button>

            {/* Works List */}
            {isExpanded && (
                <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                    {author.top_works.length > 0 ? (
                        author.top_works.map((work, idx) => (
                            <WorkItem key={idx} work={work} />
                        ))
                    ) : (
                        <p className="text-sm text-content-dim italic py-2">
                            暂无论文数据
                        </p>
                    )}

                    {/* OpenAlex Profile Link */}
                    <a
                        href={author.openalex_id}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                    >
                        <ExternalLink className="w-3 h-3" />
                        在 OpenAlex 查看完整资料
                    </a>
                </div>
            )}
        </div>
    );
}

export default function AuthorWorks({ paperId }: AuthorWorksProps) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['authors-works', paperId],
        queryFn: () => authorsApi.getAuthorsWorks(paperId, 5),
        retry: false,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-sm text-content-muted">正在加载作者信息...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-center text-error">
                    <AlertCircle className="w-8 h-8 mx-auto mb-3" />
                    <p className="text-sm">加载作者信息失败</p>
                </div>
            </div>
        );
    }

    if (!data || data.authors.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-center">
                    <User className="w-10 h-10 text-content-dim mx-auto mb-3" />
                    <p className="text-content-dim">暂无作者信息</p>
                    <p className="text-xs text-content-dim mt-1">
                        需要论文的 DOI 或 arXiv ID 来获取作者数据
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* 作者网格 - 响应式并列布局 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.authors.map((author, idx) => (
                    <AuthorCard
                        key={author.openalex_id || idx}
                        author={author}
                        defaultExpanded={false}
                    />
                ))}
            </div>
        </div>
    );
}
