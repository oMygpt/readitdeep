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
    Users,
    Share2,
    CheckSquare,
    Square,
    Download,
    ChevronDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { libraryApi, papersApi, monitorApi, analysisApi, citationApi, type CitationFormat } from '../lib/api';
import UserMenu from '../components/UserMenu';
import CategoryTagEditor from '../components/CategoryTagEditor';
import QuotaBadge from '../components/QuotaBadge';
import UpgradeModal from '../components/UpgradeModal';
import ShareToTeamModal from '../components/ShareToTeamModal';

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
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [sharingPaper, setSharingPaper] = useState<{ id: string; title: string } | null>(null);
    // Bulk selection state
    const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set());
    const [bulkShareMode, setBulkShareMode] = useState(false);
    // Citation export state
    const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

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
                // Refresh quota after upload
                queryClient.invalidateQueries({ queryKey: ['quota-status'] });
            } catch (err: any) {
                console.error("Upload failed", err);
                // Check if it's a quota error
                if (err.response?.status === 403 && err.response?.data?.detail?.error === 'quota_exceeded') {
                    setShowUpgradeModal(true);
                } else {
                    alert("Upload failed");
                }
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

    // Handle citation export
    const handleExportCitations = async (format: CitationFormat) => {
        if (selectedPaperIds.size === 0) return;

        setIsExporting(true);
        setExportDropdownOpen(false);

        try {
            await citationApi.exportCitations(Array.from(selectedPaperIds), format);
        } catch (err) {
            console.error('Export failed:', err);
            alert('导出失败，请重试');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex h-screen bg-background text-content-main font-sans">
            {/* Left Sidebar */}
            <aside className="w-72 bg-surface border-r border-border hidden lg:flex flex-col pt-8 overflow-y-auto">
                {/* Logo */}
                <div className="px-6 mb-8 flex items-center gap-2">
                    <div className="p-1.5 bg-primary rounded-lg text-primary-content shadow-sm shadow-primary/30">
                        <BookOpen className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-lg tracking-tight text-content-main">{t('common.appName')}</span>
                </div>

                {/* Search */}
                <div className="px-6 mb-6">
                    <div className="relative">
                        <input
                            type="text"
                            className="w-full bg-surface-elevated border border-border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-sm text-content-main placeholder:text-content-dim"
                            placeholder={t('library.searchPlaceholder')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Search className="w-4 h-4 text-content-muted absolute left-3 top-2.5" />
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
                            className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors ${!selectedCategory ? 'bg-primary/20 text-primary' : 'hover:bg-surface-active text-content-muted'
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
                <div className="px-6 mb-4">
                    <Link
                        to="/workbench"
                        className="flex items-center gap-3 px-3 py-3 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-xl border border-primary/20 hover:shadow-md transition-all group"
                    >
                        <div className="p-2 bg-primary rounded-lg text-primary-content group-hover:scale-105 transition-transform">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="font-semibold text-purple-900 text-sm">{t('library.smartWorkbench')}</div>
                            <div className="text-xs text-purple-600">{t('library.workbenchDesc')}</div>
                        </div>
                    </Link>
                </div>

                {/* Teams Link */}
                <div className="px-6 mb-6">
                    <Link
                        to="/teams"
                        className="flex items-center gap-3 px-3 py-3 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-xl border border-blue-500/20 hover:shadow-md transition-all group"
                    >
                        <div className="p-2 bg-blue-500 rounded-lg text-white group-hover:scale-105 transition-transform">
                            <Users className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="font-semibold text-blue-900 text-sm">{t('library.teams') || '团队协作'}</div>
                            <div className="text-xs text-blue-600">{t('library.teamsDesc') || '共享与协作研究'}</div>
                        </div>
                    </Link>
                </div>

                {/* Quota Status in Sidebar */}
                <div className="px-6 mb-6">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        {t('library.quota') || '配额状态'}
                    </h2>
                    <QuotaBadge onUpgradeClick={() => setShowUpgradeModal(true)} showDetails={true} />
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
                            <h1 className="text-3xl font-serif font-bold text-content-main tracking-tight">{t('library.title')}</h1>
                            <p className="text-content-muted mt-1 text-sm">
                                {filteredPapers.length} {t('library.papers')}
                                {selectedCategory && <span className="text-primary"> {t('library.inCategory', { category: selectedCategory })}</span>}
                                {selectedTag && <span className="text-secondary"> {t('library.taggedWith', { tag: selectedTag })}</span>}
                            </p>
                        </div>
                        <div className="flex gap-3 items-center">
                            {/* Quota Badge */}
                            <QuotaBadge onUpgradeClick={() => setShowUpgradeModal(true)} />

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
                                className="bg-primary hover:bg-primary-hover text-primary-content px-4 py-2 rounded-lg shadow-sm text-sm font-medium flex items-center gap-2 transition-all hover:shadow-md active:scale-95"
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

                    {/* Bulk Action Bar - visible when papers are selected */}
                    {selectedPaperIds.size > 0 && (
                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <CheckSquare className="w-5 h-5 text-blue-600" />
                                <span className="text-sm font-medium text-blue-900">
                                    已选择 {selectedPaperIds.size} 篇论文
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setBulkShareMode(true)}
                                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2"
                                >
                                    <Share2 className="w-4 h-4" />
                                    分享到团队
                                </button>
                                {/* Citation Export Dropdown */}
                                <div className="relative">
                                    <button
                                        onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                                        disabled={isExporting}
                                        className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isExporting ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4" />
                                        )}
                                        导出引用
                                        <ChevronDown className="w-3 h-3" />
                                    </button>
                                    {exportDropdownOpen && (
                                        <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                            <button
                                                onClick={() => handleExportCitations('bibtex')}
                                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-t-lg"
                                            >
                                                BibTeX (.bib)
                                            </button>
                                            <button
                                                onClick={() => handleExportCitations('ris')}
                                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                            >
                                                RIS (.ris)
                                            </button>
                                            <button
                                                onClick={() => handleExportCitations('plain')}
                                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 rounded-b-lg"
                                            >
                                                纯文本 (.txt)
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => setSelectedPaperIds(new Set())}
                                    className="px-3 py-1.5 text-blue-600 text-sm hover:bg-blue-100 rounded-lg"
                                >
                                    取消选择
                                </button>
                            </div>
                        </div>
                    )}

                    {/* List View */}
                    {viewMode === 'list' && (
                        <div className="bg-surface rounded-xl border border-border overflow-hidden">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-surface-elevated border-b border-border text-xs font-semibold text-content-dim uppercase tracking-wider">
                                <div className="col-span-1 flex items-center">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const completedIds = filteredPapers
                                                .filter(p => p.status === 'completed' || p.status === 'analyzed')
                                                .map(p => p.id);
                                            if (selectedPaperIds.size === completedIds.length && completedIds.length > 0) {
                                                setSelectedPaperIds(new Set());
                                            } else {
                                                setSelectedPaperIds(new Set(completedIds));
                                            }
                                        }}
                                        className="p-1 hover:bg-slate-200 rounded transition-colors"
                                        title="全选/取消"
                                    >
                                        {selectedPaperIds.size > 0 ? (
                                            <CheckSquare className="w-4 h-4 text-blue-600" />
                                        ) : (
                                            <Square className="w-4 h-4 text-slate-400" />
                                        )}
                                    </button>
                                </div>
                                <div className="col-span-4">{t('library.tableHeaders.title')}</div>
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
                                        className={`grid grid-cols-12 gap-4 px-4 py-3 border-b border-border items-center transition-colors ${isProcessing ? 'bg-surface-hover/50 cursor-wait' : 'hover:bg-surface-hover cursor-pointer'
                                            } ${selectedPaperIds.has(paper.id) ? 'bg-blue-50' : ''}`}
                                    >
                                        {/* Checkbox */}
                                        <div className="col-span-1 flex items-center">
                                            {isCompleted && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const newSet = new Set(selectedPaperIds);
                                                        if (newSet.has(paper.id)) {
                                                            newSet.delete(paper.id);
                                                        } else {
                                                            newSet.add(paper.id);
                                                        }
                                                        setSelectedPaperIds(newSet);
                                                    }}
                                                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                                                >
                                                    {selectedPaperIds.has(paper.id) ? (
                                                        <CheckSquare className="w-4 h-4 text-blue-600" />
                                                    ) : (
                                                        <Square className="w-4 h-4 text-slate-400" />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        {/* Title */}
                                        <div className="col-span-4 flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isProcessing ? 'bg-warning animate-pulse' : isFailed ? 'bg-error' : 'bg-success'
                                                }`} />
                                            <div className="min-w-0 flex-1">
                                                <div className="font-medium text-content-main truncate group-hover:text-primary flex items-center gap-2">
                                                    <span className="truncate">{paper.title || paper.filename}</span>
                                                    {/* Team sharing badges */}
                                                    {paper.shared_teams && paper.shared_teams.length > 0 && (
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            {paper.shared_teams.slice(0, 2).map((team) => (
                                                                <span
                                                                    key={team.id}
                                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full"
                                                                    title={`已分享给 ${team.name}`}
                                                                >
                                                                    <Users className="w-2.5 h-2.5" />
                                                                    {team.name}
                                                                </span>
                                                            ))}
                                                            {paper.shared_teams.length > 2 && (
                                                                <span className="text-[10px] text-blue-600">
                                                                    +{paper.shared_teams.length - 2}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
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
                                            {isCompleted && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSharingPaper({ id: paper.id, title: paper.title || paper.filename });
                                                    }}
                                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title={t('library.shareToTeam') || '分享到团队'}
                                                >
                                                    <Share2 className="w-4 h-4" />
                                                </button>
                                            )}
                                            {(isFailed || isCompleted) && (
                                                <button
                                                    onClick={(e) => handleReanalyze(e, paper.id)}
                                                    disabled={reanalyzingId === paper.id}
                                                    className={`p-1 ${isFailed ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'} rounded transition-colors disabled:opacity-50`}
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
                                        className={`bg-surface rounded-xl p-4 shadow-sm border border-border transition-all ${isProcessing ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:shadow-lg hover:border-primary/50'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className={`w-2 h-2 rounded-full mt-2 ${isProcessing ? 'bg-warning animate-pulse' : isFailed ? 'bg-error' : 'bg-success'
                                                }`} />
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-medium text-content-main line-clamp-2 mb-1">
                                                    {paper.title || paper.filename}
                                                </h3>
                                                <p className="text-xs text-content-muted">{new Date(paper.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-1 mb-3">
                                            <span className="px-2 py-0.5 bg-surface-elevated text-content-dim text-xs rounded-full">
                                                {paper.category || t('library.uncategorized')}
                                            </span>
                                            {(paper.tags || []).slice(0, 2).map((tag: string) => (
                                                <span key={tag} className="px-2 py-0.5 bg-secondary/10 text-secondary text-xs rounded-full">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                            <div className="flex items-center gap-2">
                                                {isCompleted && (
                                                    <>
                                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                                        <button
                                                            onClick={(e) => handleReanalyze(e, paper.id)}
                                                            disabled={reanalyzingId === paper.id}
                                                            className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1 disabled:opacity-50"
                                                            title={t('library.reanalyze')}
                                                        >
                                                            <RefreshCw className={`w-3 h-3 ${reanalyzingId === paper.id ? 'animate-spin' : ''}`} />
                                                        </button>
                                                    </>
                                                )}
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

            {/* Upgrade Modal */}
            <UpgradeModal
                isOpen={showUpgradeModal}
                onClose={() => setShowUpgradeModal(false)}
            />

            {/* Share to Team Modal */}
            {sharingPaper && (
                <ShareToTeamModal
                    paperId={sharingPaper.id}
                    paperTitle={sharingPaper.title}
                    onClose={() => setSharingPaper(null)}
                    onSuccess={() => setSharingPaper(null)}
                />
            )}

            {/* Bulk Share Modal */}
            {bulkShareMode && selectedPaperIds.size > 0 && (
                <ShareToTeamModal
                    paperIds={Array.from(selectedPaperIds)}
                    onClose={() => setBulkShareMode(false)}
                    onSuccess={() => {
                        setBulkShareMode(false);
                        setSelectedPaperIds(new Set());
                    }}
                />
            )}
        </div>
    );
}
