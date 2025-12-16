/**
 * Read it DEEP - Paper Graph Component (Timeline v2.0)
 * 
 * 时间线知识树可视化：
 * - 🌿 上方: 被引论文 (学术影响) - 蓝色
 * - 🌳 中心: 当前论文 - 紫金渐变六边形
 * - 🌱 下方: 参考文献 (知识来源) - 绿色
 * 
 * 特性:
 * - 节点大小按引用数缩放
 * - Y轴按年份排列
 * - 点击节点可展开二级引用
 */

import { useMemo, useState, useCallback } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { graphApi } from '../lib/api';
import type { PaperNode as ApiPaperNode } from '../lib/api';

interface PaperGraphProps {
    paperId: string;
}

// Helper: Calculate node size based on citation count
function getNodeSize(citationCount: number | undefined): { width: number; fontSize: number } {
    const count = citationCount || 0;
    if (count >= 1000) return { width: 200, fontSize: 12 };
    if (count >= 100) return { width: 180, fontSize: 11 };
    if (count >= 10) return { width: 160, fontSize: 10 };
    return { width: 140, fontSize: 10 };
}

// Hover Tooltip for paper details
function PaperTooltip({ data, color }: { data: ApiPaperNode; color: 'blue' | 'emerald' }) {
    const bgClass = color === 'blue' ? 'bg-blue-900' : 'bg-emerald-900';
    const borderClass = color === 'blue' ? 'border-blue-400' : 'border-emerald-400';

    return (
        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 ${bgClass} text-white rounded-lg shadow-xl border ${borderClass} opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50`}>
            {/* Arrow */}
            <div className={`absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent ${color === 'blue' ? 'border-t-blue-900' : 'border-t-emerald-900'}`} />

            {/* Title */}
            <div className="font-semibold text-sm leading-tight mb-2 select-text">
                {data.title}
            </div>

            {/* Authors */}
            {data.authors && data.authors.length > 0 && (
                <div className="text-[11px] text-slate-300 mb-1.5 select-text">
                    <span className="text-slate-400">作者: </span>
                    {data.authors.slice(0, 3).join(', ')}
                    {data.authors.length > 3 && ` +${data.authors.length - 3} 人`}
                </div>
            )}

            {/* Venue & Year */}
            <div className="flex items-center gap-3 text-[11px] select-text">
                {data.venue && (
                    <span className="text-slate-300">
                        <span className="text-slate-400">收录: </span>
                        {data.venue}
                    </span>
                )}
                {data.year && (
                    <span className="text-slate-300">
                        <span className="text-slate-400">年份: </span>
                        {data.year}
                    </span>
                )}
            </div>

            {/* Citation count */}
            {data.citation_count !== undefined && data.citation_count > 0 && (
                <div className="text-[10px] text-slate-400 mt-1.5 select-text">
                    被引用 {data.citation_count.toLocaleString()} 次
                </div>
            )}

            {/* S2 Link - only if we have s2_url from API */}
            {data.s2_url && (
                <a
                    href={data.s2_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-slate-300 hover:text-white mt-2 underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    在 Semantic Scholar 查看
                </a>
            )}
        </div>
    );
}

// Current Paper Node (Center) - Hexagon style with glow
function CurrentPaperNode({ data }: { data: { title: string; year?: number } }) {
    return (
        <div className="relative">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-amber-400 rounded-xl blur-md opacity-50 animate-pulse" />
            <div className="relative px-5 py-4 bg-gradient-to-br from-purple-600 via-indigo-600 to-purple-700 text-white rounded-xl shadow-xl min-w-[220px] max-w-[280px] border-2 border-purple-300/30">
                <Handle type="target" position={Position.Top} className="!bg-white !w-3 !h-3" />
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">🌳</span>
                    <span className="text-[10px] font-medium bg-white/20 px-2 py-0.5 rounded-full">当前论文</span>
                </div>
                <div className="text-sm font-bold leading-tight line-clamp-3">
                    {data.title}
                </div>
                {data.year && (
                    <div className="text-[10px] text-purple-200 mt-2">{data.year}</div>
                )}
                <Handle type="source" position={Position.Bottom} className="!bg-white !w-3 !h-3" />
            </div>
        </div>
    );
}

// Citing Paper Node (Blue - Papers that cite this one)
function CitingPaperNode({ data }: { data: ApiPaperNode & { onExpand?: () => void } }) {
    const size = getNodeSize(data.citation_count);

    return (
        <div
            className="group relative cursor-pointer transition-all duration-200 hover:scale-105"
            style={{ width: size.width }}
        >
            {/* Hover Tooltip */}
            <PaperTooltip data={data} color="blue" />
            <div className="px-3 py-2 bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-400 rounded-lg shadow-md hover:shadow-lg hover:border-blue-500 transition-all">
                <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2 !h-2" />
                <div className="flex items-start justify-between gap-1">
                    <div
                        className="font-medium text-blue-800 leading-tight line-clamp-2 flex-1"
                        style={{ fontSize: size.fontSize }}
                    >
                        {data.title}
                    </div>
                    {data.onExpand && (
                        <button
                            onClick={(e) => { e.stopPropagation(); data.onExpand?.(); }}
                            className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="展开二级引用"
                        >
                            <ChevronUp className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-blue-500">
                    {data.year && <span className="font-medium">{data.year}</span>}
                    {data.citation_count !== undefined && data.citation_count > 0 && (
                        <span className="bg-blue-200/50 px-1.5 py-0.5 rounded">
                            引用 {data.citation_count.toLocaleString()}
                        </span>
                    )}
                    {data.venue && <span className="truncate max-w-[80px]">{data.venue}</span>}
                </div>
                <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2 !h-2" />
            </div>
            {/* Indicator: Citing this paper */}
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] text-blue-400 flex items-center gap-0.5">
                <ChevronDown className="w-2 h-2" /> 引用了
            </div>
        </div>
    );
}

// Reference Paper Node (Green - Papers cited by this one)
function ReferencePaperNode({ data }: { data: ApiPaperNode & { onExpand?: () => void } }) {
    const size = getNodeSize(data.citation_count);

    return (
        <div
            className="group relative cursor-pointer transition-all duration-200 hover:scale-105"
            style={{ width: size.width }}
        >
            {/* Hover Tooltip */}
            <PaperTooltip data={data} color="emerald" />
            {/* Indicator: Referenced by this paper */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-emerald-400 flex items-center gap-0.5">
                <ChevronUp className="w-2 h-2" /> 被引用
            </div>
            <div className="px-3 py-2 bg-gradient-to-br from-emerald-50 to-emerald-100 border-2 border-emerald-400 rounded-lg shadow-md hover:shadow-lg hover:border-emerald-500 transition-all">
                <Handle type="target" position={Position.Top} className="!bg-emerald-400 !w-2 !h-2" />
                <div className="flex items-start justify-between gap-1">
                    <div
                        className="font-medium text-emerald-800 leading-tight line-clamp-2 flex-1"
                        style={{ fontSize: size.fontSize }}
                    >
                        {data.title}
                    </div>
                    {data.onExpand && (
                        <button
                            onClick={(e) => { e.stopPropagation(); data.onExpand?.(); }}
                            className="p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="展开引用"
                        >
                            <ChevronDown className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-emerald-500">
                    {data.year && <span className="font-medium">{data.year}</span>}
                    {data.citation_count !== undefined && data.citation_count > 0 && (
                        <span className="bg-emerald-200/50 px-1.5 py-0.5 rounded">
                            引用 {data.citation_count.toLocaleString()}
                        </span>
                    )}
                    {data.venue && <span className="truncate max-w-[80px]">{data.venue}</span>}
                </div>
                <Handle type="source" position={Position.Bottom} className="!bg-emerald-400 !w-2 !h-2" />
            </div>
        </div>
    );
}

const nodeTypes = {
    current: CurrentPaperNode,
    citing: CitingPaperNode,
    reference: ReferencePaperNode,
};

export default function PaperGraph({ paperId }: PaperGraphProps) {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [_expandedData, setExpandedData] = useState<Map<string, { nodes: ApiPaperNode[], edges: { source: string; target: string; relation: string }[] }>>(new Map());
    const [_isExpanding, setIsExpanding] = useState<string | null>(null);

    // Fetch graph data
    const { data: graphData, isLoading, error } = useQuery({
        queryKey: ['paper-graph', paperId],
        queryFn: () => graphApi.get(paperId, {
            include_citations: true,
            include_references: true,
            include_recommendations: false,
            limit: 10,
        }),
        retry: false,
        staleTime: 5 * 60 * 1000,
    });

    const handleExpandNode = useCallback(async (nodeId: string, externalId: string) => {
        if (expandedNodes.has(nodeId)) {
            // Collapse: remove from expanded set
            setExpandedNodes(prev => {
                const next = new Set(prev);
                next.delete(nodeId);
                return next;
            });
            return;
        }

        // Expand: fetch second-level data
        setIsExpanding(nodeId);
        try {
            const data = await graphApi.expand(paperId, externalId, 5);
            setExpandedData(prev => {
                const next = new Map(prev);
                next.set(nodeId, {
                    nodes: data.nodes,
                    edges: data.edges.map(e => ({ source: e.source, target: e.target, relation: e.relation })),
                });
                return next;
            });
            setExpandedNodes(prev => {
                const next = new Set(prev);
                next.add(nodeId);
                return next;
            });
        } catch (err) {
            console.error('Expand error:', err);
        } finally {
            setIsExpanding(null);
        }
    }, [expandedNodes, paperId]);

    // Transform API data to React Flow format with timeline layout
    const { initialNodes, initialEdges } = useMemo(() => {
        if (!graphData) return { initialNodes: [], initialEdges: [] };

        const nodes: Node[] = [];
        const edges: Edge[] = [];
        // Extract year from arXiv ID (format: YYMM.xxxxx, e.g. 2507.18882 = July 2025)
        let currentYear = 2024;
        const externalId = graphData.current_paper.external_id || '';
        const arxivMatch = externalId.match(/(\d{2})(\d{2})\.\d+/);
        if (arxivMatch) {
            // YYMM format: first 2 digits are year (20XX), next 2 are month
            const yearPart = parseInt(arxivMatch[1]);
            currentYear = 2000 + yearPart; // e.g., 25 -> 2025
        }

        // Center: Current paper
        const centerX = 350;
        const centerY = 300;

        nodes.push({
            id: 'current',
            type: 'current',
            position: { x: centerX - 110, y: centerY },
            data: {
                title: graphData.current_paper.title,
                year: currentYear,
            },
            draggable: true,
        });

        // Get citations (papers citing this one) and references
        const citingEdges = graphData.edges.filter(e => e.relation === 'cited_by');
        const referenceEdges = graphData.edges.filter(e => e.relation === 'cites');

        // Layout citing papers (above center) - sorted by year descending
        const citingNodes = citingEdges
            .map(edge => graphData.nodes.find(n => n.id === edge.source))
            .filter((n): n is ApiPaperNode => n !== undefined)
            .sort((a, b) => (b.year || 0) - (a.year || 0));

        citingNodes.forEach((node, i) => {
            const cols = Math.min(citingNodes.length, 4);
            const row = Math.floor(i / cols);
            const col = i % cols;
            const xOffset = (col - (Math.min(cols, citingNodes.length - row * cols) - 1) / 2) * 200;
            const yOffset = row * 120;

            nodes.push({
                id: node.id,
                type: 'citing',
                position: { x: centerX + xOffset - 70, y: centerY - 180 - yOffset },
                data: {
                    ...node,
                    onExpand: node.external_id ? () => handleExpandNode(node.id, node.external_id!) : undefined,
                },
                draggable: true,
            });

            edges.push({
                id: `cite-${node.id}`,
                source: node.id,
                target: 'current',
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#3B82F6', strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#3B82F6', width: 15, height: 15 },
            });
        });

        // Layout reference papers (below center) - sorted by year ascending
        const referenceNodes = referenceEdges
            .map(edge => graphData.nodes.find(n => n.id === edge.target))
            .filter((n): n is ApiPaperNode => n !== undefined)
            .sort((a, b) => (a.year || 0) - (b.year || 0));

        referenceNodes.forEach((node, i) => {
            const cols = Math.min(referenceNodes.length, 4);
            const row = Math.floor(i / cols);
            const col = i % cols;
            const xOffset = (col - (Math.min(cols, referenceNodes.length - row * cols) - 1) / 2) * 200;
            const yOffset = row * 120;

            nodes.push({
                id: node.id,
                type: 'reference',
                position: { x: centerX + xOffset - 70, y: centerY + 180 + yOffset },
                data: {
                    ...node,
                    onExpand: node.external_id ? () => handleExpandNode(node.id, node.external_id!) : undefined,
                },
                draggable: true,
            });

            edges.push({
                id: `ref-${node.id}`,
                source: 'current',
                target: node.id,
                type: 'smoothstep',
                animated: false,
                style: { stroke: '#10B981', strokeWidth: 2, strokeDasharray: '5,5' },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981', width: 15, height: 15 },
            });
        });

        return { initialNodes: nodes, initialEdges: edges };
    }, [graphData, handleExpandNode]);

    // Calculate adaptive height based on node count
    const graphHeight = useMemo(() => {
        const nodeCount = initialNodes.length;
        if (nodeCount <= 3) return 300;
        if (nodeCount <= 6) return 450;
        if (nodeCount <= 10) return 550;
        return 650;
    }, [initialNodes.length]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update when data changes
    useMemo(() => {
        if (initialNodes.length > 0) {
            setNodes(initialNodes);
            setEdges(initialEdges);
        }
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    // Loading state
    if (isLoading) {
        return (
            <div className="h-[400px] flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">正在加载关系图谱...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="h-[200px] flex items-center justify-center bg-red-50 rounded-xl border border-red-100">
                <p className="text-sm text-red-600">加载失败</p>
            </div>
        );
    }

    // No external ID
    if (!graphData) {
        return (
            <div className="h-[200px] flex items-center justify-center bg-amber-50 rounded-xl border border-amber-200">
                <div className="text-center">
                    <p className="text-sm text-amber-600">暂无图谱数据</p>
                    <p className="text-xs text-amber-400 mt-1">需要 DOI 或 ArXiv ID</p>
                </div>
            </div>
        );
    }

    // No citations or references
    if (graphData.nodes.length === 0) {
        return (
            <div className="h-[200px] flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-center px-4">
                    <p className="text-sm text-slate-600 line-clamp-1">📄 {graphData.current_paper.title}</p>
                    <p className="text-xs text-slate-400 mt-2">Semantic Scholar 暂无引用/参考数据</p>
                    {graphData.current_paper.external_id && (
                        <p className="text-xs text-indigo-500 mt-1">ID: {graphData.current_paper.external_id}</p>
                    )}
                </div>
            </div>
        );
    }

    // Main graph view - height adapts to content
    return (
        <div
            className="border border-slate-200 rounded-xl overflow-hidden bg-gradient-to-b from-blue-50/30 via-white to-emerald-50/30 relative transition-all duration-300"
            style={{ height: graphHeight }}
        >
            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 text-[10px]">
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-slate-500">引用此论文</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-slate-500">被此论文引用</span>
                    </div>
                </div>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.3}
                maxZoom={1.5}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                }}
            >
                <Background color="#e2e8f0" gap={20} size={1} />
                <Controls className="!bg-white/90 !backdrop-blur-sm !border-slate-200" />
            </ReactFlow>
        </div>
    );
}
