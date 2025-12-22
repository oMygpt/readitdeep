import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleMarkdownProps {
    content: string;
    maxHeight?: number;
    className?: string;
    fontSize?: string;
}

export default function CollapsibleMarkdown({
    content,
    maxHeight = 200,
    className = '',
    fontSize = 'text-xs',
}: CollapsibleMarkdownProps) {
    const [expanded, setExpanded] = useState(false);
    const [shouldTruncate, setShouldTruncate] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Check if content exceeds max height
    useEffect(() => {
        if (contentRef.current) {
            setShouldTruncate(contentRef.current.scrollHeight > maxHeight);
        }
    }, [content, maxHeight]);

    const displayStyle = useMemo(() => {
        if (expanded || !shouldTruncate) {
            return {};
        }
        return {
            maxHeight: `${maxHeight}px`,
            overflow: 'hidden',
            maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
        };
    }, [expanded, shouldTruncate, maxHeight]);

    return (
        <div className={`relative ${className}`}>
            <div
                ref={contentRef}
                style={displayStyle}
                className={`prose dark:prose-invert max-w-none text-content-main prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 ${fontSize} prose-headings:text-content-main prose-a:text-primary prose-blockquote:border-l-primary prose-blockquote:bg-surface-elevated prose-blockquote:py-1 prose-blockquote:px-2 prose-blockquote:not-italic prose-table:text-xs prose-th:p-2 prose-td:p-2 prose-tr:border-b-border`}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                    components={{
                        a: ({ node, ...props }) => (
                            <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary-hover no-underline hover:underline cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                            />
                        ),
                        p: ({ node, ...props }) => <p {...props} className="leading-relaxed" />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>

            {shouldTruncate && (
                <div className="flex justify-center mt-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(!expanded);
                        }}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors bg-surface/80 px-2 py-0.5 rounded backdrop-blur-sm"
                    >
                        {expanded ? (
                            <>
                                <ChevronUp className="w-3 h-3" />
                                收起
                            </>
                        ) : (
                            <>
                                <ChevronDown className="w-3 h-3" />
                                展开全文
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
