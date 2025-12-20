/**
 * Read it DEEP - Library Page (Redesigned with List View & Tags)
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Search,
    Loader2,
    Trash2,
    UploadCloud,
    BookOpen,
    CheckCircle,
    AlertCircle,
    Sparkles,
    Tag,
    Filter,
    List,
    Grid,
    ChevronRight,
    Edit2,
    RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { libraryApi, papersApi, monitorApi, analysisApi } from '../lib/api';
import UserMenu from '../components/UserMenu';
import CategoryTagEditor from '../components/CategoryTagEditor';

export default function LibraryPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [editingPaper, setEditingPaper] = useState<{ id: string; category?: string; tags: string[] } | null>(null);
    const [paperStatuses, setPaperStatuses] = useState<Record<string, { status: string; message: string }>>({});
    const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);
    const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);

    // Polling for updates (暂停轮询当编辑弹窗打开时)
    const { data: libraryData, isLoading } = useQuery({
        queryKey: ['library', search],
        queryFn: () => libraryApi.list({ search: search || undefined }),
        refetchInterval: (renamingCategory || editingPaper) ? false : 3000,
    });

    const papers = libraryData?.items || [];

    // 轮询处理中的论文状态
    useEffect(() => {
        const processingPapers = papers.filter(p =>
            ['uploading', 'parsing', 'indexing', 'embedding', 'analyzing', 'classifying'].includes(p.status)
        );

        if (processingPapers.length > 0) {
            processingPapers.forEach(async (paper) => {
                try {
                    const status = await monitorApi.getStatus(paper.id);
                    setPaperStatuses(prev => ({
                        ...prev,
                        [paper.id]: { status: status.status, message: status.message }
                    }));
                } catch (e) {
                    console.error('Failed to get status', e);
                }
            });
        }
    }, [papers]);

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: libraryApi.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['library'] });
        },
    });

    // Upload Mutation
    const uploadMutation = useMutation({
        mutationFn: papersApi.upload,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['library'] });
        },
    });

    // Reanalyze Mutation
    const reanalyzeMutation = useMutation({
        mutationFn: analysisApi.trigger,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['library'] });
            setReanalyzingId(null);
        },
        onError: () => {
            setReanalyzingId(null);
        },
    });

    // Derived Categories
    const categories = useMemo(() => {
        const cats: Record<string, number> = {};
        papers.forEach((p) => {
            const c = p.category || 'Uncategorized';
            cats[c] = (cats[c] || 0) + 1;
        });
        return cats;
    }, [papers]);

    // Derived Tags
    const allTags = useMemo(() => {
        const tags: Record<string, number> = {};
        papers.forEach((p) => {
            const paperTags = p.tags || [];
            paperTags.forEach((t: string) => {
                tags[t] = (tags[t] || 0) + 1;
            });
        });
        return tags;
    }, [papers]);

    // Filtered Papers
    const filteredPapers = useMemo(() => {
        return papers.filter((p) => {
            if (selectedCategory && (p.category || 'Uncategorized') !== selectedCategory) {
                return false;
            }
            if (selectedTag && !(p.tags || []).includes(selectedTag)) {
                return false;
            }
            return true;
        });
    }, [papers, selectedCategory, selectedTag]);

    // Handle Upload
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                await uploadMutation.mutateAsync(file);
            } catch (err) {
                console.error("Upload failed", err);
                alert("Upload failed");
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        setDeleteConfirmId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteConfirmId) {
            await deleteMutation.mutateAsync(deleteConfirmId);
            setDeleteConfirmId(null);
        }
    };

    const clearFilters = () => {
        setSelectedCategory(null);
        setSelectedTag(null);
    };

    const handleReanalyze = async (e: React.MouseEvent, paperId: string) => {
        e.stopPropagation();
        e.preventDefault();
        setReanalyzingId(paperId);
        try {
            await reanalyzeMutation.mutateAsync(paperId);
        } catch (err) {
            console.error('Reanalyze failed', err);
        }
    };

    return (
        <div className="flex h-screen bg-slate-50 text-slate-800 font-sans">
            {/* Left Sidebar */}
            <aside className="w-72 bg-slate-50 border-r border-slate-200 hidden lg:flex flex-col pt-8 overflow-y-auto">
                {/* Logo */}
                <div className="px-6 mb-8 flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-600 rounded-lg text-white shadow-sm shadow-indigo-200">
                        <BookOpen className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-lg tracking-tight text-slate-800">{t('common.appName')}</span>
                </div>

                {/* Search */}
                <div className="px-6 mb-6">
                    <div className="relative">
                        <input
                            type="text"
                            className="w-full bg-white border border-slate-300 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                            placeholder={t('library.searchPlaceholder')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    </div>
                </div>

                {/* Category Filter */}
                <div className="px-6 mb-6">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Filter className="w-3 h-3" />
                        {t('library.categories')}
                    </h2>
                    <div className="space-y-1">
                        <div
                            onClick={clearFilters}
                            className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors ${!selectedCategory ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-200 text-slate-600'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <BookOpen className="w-4 h-4" />
                                <span>{t('library.allPapers')}</span>
                            </div>
                            <span className="bg-slate-200 text-slate-500 text-xs px-2 py-0.5 rounded-full">
                                {papers.length}
                            </span>
                        </div>
                        {Object.entries(categories).map(([cat, count]) => (
                            <div
                                key={cat}
                                className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors group ${selectedCategory === cat ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-200 text-slate-600'
                                    }`}
                            >
                                <span
                                    className="truncate max-w-[120px] flex-1"
                                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                                >
                                    {cat}
                                </span>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setRenamingCategory(cat);
                                            setNewCategoryName(cat);
                                        }}
                                        className="p-1 text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('library.renameCategory')}
                                    >
                                        <Edit2 className="w-3 h-3" />
                                    </button>
                                    <span className="bg-slate-200 text-slate-500 text-xs px-2 py-0.5 rounded-full">
                                        {count}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tag Filter */}
                <div className="px-6 mb-6">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Tag className="w-3 h-3" />
                        {t('library.tags')}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(allTags).map(([tag, count]) => (
                            <button
                                key={tag}
                                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                className={`px-2 py-1 text-xs rounded-full transition-colors ${selectedTag === tag
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                    }`}
                            >
                                {tag} ({count})
                            </button>
                        ))}
                        {Object.keys(allTags).length === 0 && (
                            <p className="text-xs text-slate-400">{t('library.noTags')}</p>
                        )}
                    </div>
                </div>

                {/* Workbench Link */}
                <div className="px-6 mb-6">
                    <Link
                        to="/workbench"
                        className="flex items-center gap-3 px-3 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-100 hover:shadow-md transition-all group"
                    >
                        <div className="p-2 bg-purple-600 rounded-lg text-white group-hover:scale-105 transition-transform">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="font-semibold text-purple-900 text-sm">{t('library.smartWorkbench')}</div>
                            <div className="text-xs text-purple-600">{t('library.workbenchDesc')}</div>
                        </div>
                    </Link>
                </div>

                {/* Suggestions */}
                <div className="px-6 mt-auto mb-6">
                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                        <h3 className="text-indigo-900 font-semibold text-sm mb-1">{t('library.deepReadAI')}</h3>
                        <p className="text-xs text-indigo-700 leading-relaxed mb-3">
                            {t('library.deepReadAIDesc')}
                        </p>
                    </div>
                </div>

                {/* Copyright Footer */}
                <div className="px-6 mb-8 text-center">
                    <p className="text-[10px] text-slate-400 font-medium">
                        {t('common.byTeam')}
                    </p>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h1 className="text-3xl font-serif font-bold text-slate-800 tracking-tight">{t('library.title')}</h1>
                            <p className="text-slate-500 mt-1 text-sm">
                                {filteredPapers.length} {t('library.papers')}
                                {selectedCategory && <span className="text-indigo-600"> {t('library.inCategory', { category: selectedCategory })}</span>}
                                {selectedTag && <span className="text-purple-600"> {t('library.taggedWith', { tag: selectedTag })}</span>}
                            </p>
                        </div>
                        <div className="flex gap-3 items-center">
                            {/* View Mode Toggle */}
                            <div className="flex bg-slate-100 rounded-lg p-1">
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <List className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <Grid className="w-4 h-4" />
                                </button>
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-sm text-sm font-medium flex items-center gap-2 transition-all hover:shadow-md active:scale-95"
                            >
                                <UploadCloud className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('library.importPaper')}</span>
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept=".pdf,.docx,.tex"
                                onChange={handleFileChange}
                            />
                            <UserMenu />
                        </div>
                    </div>

                    {/* Active Filters */}
                    {(selectedCategory || selectedTag) && (
                        <div className="flex gap-2 mb-4 items-center">
                            <span className="text-xs text-slate-400">{t('library.filters')}:</span>
                            {selectedCategory && (
                                <span
                                    onClick={() => setSelectedCategory(null)}
                                    className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-full cursor-pointer hover:bg-indigo-200 flex items-center gap-1"
                                >
                                    {selectedCategory} ×
                                </span>
                            )}
                            {selectedTag && (
                                <span
                                    onClick={() => setSelectedTag(null)}
                                    className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full cursor-pointer hover:bg-purple-200 flex items-center gap-1"
                                >
                                    {selectedTag} ×
                                </span>
                            )}
                            <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-600 ml-2">
                                {t('library.clearAll')}
                            </button>
                        </div>
                    )}

                    {/* Loading State */}
                    {isLoading && papers.length === 0 && (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                        </div>
                    )}

                    {/* Upload Card */}
                    {uploadMutation.isPending && (
                        <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                            <span className="text-sm text-indigo-700">{t('library.uploadingPaper')}</span>
                        </div>
                    )}

                    {/* List View */}
                    {viewMode === 'list' && (
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <div className="col-span-5">{t('library.tableHeaders.title')}</div>
                                <div className="col-span-2">{t('library.tableHeaders.category')}</div>
                                <div className="col-span-3">{t('library.tableHeaders.tags')}</div>
                                <div className="col-span-1">{t('library.tableHeaders.status')}</div>
                                <div className="col-span-1">{t('library.tableHeaders.actions')}</div>
                            </div>

                            {/* Paper Rows */}
                            {filteredPapers.map((paper) => {
                                const isProcessing = ['uploading', 'parsing', 'indexing', 'embedding', 'analyzing', 'classifying'].includes(paper.status);
                                const isFailed = paper.status === 'failed';
                                const isCompleted = paper.status === 'completed' || paper.status === 'analyzed';
                                const statusInfo = paperStatuses[paper.id];

                                return (
                                    <div
                                        key={paper.id}
                                        onClick={() => isCompleted && navigate(`/read/${paper.id}`)}
                                        className={`grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-100 items-center transition-colors ${isProcessing ? 'bg-slate-50 cursor-wait' : 'hover:bg-slate-50 cursor-pointer'
                                            }`}
                                    >
                                        {/* Title */}
                                        <div className="col-span-5 flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isProcessing ? 'bg-yellow-400 animate-pulse' : isFailed ? 'bg-red-400' : 'bg-green-400'
                                                }`} />
                                            <div className="min-w-0">
                                                <div className="font-medium text-slate-800 truncate group-hover:text-indigo-600">
                                                    {paper.title || paper.filename}
                                                </div>
                                                <div className="text-xs text-slate-400 truncate">
                                                    {paper.filename} • {new Date(paper.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Category - 点击可编辑 */}
                                        <div
                                            className="col-span-2 cursor-pointer hover:opacity-80"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (isCompleted) setEditingPaper({ id: paper.id, category: paper.category, tags: paper.tags || [] });
                                            }}
                                        >
                                            <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full">
                                                {paper.category || t('library.uncategorized')}
                                            </span>
                                        </div>

                                        {/* Tags */}
                                        <div className="col-span-3 flex flex-wrap gap-1">
                                            {(paper.tags || []).slice(0, 3).map((tag: string) => (
                                                <span key={tag} className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                                                    {tag}
                                                </span>
                                            ))}
                                            {(paper.tags || []).length > 3 && (
                                                <span className="text-xs text-slate-400">+{(paper.tags || []).length - 3}</span>
                                            )}
                                            {(!paper.tags || paper.tags.length === 0) && (
                                                <span className="text-xs text-slate-300">{t('library.noTags')}</span>
                                            )}
                                        </div>

                                        {/* Status */}
                                        <div className="col-span-1">
                                            {isProcessing && (
                                                <div className="flex flex-col">
                                                    <span className="flex items-center gap-1 text-xs text-yellow-600">
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    </span>
                                                    <span className="text-[10px] text-yellow-600 truncate max-w-[100px]" title={statusInfo?.message}>
                                                        {statusInfo?.message || t('library.processing')}
                                                    </span>
                                                </div>
                                            )}
                                            {isFailed && (
                                                <span className="flex items-center gap-1 text-xs text-red-600">
                                                    <AlertCircle className="w-3 h-3" />
                                                </span>
                                            )}
                                            {isCompleted && (
                                                <span className="flex items-center gap-1 text-xs text-green-600">
                                                    <CheckCircle className="w-3 h-3" />
                                                </span>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="col-span-1 flex items-center justify-end gap-2">
                                            {isFailed && (
                                                <button
                                                    onClick={(e) => handleReanalyze(e, paper.id)}
                                                    disabled={reanalyzingId === paper.id}
                                                    className="p-1 text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                                                    title={t('library.reanalyze')}
                                                >
                                                    <RefreshCw className={`w-4 h-4 ${reanalyzingId === paper.id ? 'animate-spin' : ''}`} />
                                                </button>
                                            )}
                                            {isCompleted && (
                                                <ChevronRight className="w-4 h-4 text-slate-400" />
                                            )}
                                            <button
                                                onClick={(e) => handleDeleteClick(e, paper.id)}
                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Empty State */}
                            {filteredPapers.length === 0 && !isLoading && (
                                <div className="py-12 text-center text-slate-400">
                                    <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
                                    <p className="text-sm">{t('library.noPapersFound')}</p>
                                    <p className="text-xs mt-1">{t('library.adjustFilters')}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Grid View */}
                    {viewMode === 'grid' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filteredPapers.map((paper) => {
                                const isProcessing = ['uploading', 'parsing', 'indexing'].includes(paper.status);
                                const isFailed = paper.status === 'failed';
                                const isCompleted = paper.status === 'completed';

                                return (
                                    <div
                                        key={paper.id}
                                        onClick={() => isCompleted && navigate(`/read/${paper.id}`)}
                                        className={`bg-white rounded-xl p-4 shadow-sm border border-slate-200 transition-all ${isProcessing ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:shadow-lg hover:border-indigo-200'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className={`w-2 h-2 rounded-full mt-2 ${isProcessing ? 'bg-yellow-400 animate-pulse' : isFailed ? 'bg-red-400' : 'bg-green-400'
                                                }`} />
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-medium text-slate-800 line-clamp-2 mb-1">
                                                    {paper.title || paper.filename}
                                                </h3>
                                                <p className="text-xs text-slate-400">{new Date(paper.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-1 mb-3">
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                                                {paper.category || t('library.uncategorized')}
                                            </span>
                                            {(paper.tags || []).slice(0, 2).map((tag: string) => (
                                                <span key={tag} className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                            <div className="flex items-center gap-2">
                                                {isCompleted && <CheckCircle className="w-4 h-4 text-green-500" />}
                                                {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />}
                                                {isFailed && (
                                                    <>
                                                        <AlertCircle className="w-4 h-4 text-red-500" />
                                                        <button
                                                            onClick={(e) => handleReanalyze(e, paper.id)}
                                                            disabled={reanalyzingId === paper.id}
                                                            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-50"
                                                            title={t('library.reanalyze')}
                                                        >
                                                            <RefreshCw className={`w-3 h-3 ${reanalyzingId === paper.id ? 'animate-spin' : ''}`} />
                                                            {t('library.retry')}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteClick(e, paper.id)}
                                                className="p-1 text-slate-400 hover:text-red-600 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-slate-800 mb-2">{t('library.deleteConfirm')}</h3>
                        <p className="text-slate-600 mb-6">{t('library.deleteConfirmMessage')}</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={handleDeleteConfirm}
                                disabled={deleteMutation.isPending}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                                {deleteMutation.isPending ? t('library.deleting') : t('library.confirmDelete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Category/Tags Editor Modal */}
            {editingPaper && (
                <CategoryTagEditor
                    paperId={editingPaper.id}
                    currentCategory={editingPaper.category}
                    currentTags={editingPaper.tags}
                    onClose={() => setEditingPaper(null)}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ['library'] })}
                />
            )}

            {/* Category Rename Modal */}
            {renamingCategory && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenamingCategory(null)}>
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-slate-800 mb-4">{t('library.renameCategory')}</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            {t('library.renameCategoryDesc', { category: renamingCategory })}
                        </p>
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder={t('library.newCategoryPlaceholder')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-4"
                            autoFocus
                        />
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setRenamingCategory(null)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={async () => {
                                    if (!newCategoryName.trim() || isRenaming) return;
                                    setIsRenaming(true);
                                    try {
                                        const result = await libraryApi.renameCategory(renamingCategory!, newCategoryName.trim());
                                        console.log('Rename result:', result);
                                        await queryClient.invalidateQueries({ queryKey: ['library'] });
                                        setRenamingCategory(null);
                                        setNewCategoryName('');
                                    } catch (e) {
                                        console.error('Rename failed', e);
                                        alert(t('library.renameFailed') + ': ' + (e as Error).message);
                                    } finally {
                                        setIsRenaming(false);
                                    }
                                }}
                                disabled={!newCategoryName.trim() || newCategoryName === renamingCategory || isRenaming}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isRenaming && <Loader2 className="w-4 h-4 animate-spin" />}
                                {isRenaming ? t('library.renaming') : t('common.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
