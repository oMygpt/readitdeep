/**
 * Read it DEEP - Structure Panel Component
 * 
 * 显示论文的文档结构 (LangGraph Structure Agent 结果)
 */

import { useQuery } from '@tanstack/react-query';
import { List, Loader2, FileText } from 'lucide-react';
import { analysisApi } from '../lib/api';
import type { TextLocation } from '../lib/api';

interface StructurePanelProps {
    paperId: string;
    onJumpToLine: (location: TextLocation) => void;
}

export default function StructurePanel({ paperId, onJumpToLine }: StructurePanelProps) {
    // 获取分析结果 (复用 AnalysisPanel 的 queryKey，利用缓存)
    const { data: analysis, isLoading, error } = useQuery({
        queryKey: ['analysis', paperId],
        queryFn: () => analysisApi.get(paperId),
    });

    const handleJump = (location: TextLocation) => {
        onJumpToLine(location);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-content-muted">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <span className="text-xs">加载结构中...</span>
            </div>
        );
    }

    if (error || !analysis) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-content-dim">
                <List className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-xs">暂无结构信息</span>
            </div>
        );
    }

    const sections = analysis.structure?.sections || [];

    return (
        <div className="p-4">
            <h3 className="text-sm font-semibold text-content-main mb-3 flex items-center gap-2">
                <List className="w-4 h-4 text-primary" />
                文档结构
            </h3>

            {sections.length > 0 ? (
                <div className="space-y-1">
                    {sections.map((section, i) => (
                        <button
                            key={i}
                            onClick={() =>
                                handleJump({
                                    start_line: section.start_line,
                                    end_line: section.start_line + 5,
                                    text_snippet: section.title,
                                })
                            }
                            className="w-full text-left text-xs text-content-main hover:text-primary hover:bg-primary/10 rounded px-2 py-1.5 transition-colors group flex items-start"
                            style={{ paddingLeft: `${8 + (section.level - 1) * 12}px` }}
                        >
                            <span className="mt-0.5 mr-1.5 text-content-dim group-hover:text-primary opacity-70">
                                •
                            </span>
                            <span className="truncate">{section.title}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-8 text-content-dim text-center border border-dashed border-border rounded-lg bg-surface-elevated">
                    <FileText className="w-6 h-6 mb-2 opacity-50" />
                    <span className="text-xs">未识别到目录结构</span>
                    <p className="text-[10px] text-content-muted mt-1">
                        请确认分析任务是否已完成
                    </p>
                </div>
            )}
        </div>
    );
}
