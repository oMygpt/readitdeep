/**
 * Read it DEEP - 全局工作台页面 v2
 * 
 * 优化版本：
 * - Tab 切换：灵感笔记(N) / 方法(N) / 资产(N)
 * - 搜索功能：全文搜索
 * - 分类筛选：按类型、按论文
 * - 条目展开详情
 */

import { useState, useMemo } from 'react';
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
    Search,
    X,
    FileText,
    Code,
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

type TabType = 'notes' | 'methods' | 'assets';

// API Functions
const workbenchApi = {
    getGlobal: async (): Promise<WorkbenchData> => {
        const { data } = await api.get('/workbench');
        return data;
    },
    deleteItem: async (itemId: string): Promise<void> => {
        await api.delete(`/workbench/items/${itemId}`);
    },
};

// Expanded Item Card Component
function ExpandedItemCard({
    item,
    onDelete,
    onClose,
}: {
    item: WorkbenchItem;
    onDelete: () => void;
    onClose: () => void;
}) {
    const analysis = item.data?.analysis as Record<string, unknown> | undefined;
    const asset = item.data?.asset as Record<string, unknown> | undefined;
    const originalText = (item.data?.original_text as string) || '';
    const reflection = (item.data?.reflection as string) || '';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {item.type === 'method' && <FlaskConical className="w-5 h-5 text-indigo-600" />}
                        {item.type === 'dataset' && <Database className="w-5 h-5 text-emerald-600" />}
                        {item.type === 'code' && <Code className="w-5 h-5 text-amber-600" />}
                        {item.type === 'note' && <Lightbulb className="w-5 h-5 text-purple-600" />}
                        <h2 className="text-lg font-bold text-slate-800">{item.title}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Description */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-500 mb-2">描述</h3>
                        <p className="text-slate-700">{item.description}</p>
                    </div>

                    {/* Original Text */}
                    {originalText && (
                        <div>
                            <h3 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-1">
                                <FileText className="w-4 h-4" /> 原文片段
                            </h3>
                            <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 max-h-40 overflow-y-auto border border-slate-200">
                                {originalText.length > 500 ? originalText.substring(0, 500) + '...' : originalText}
                            </div>
                        </div>
                    )}

                    {/* Reflection (for notes) */}
                    {reflection && (
                        <div>
                            <h3 className="text-sm font-medium text-slate-500 mb-2">💭 心得笔记</h3>
                            <div className="bg-purple-50 rounded-lg p-4 text-sm text-purple-700 border border-purple-200">
                                {reflection}
                            </div>
                        </div>
                    )}

                    {/* Method Analysis */}
                    {analysis && (
                        <div className="space-y-3">
                            {typeof analysis.pseudocode === 'string' && (
                                <div>
                                    <h3 className="text-sm font-medium text-slate-500 mb-2">伪代码</h3>
                                    <pre className="bg-slate-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto">
                                        {analysis.pseudocode}
                                    </pre>
                                </div>
                            )}
                            {Boolean(analysis.reviewer_comments) && (
                                <div>
                                    <h3 className="text-sm font-medium text-slate-500 mb-2">审稿视角</h3>
                                    <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
                                        {(() => {
                                            const comments = analysis.reviewer_comments as { strengths?: string[]; weaknesses?: string[] };
                                            return (
                                                <>
                                                    {comments.strengths?.map((s, i) => (
                                                        <div key={`s-${i}`} className="text-sm text-green-600">✓ {s}</div>
                                                    ))}
                                                    {comments.weaknesses?.map((w, i) => (
                                                        <div key={`w-${i}`} className="text-sm text-amber-600">⚠ {w}</div>
                                                    ))}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Asset Info */}
                    {asset && (
                        <div className="space-y-3">
                            {typeof asset.url === 'string' && (
                                <div>
                                    <h3 className="text-sm font-medium text-slate-500 mb-2">链接</h3>
                                    <a
                                        href={String(asset.url)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        {String(asset.url)}
                                    </a>
                                </div>
                            )}
                            {typeof asset.usage_in_paper === 'string' && (
                                <div>
                                    <h3 className="text-sm font-medium text-slate-500 mb-2">论文中的用途</h3>
                                    <p className="text-slate-600">{String(asset.usage_in_paper)}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Source Paper */}
                    {item.source_paper_id && (
                        <div className="pt-4 border-t border-slate-200">
                            <Link
                                to={`/read/${item.source_paper_id}`}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                                <BookOpen className="w-4 h-4" />
                                查看来源论文
                            </Link>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
                    <span className="text-sm text-slate-400">
                        创建于 {new Date(item.created_at).toLocaleString('zh-CN')}
                    </span>
                    <button
                        onClick={() => {
                            if (confirm('确定删除此项目？')) {
                                onDelete();
                                onClose();
                            }
                        }}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <Trash2 className="w-4 h-4" />
                        删除
                    </button>
                </div>
            </div>
        </div>
    );
}

// Compact Item Card
function ItemCard({
    item,
    onClick,
}: {
    item: WorkbenchItem;
    onClick: () => void;
}) {
    const typeStyles = {
        method: { bg: 'bg-indigo-50 hover:bg-indigo-100', border: 'border-indigo-200', icon: <FlaskConical className="w-4 h-4 text-indigo-600" /> },
        dataset: { bg: 'bg-emerald-50 hover:bg-emerald-100', border: 'border-emerald-200', icon: <Database className="w-4 h-4 text-emerald-600" /> },
        code: { bg: 'bg-amber-50 hover:bg-amber-100', border: 'border-amber-200', icon: <Code className="w-4 h-4 text-amber-600" /> },
        note: { bg: 'bg-purple-50 hover:bg-purple-100', border: 'border-purple-200', icon: <Lightbulb className="w-4 h-4 text-purple-600" /> },
    };

    const style = typeStyles[item.type as keyof typeof typeStyles] || typeStyles.note;

    return (
        <div
            onClick={onClick}
            className={`${style.bg} ${style.border} border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md`}
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5">{style.icon}</div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 mb-1 line-clamp-1">{item.title}</h3>
                    <p className="text-sm text-slate-600 line-clamp-2">{item.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-slate-400">
                            {new Date(item.created_at).toLocaleDateString('zh-CN')}
                        </span>
                        {item.source_paper_id && (
                            <span className="text-xs text-indigo-500">📄 有来源论文</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Main Page Component
export default function GlobalWorkbenchPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TabType>('notes');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [selectedItem, setSelectedItem] = useState<WorkbenchItem | null>(null);

    const { data: workbench, isLoading } = useQuery({
        queryKey: ['global-workbench'],
        queryFn: workbenchApi.getGlobal,
    });

    const deleteMutation = useMutation({
        mutationFn: workbenchApi.deleteItem,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['global-workbench'] });
        },
    });

    // Get items for current tab
    const currentItems = useMemo(() => {
        if (!workbench) return [];

        let items: WorkbenchItem[] = [];
        if (activeTab === 'notes') items = workbench.notes || [];
        else if (activeTab === 'methods') items = workbench.methods || [];
        else items = workbench.datasets || [];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            items = items.filter(item =>
                item.title.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query)
            );
        }

        // Apply type filter
        if (filterType !== 'all') {
            if (activeTab === 'methods') {
                items = items.filter(item => {
                    const analysis = item.data?.analysis as Record<string, string> | undefined;
                    return analysis?.method_type === filterType;
                });
            } else if (activeTab === 'assets') {
                items = items.filter(item => {
                    const asset = item.data?.asset as Record<string, string> | undefined;
                    return item.type === filterType || asset?.type === filterType;
                });
            }
        }

        return items;
    }, [workbench, activeTab, searchQuery, filterType]);

    // Get filter options for current tab
    const filterOptions = useMemo(() => {
        if (activeTab === 'methods') {
            return [
                { value: 'all', label: '全部类型' },
                { value: '算法', label: '算法' },
                { value: '框架', label: '框架' },
                { value: '流程', label: '流程' },
                { value: '评估方法', label: '评估方法' },
            ];
        } else if (activeTab === 'assets') {
            return [
                { value: 'all', label: '全部类型' },
                { value: 'dataset', label: '数据集' },
                { value: 'code', label: '代码' },
                { value: 'model', label: '模型' },
                { value: 'api', label: 'API' },
            ];
        }
        return [];
    }, [activeTab]);

    const counts = {
        notes: workbench?.notes?.length || 0,
        methods: workbench?.methods?.length || 0,
        assets: workbench?.datasets?.length || 0,
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
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

            <main className="max-w-7xl mx-auto px-6 py-6">
                {/* Search Bar */}
                <div className="mb-6">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索笔记、方法、资产..."
                            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="bg-white rounded-xl border border-slate-200 mb-6">
                    <div className="flex border-b border-slate-200">
                        <button
                            onClick={() => { setActiveTab('notes'); setFilterType('all'); }}
                            className={`flex-1 px-6 py-4 flex items-center justify-center gap-2 font-medium transition-colors ${activeTab === 'notes'
                                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <Lightbulb className="w-5 h-5" />
                            灵感笔记({counts.notes})
                        </button>
                        <button
                            onClick={() => { setActiveTab('methods'); setFilterType('all'); }}
                            className={`flex-1 px-6 py-4 flex items-center justify-center gap-2 font-medium transition-colors ${activeTab === 'methods'
                                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <FlaskConical className="w-5 h-5" />
                            方法({counts.methods})
                        </button>
                        <button
                            onClick={() => { setActiveTab('assets'); setFilterType('all'); }}
                            className={`flex-1 px-6 py-4 flex items-center justify-center gap-2 font-medium transition-colors ${activeTab === 'assets'
                                ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <Database className="w-5 h-5" />
                            资产({counts.assets})
                        </button>
                    </div>

                    {/* Filter */}
                    {filterOptions.length > 0 && (
                        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                            <span className="text-sm text-slate-500">筛选:</span>
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                {filterOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Items Grid */}
                    <div className="p-6">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="text-slate-500">加载中...</div>
                            </div>
                        ) : currentItems.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="text-slate-400 mb-2">
                                    {searchQuery ? '未找到匹配项目' : '暂无内容'}
                                </div>
                                {!searchQuery && (
                                    <p className="text-sm text-slate-400">
                                        在阅读论文时，将内容添加到工作台
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {currentItems.map((item) => (
                                    <ItemCard
                                        key={item.id}
                                        item={item}
                                        onClick={() => setSelectedItem(item)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Item Detail Modal */}
            {selectedItem && (
                <ExpandedItemCard
                    item={selectedItem}
                    onDelete={() => deleteMutation.mutate(selectedItem.id)}
                    onClose={() => setSelectedItem(null)}
                />
            )}
        </div>
    );
}
