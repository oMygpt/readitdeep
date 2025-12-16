/**
 * Read it DEEP - Paper Graph Component
 * 
 * 使用 React Flow 显示论文关系图:
 * - 本地论文: 蓝色实线边框
 * - 幽灵节点: 灰色虚线边框
 * - 边类型: cites, cited_by, similar, recommended
 */

import React, { useMemo } from 'react';
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
import { useNavigate } from 'react-router-dom';
import { Loader2, Download } from 'lucide-react';
import { graphApi } from '../lib/api';
import type { PaperNode as ApiPaperNode } from '../lib/api';

interface PaperGraphProps {
    paperId: string;
}

// Custom Node Component for Local Papers
function LocalPaperNode({ data }: { data: ApiPaperNode & { onClick?: () => void } }) {
    return (
        <div
            className="px-3 py-2 bg-white border-2 border-indigo-500 rounded-lg shadow-md min-w-[180px] max-w-[220px] cursor-pointer hover:shadow-lg transition-shadow"
            onClick={data.onClick}
        >
            <Handle type="target" position={Position.Top} className="!bg-indigo-500" />
            <div className="text-xs font-semibold text-indigo-700 mb-1 line-clamp-2">
                {data.title}
            </div>
            <div className="text-[10px] text-slate-500">
                {data.year && <span>{data.year}</span>}
                {data.citation_count !== undefined && (
                    <span className="ml-2">📄 {data.citation_count}</span>
                )}
            </div>
            <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
        </div>
    );
}

// Custom Node Component for Ghost Papers (External)
function GhostPaperNode({ data }: { data: ApiPaperNode & { onDownload?: () => void } }) {
    return (
        <div className="px-3 py-2 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg min-w-[180px] max-w-[220px]">
            <Handle type="target" position={Position.Top} className="!bg-slate-400" />
            <div className="flex items-start justify-between gap-1">
                <div className="text-xs font-medium text-slate-600 mb-1 line-clamp-2 flex-1">
                    👻 {data.title}
                </div>
                {data.external_id && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            data.onDownload?.();
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        title="下载论文"
                    >
                        <Download className="w-3 h-3" />
                    </button>
                )}
            </div>
            <div className="text-[10px] text-slate-400">
                {data.year && <span>{data.year}</span>}
                {data.venue && <span className="ml-2">{data.venue}</span>}
                {data.citation_count !== undefined && data.citation_count > 0 && (
                    <span className="ml-2">📄 {data.citation_count.toLocaleString()}</span>
                )}
            </div>
            <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
        </div>
    );
}

// Current Paper Node (Center)
function CurrentPaperNode({ data }: { data: { title: string } }) {
    return (
        <div className="px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg min-w-[200px] max-w-[250px]">
            <Handle type="target" position={Position.Top} className="!bg-white" />
            <div className="text-sm font-bold mb-1 line-clamp-2">
                📄 {data.title}
            </div>
            <div className="text-[10px] text-indigo-200">当前论文</div>
            <Handle type="source" position={Position.Bottom} className="!bg-white" />
        </div>
    );
}

const nodeTypes = {
    local: LocalPaperNode,
    ghost: GhostPaperNode,
    current: CurrentPaperNode,
};

export default function PaperGraph({ paperId }: PaperGraphProps) {
    const navigate = useNavigate();

    // Fetch graph data
    const { data: graphData, isLoading, error, isFetching } = useQuery({
        queryKey: ['paper-graph', paperId],
        queryFn: () => graphApi.get(paperId, {
            include_citations: true,
            include_references: true,
            include_recommendations: false,
            limit: 8,
        }),
        retry: false,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // Transform API data to React Flow format
    const { initialNodes, initialEdges } = useMemo(() => {
        if (!graphData) return { initialNodes: [], initialEdges: [] };

        const nodes: Node[] = [];
        const edges: Edge[] = [];

        // Add current paper at center
        nodes.push({
            id: 'current',
            type: 'current',
            position: { x: 250, y: 200 },
            data: { title: graphData.current_paper.title },
        });

        // Layout: citations on top, references on bottom
        const citations = graphData.edges.filter(e => e.relation === 'cited_by');
        const references = graphData.edges.filter(e => e.relation === 'cites');

        // Add citation nodes (top row)
        citations.forEach((edge, i) => {
            const node = graphData.nodes.find(n => n.id === edge.source);
            if (!node) return;

            const xOffset = (i - (citations.length - 1) / 2) * 220;
            nodes.push({
                id: node.id,
                type: node.is_local ? 'local' : 'ghost',
                position: { x: 250 + xOffset, y: 0 },
                data: {
                    ...node,
                    onClick: node.is_local ? () => navigate(`/reader/${node.id}`) : undefined,
                    onDownload: !node.is_local ? () => {
                        // TODO: Implement download from S2
                        console.log('Download:', node.external_id);
                    } : undefined,
                },
            });

            edges.push({
                id: `${edge.source}-${edge.target}`,
                source: node.id,
                target: 'current',
                type: 'smoothstep',
                animated: false,
                style: { stroke: '#94a3b8' },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
                label: '引用',
                labelStyle: { fontSize: 10, fill: '#94a3b8' },
            });
        });

        // Add reference nodes (bottom row)
        references.forEach((edge, i) => {
            const node = graphData.nodes.find(n => n.id === edge.target);
            if (!node) return;

            const xOffset = (i - (references.length - 1) / 2) * 220;
            nodes.push({
                id: node.id,
                type: node.is_local ? 'local' : 'ghost',
                position: { x: 250 + xOffset, y: 400 },
                data: {
                    ...node,
                    onClick: node.is_local ? () => navigate(`/reader/${node.id}`) : undefined,
                    onDownload: !node.is_local ? () => {
                        console.log('Download:', node.external_id);
                    } : undefined,
                },
            });

            edges.push({
                id: `${edge.source}-${edge.target}`,
                source: 'current',
                target: node.id,
                type: 'smoothstep',
                animated: false,
                style: { stroke: '#6366f1' },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
                label: '参考',
                labelStyle: { fontSize: 10, fill: '#6366f1' },
            });
        });

        return { initialNodes: nodes, initialEdges: edges };
    }, [graphData, navigate]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update when data changes
    React.useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    if (isLoading || isFetching) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">加载关系图...</p>
                </div>
            </div>
        );
    }

    if (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        return (
            <div className="h-[200px] flex items-center justify-center bg-red-50 rounded-lg border border-red-200">
                <div className="text-center px-4">
                    <p className="text-sm text-red-600 font-medium">加载失败</p>
                    <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
                    <p className="text-xs text-slate-400 mt-2">请确保论文包含 DOI 或 ArXiv ID</p>
                </div>
            </div>
        );
    }

    if (!graphData) {
        return (
            <div className="h-[200px] flex items-center justify-center bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-center">
                    <p className="text-sm text-amber-600">暂无数据</p>
                    <p className="text-xs text-amber-400 mt-1">需要 DOI 或 ArXiv ID</p>
                </div>
            </div>
        );
    }

    if (graphData.nodes.length === 0) {
        return (
            <div className="h-[200px] flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-center px-4">
                    <p className="text-sm text-slate-600">📄 {graphData.current_paper.title.substring(0, 30)}...</p>
                    <p className="text-xs text-slate-400 mt-2">Semantic Scholar 未找到引用信息</p>
                    {graphData.current_paper.external_id && (
                        <p className="text-xs text-indigo-500 mt-1">ID: {graphData.current_paper.external_id}</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="h-[400px] border border-slate-200 rounded-lg overflow-hidden bg-slate-100">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.5}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#cbd5e1" gap={16} />
                <Controls showInteractive={false} />
            </ReactFlow>
        </div>
    );
}

