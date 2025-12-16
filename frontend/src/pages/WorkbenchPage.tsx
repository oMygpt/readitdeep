/**
 * Read it DEEP - 全局工作台页面
 * 
 * 汇总所有论文的工作台内容
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
    Sparkles,
    FlaskConical,
    Database,
    Lightbulb,
    Trash2,
    ChevronLeft,
    BookOpen,
    ExternalLink,
    BarChart3,
} from 'lucide-react';
import { api } from '../lib/api';

// Types
interface WorkbenchItem {
    id: string;
    type: string;
    title: string;
    description: string;
    source_paper_id: string | null;
    zone: string;
    created_at: string;
    data: Record<string, unknown>;
}

interface WorkbenchData {
    methods: WorkbenchItem[];
    datasets: WorkbenchItem[];
    notes: WorkbenchItem[];
}

interface WorkbenchStats {
    total_items: number;
    methods_count: number;
    datasets_count: number;
    notes_count: number;
    papers_count: number;
}

// API Functions
const workbenchApi = {
    getGlobal: async (): Promise<WorkbenchData> => {
        const { data } = await api.get('/workbench');
        return data;
    },
    getStats: async (): Promise<WorkbenchStats> => {
        const { data } = await api.get('/workbench/stats');
        return data;
    },
    deleteItem: async (itemId: string): Promise<void> => {
        await api.delete(`/workbench/items/${itemId}`);
    },
};

// Item Card Component
function ItemCard({
    item,
    onDelete
}: {
    item: WorkbenchItem;
    onDelete: () => void;
}) {
    const typeStyles = {
        method: { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: <FlaskConical className="w-4 h-4 text-indigo-600" /> },
        dataset: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: <Database className="w-4 h-4 text-emerald-600" /> },
        code: { bg: 'bg-amber-50', border: 'border-amber-200', icon: <FlaskConical className="w-4 h-4 text-amber-600" /> },
        note: { bg: 'bg-purple-50', border: 'border-purple-200', icon: <Lightbulb className="w-4 h-4 text-purple-600" /> },
    };

    const style = typeStyles[item.type as keyof typeof typeStyles] || typeStyles.note;

    return (
        <div className={`${style.bg} ${style.border} border rounded-xl p-4 hover:shadow-md transition-all`}>
            <div className="flex items-start gap-3">
                <div className="mt-0.5">{style.icon}</div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 mb-1">{item.title}</h3>
                    <p className="text-sm text-slate-600 line-clamp-2 mb-3">{item.description}</p>
                    <div className="flex items-center justify-between">
                        {item.source_paper_id && (
                            <Link
                                to={`/reader/${item.source_paper_id}`}
                                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                            >
                                <ExternalLink className="w-3 h-3" />
                                查看来源论文
                            </Link>
                        )}
                        <span className="text-xs text-slate-400">
                            {new Date(item.created_at).toLocaleDateString('zh-CN')}
                        </span>
                    </div>
                </div>
                <button
                    onClick={onDelete}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// Zone Section Component
function ZoneSection({
    title,
    icon,
    items,
    color,
    onDeleteItem,
}: {
    title: string;
    icon: React.ReactNode;
    items: WorkbenchItem[];
    color: string;
    onDeleteItem: (id: string) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="mb-8">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-3 mb-4 group"
            >
                <div className={`p-2 rounded-lg ${color}`}>
                    {icon}
                </div>
                <h2 className="text-xl font-bold text-slate-800">{title}</h2>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-sm rounded-full">
                    {items.length}
                </span>
            </button>

            {isExpanded && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.length === 0 ? (
                        <div className="col-span-full text-center py-8 text-slate-400 text-sm">
                            暂无内容
                        </div>
                    ) : (
                        items.map((item) => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                onDelete={() => onDeleteItem(item.id)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// Main Page Component
export default function GlobalWorkbenchPage() {
    const queryClient = useQueryClient();

    const { data: workbench, isLoading } = useQuery({
        queryKey: ['global-workbench'],
        queryFn: workbenchApi.getGlobal,
    });

    const { data: stats } = useQuery({
        queryKey: ['workbench-stats'],
        queryFn: workbenchApi.getStats,
    });

    const deleteMutation = useMutation({
        mutationFn: workbenchApi.deleteItem,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['global-workbench'] });
            queryClient.invalidateQueries({ queryKey: ['workbench-stats'] });
        },
    });

    const handleDelete = (itemId: string) => {
        if (confirm('确定删除此项目？')) {
            deleteMutation.mutate(itemId);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link
                            to="/"
                            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-600 rounded-xl text-white">
                                <Sparkles className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-slate-800">全局工作台</h1>
                                <p className="text-sm text-slate-500">汇总所有论文的研究素材</p>
                            </div>
                        </div>
                    </div>

                    <Link
                        to="/"
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <BookOpen className="w-4 h-4" />
                        <span>返回论文库</span>
                    </Link>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Stats */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <div className="bg-white rounded-xl p-4 border border-slate-200">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <BarChart3 className="w-4 h-4" />
                                <span className="text-sm">总项目</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-800">{stats.total_items}</div>
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-slate-200">
                            <div className="flex items-center gap-2 text-indigo-500 mb-1">
                                <FlaskConical className="w-4 h-4" />
                                <span className="text-sm">方法</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-800">{stats.methods_count}</div>
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-slate-200">
                            <div className="flex items-center gap-2 text-emerald-500 mb-1">
                                <Database className="w-4 h-4" />
                                <span className="text-sm">数据集</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-800">{stats.datasets_count}</div>
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-slate-200">
                            <div className="flex items-center gap-2 text-purple-500 mb-1">
                                <Lightbulb className="w-4 h-4" />
                                <span className="text-sm">笔记</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-800">{stats.notes_count}</div>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-slate-500">加载中...</div>
                    </div>
                )}

                {/* Content */}
                {workbench && (
                    <>
                        <ZoneSection
                            title="方法炼金台"
                            icon={<FlaskConical className="w-5 h-5 text-indigo-600" />}
                            items={workbench.methods}
                            color="bg-indigo-100"
                            onDeleteItem={handleDelete}
                        />

                        <ZoneSection
                            title="资产仓库"
                            icon={<Database className="w-5 h-5 text-emerald-600" />}
                            items={workbench.datasets}
                            color="bg-emerald-100"
                            onDeleteItem={handleDelete}
                        />

                        <ZoneSection
                            title="灵感画板"
                            icon={<Lightbulb className="w-5 h-5 text-purple-600" />}
                            items={workbench.notes}
                            color="bg-purple-100"
                            onDeleteItem={handleDelete}
                        />
                    </>
                )}

                {/* Empty State */}
                {workbench &&
                    workbench.methods.length === 0 &&
                    workbench.datasets.length === 0 &&
                    workbench.notes.length === 0 && (
                        <div className="text-center py-20">
                            <Sparkles className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-slate-600 mb-2">工作台为空</h3>
                            <p className="text-slate-500 mb-6">在阅读论文时，将方法、数据集或灵感添加到工作台</p>
                            <Link
                                to="/"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                                <BookOpen className="w-4 h-4" />
                                开始阅读论文
                            </Link>
                        </div>
                    )}
            </main>
        </div>
    );
}
