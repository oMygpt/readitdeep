/**
 * Read it DEEP - Enhanced Smart Workbench Component
 * 
 * Smart Workbench v2:
 * - Text drag-drop + LLM smart analysis
 * - Method Lab: extract research methods + reviewer perspective
 * - Asset Vault: identify GitHub/Huggingface/datasets
 * - Smart Notes: original + reflection + location + expandable cards
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FlaskConical,
    Database,
    Lightbulb,
    X,
    Sparkles,
    Loader2,
    ChevronDown,
    ChevronUp,
    Edit3,
    ExternalLink,
    FileText,
    Save,
    PanelRightClose,
} from 'lucide-react';
import { api } from '../lib/api';
import type { TextLocation } from '../lib/api';

// Types
export interface WorkbenchItem {
    id: string;
    type: 'method' | 'dataset' | 'code' | 'note';
    title: string;
    description: string;
    source_paper_id?: string;
    zone: string;
    created_at: string;
    data?: Record<string, unknown>;
}

interface WorkbenchProps {
    paperId: string;
    paperTitle: string;
    onClose?: () => void;
    onJumpToLocation?: (location: TextLocation) => void;
    refreshKey?: number;  // Increment to trigger refresh
}

// Smart Note Card with expandable reflection
function SmartNoteCard({
    item,
    onRemove,
    onUpdateReflection,
    onJumpToItemLocation,
}: {
    item: WorkbenchItem;
    onRemove: () => void;
    onUpdateReflection: (reflection: string) => void;
    onJumpToItemLocation?: (location: TextLocation) => void;
}) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [reflection, setReflection] = useState(
        (item.data?.reflection as string) || ''
    );
    const [isSaving, setIsSaving] = useState(false);

    const originalText = (item.data?.original_text as string) || '';
    const locationStr = (item.data?.location as string) || '';

    let locationObj: TextLocation | null = null;
    try {
        if (locationStr) {
            locationObj = JSON.parse(locationStr);
        }
    } catch (e) {
        // Ignore invalid location
    }

    const reflectionUpdatedAt = item.data?.reflection_updated_at as string;

    const handleSave = async () => {
        setIsSaving(true);
        await onUpdateReflection(reflection);
        setIsSaving(false);
        setIsEditing(false);
    };

    return (
        <div className={`bg-purple-50 border border-purple-200 rounded-xl overflow-hidden transition-all ${isExpanded ? 'shadow-lg' : 'shadow-sm'}`}>
            {/* Header */}
            <div
                className="p-3 cursor-pointer flex items-start gap-2"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <Lightbulb className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-purple-900 line-clamp-1">{item.title}</div>
                    <p className="text-xs text-purple-600 line-clamp-1 mt-0.5">
                        {reflection || t('workbench.clickToAddReflection')}
                    </p>
                </div>
                <div className="flex items-center gap-1">
                    {/* Location Jump Button */}
                    {locationObj && onJumpToItemLocation && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onJumpToItemLocation(locationObj!);
                            }}
                            className="p-1 text-purple-400 hover:text-purple-700 hover:bg-purple-100 rounded transition-colors"
                            title={t('workbench.jumpToLocation')}
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="p-1 text-purple-400 hover:text-red-500 rounded"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-purple-100">
                    {/* Original Text */}
                    <div className="mt-3">
                        <div className="flex items-center gap-1 text-xs text-purple-500 mb-1">
                            <FileText className="w-3 h-3" />
                            {t('workbench.originalText')}
                            {locationObj && (
                                <span
                                    className="text-purple-400 cursor-pointer hover:underline ml-1"
                                    onClick={() => onJumpToItemLocation?.(locationObj!)}
                                >
                                    ({t('workbench.line')} {locationObj.start_line})
                                </span>
                            )}
                        </div>
                        <div className="bg-white rounded-lg p-3 text-sm text-slate-700 border border-purple-100 max-h-32 overflow-y-auto">
                            {originalText}
                        </div>
                    </div>

                    {/* Reflection */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1 text-xs text-purple-500">
                                <Edit3 className="w-3 h-3" />
                                {t('workbench.reflection')}
                            </div>
                            {reflectionUpdatedAt && (
                                <span className="text-xs text-purple-300">
                                    {new Date(reflectionUpdatedAt).toLocaleString('zh-CN')}
                                </span>
                            )}
                        </div>
                        {isEditing ? (
                            <div className="space-y-2">
                                <textarea
                                    value={reflection}
                                    onChange={(e) => setReflection(e.target.value)}
                                    className="w-full h-32 p-3 text-sm border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                    placeholder={t('workbench.clickToAddReflection').replace('...', '')}
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1"
                                    >
                                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                        {t('common.save')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => setIsEditing(true)}
                                className="bg-white rounded-lg p-3 text-sm text-slate-700 border border-purple-100 min-h-[60px] cursor-text hover:border-purple-300 transition-colors"
                            >
                                {reflection || <span className="text-slate-400 italic">{t('workbench.clickToAddReflection')}</span>}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Method Card with analysis data
function MethodCard({ item, onRemove }: { item: WorkbenchItem; onRemove: () => void }) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const analysis = item.data?.analysis as Record<string, unknown> | undefined;

    return (
        <div className={`bg-indigo-50 border border-indigo-200 rounded-xl overflow-hidden transition-all ${isExpanded ? 'shadow-lg' : 'shadow-sm'}`}>
            <div
                className="p-3 cursor-pointer flex items-start gap-2"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <FlaskConical className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-indigo-900">{item.title}</div>
                    <p className="text-xs text-indigo-600 line-clamp-2 mt-0.5">{item.description}</p>
                </div>
                <div className="flex items-center gap-1">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
                    <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 text-indigo-400 hover:text-red-500 rounded">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {isExpanded && analysis && (
                <div className="px-3 pb-3 space-y-2 border-t border-indigo-100 mt-0 pt-3">
                    {Boolean(analysis.pseudocode) && (
                        <div>
                            <div className="text-xs text-indigo-500 mb-1">{t('workbench.pseudocode')}</div>
                            <pre className="bg-slate-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto">
                                {String(analysis.pseudocode as string)}
                            </pre>
                        </div>
                    )}
                    {Boolean(analysis.reviewer_comments) && (
                        <div>
                            <div className="text-xs text-indigo-500 mb-1">{t('workbench.reviewerPerspective')}</div>
                            <div className="bg-white rounded-lg p-2 text-xs space-y-1">
                                {((analysis.reviewer_comments as Record<string, string[]>).strengths || []).map((s: string, i: number) => (
                                    <div key={i} className="text-green-600">✓ {s}</div>
                                ))}
                                {((analysis.reviewer_comments as Record<string, string[]>).weaknesses || []).map((w: string, i: number) => (
                                    <div key={i} className="text-amber-600">⚠ {w}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Asset Card
function AssetCard({ item, onRemove }: { item: WorkbenchItem; onRemove: () => void }) {
    const { t } = useTranslation();
    const asset = item.data?.asset as Record<string, unknown> | undefined;
    const url = asset?.url as string;

    return (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 shadow-sm">
            <div className="flex items-start gap-2">
                <Database className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-emerald-900">{item.title}</div>
                    <p className="text-xs text-emerald-600 line-clamp-2 mt-0.5">{item.description}</p>
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 mt-2"
                        >
                            <ExternalLink className="w-3 h-3" />
                            {String(asset?.platform || t('workbench.link'))}
                        </a>
                    )}
                </div>
                <button onClick={onRemove} className="p-1 text-emerald-400 hover:text-red-500 rounded">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

// Drop Zone Component
function DropZone({
    title,
    icon,
    items,
    onDrop,
    onRemoveItem,
    isLoading,
    renderItem,
}: {
    title: string;
    icon: React.ReactNode;
    items: WorkbenchItem[];
    onDrop: (text: string) => void;
    onRemoveItem: (itemId: string) => void;
    isLoading: boolean;
    renderItem: (item: WorkbenchItem, onRemove: () => void) => React.ReactNode;
}) {
    const { t } = useTranslation();
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        // Get text from drag
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
            onDrop(text);
        }
    };

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed transition-all ${isDragOver
                ? 'border-indigo-400 bg-indigo-50 scale-[1.02]'
                : 'border-slate-200 bg-slate-50/50'
                }`}
        >
            <div className="p-3 border-b border-slate-200 bg-white rounded-t-xl">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="font-semibold text-sm text-slate-700">{title}</span>
                    {items.length > 0 && (
                        <span className="ml-auto px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                            {items.length}
                        </span>
                    )}
                    {isLoading && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin ml-auto" />}
                </div>
            </div>
            <div className="p-3 min-h-[100px] space-y-2">
                {items.length === 0 && !isLoading ? (
                    <div className={`flex flex-col items-center justify-center h-20 text-xs ${isDragOver ? 'text-indigo-500' : 'text-slate-400'}`}>
                        <span className="text-lg mb-1">{isDragOver ? '📥' : '📋'}</span>
                        <span>{isDragOver ? t('workbench.releaseToAdd') : t('workbench.dragToAdd')}</span>
                    </div>
                ) : (
                    items.map((item) => renderItem(item, () => onRemoveItem(item.id)))
                )}
            </div>
        </div>
    );
}

// Main Enhanced Workbench Component
export default function Workbench({ paperId, paperTitle, onClose, onJumpToLocation, refreshKey }: WorkbenchProps) {
    const { t } = useTranslation();
    const [methodItems, setMethodItems] = useState<WorkbenchItem[]>([]);
    const [assetItems, setAssetItems] = useState<WorkbenchItem[]>([]);
    const [noteItems, setNoteItems] = useState<WorkbenchItem[]>([]);
    const [isAnalyzingMethod, setIsAnalyzingMethod] = useState(false);
    const [isAnalyzingAsset, setIsAnalyzingAsset] = useState(false);
    const [_isLoading, setIsLoading] = useState(true);

    // Auto-generated analysis data
    const [autoAnalysis, setAutoAnalysis] = useState<{
        methods: Array<{ name: string; description: string }>;
        datasets: Array<{ name: string; description: string; url?: string }>;
        code_refs: Array<{ repo_url?: string; description: string }>;
    } | null>(null);
    const [showAutoSection, setShowAutoSection] = useState(true);

    // Load existing workbench items for this paper on mount
    useEffect(() => {
        const loadWorkbenchItems = async () => {
            if (!paperId) {
                setIsLoading(false);
                return;
            }
            try {
                const { data } = await api.get(`/papers/${paperId}/workbench`);
                if (data) {
                    setMethodItems(data.methods || []);
                    setAssetItems(data.datasets || []);
                    setNoteItems(data.notes || []);
                }
            } catch (error) {
                console.error('Failed to load workbench items:', error);
            } finally {
                setIsLoading(false);
            }
        };

        // Also load auto-generated analysis data
        const loadAutoAnalysis = async () => {
            if (!paperId) return;
            try {
                const { data } = await api.get(`/papers/${paperId}/analysis`);
                if (data && (data.methods?.length || data.datasets?.length || data.code_refs?.length)) {
                    setAutoAnalysis({
                        methods: data.methods || [],
                        datasets: data.datasets || [],
                        code_refs: data.code_refs || [],
                    });
                }
            } catch (error) {
                // Analysis may not exist yet, that's OK
            }
        };

        loadWorkbenchItems();
        loadAutoAnalysis();
    }, [paperId, refreshKey]);

    // Handle method drop - call LLM analysis
    const handleMethodDrop = useCallback(async (text: string) => {
        setIsAnalyzingMethod(true);
        try {
            const { data } = await api.post('/workbench/analyze/method', {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                location: '',
            });
            if (data.success && data.item_id) {
                // Fetch the created item
                const { data: item } = await api.get(`/workbench/items/${data.item_id}`);
                setMethodItems(prev => [...prev, item]);
            }
        } catch (error) {
            console.error('Method analysis failed:', error);
        } finally {
            setIsAnalyzingMethod(false);
        }
    }, [paperId, paperTitle]);

    // Handle asset drop - call LLM analysis
    const handleAssetDrop = useCallback(async (text: string) => {
        setIsAnalyzingAsset(true);
        try {
            const { data } = await api.post('/workbench/analyze/asset', {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                location: '',
            });
            if (data.success && data.item_ids) {
                // Fetch created items
                for (const itemId of data.item_ids) {
                    const { data: item } = await api.get(`/workbench/items/${itemId}`);
                    setAssetItems(prev => [...prev, item]);
                }
            }
        } catch (error) {
            console.error('Asset analysis failed:', error);
        } finally {
            setIsAnalyzingAsset(false);
        }
    }, [paperId, paperTitle]);

    // Handle note drop - create smart note
    const handleNoteDrop = useCallback(async (text: string) => {
        try {
            const { data } = await api.post('/workbench/notes', {
                text,
                paper_id: paperId,
                paper_title: paperTitle,
                location: '',
                is_title_note: false,
                reflection: '',
            });
            if (data.success && data.item_id) {
                const { data: item } = await api.get(`/workbench/items/${data.item_id}`);
                setNoteItems(prev => [...prev, item]);
            }
        } catch (error) {
            console.error('Note creation failed:', error);
        }
    }, [paperId, paperTitle]);

    // Update note reflection
    const handleUpdateReflection = useCallback(async (itemId: string, reflection: string) => {
        try {
            await api.put(`/workbench/notes/${itemId}/reflection`, { reflection });
            setNoteItems(prev => prev.map(item =>
                item.id === itemId
                    ? { ...item, data: { ...item.data, reflection, reflection_updated_at: new Date().toISOString() } }
                    : item
            ));
        } catch (error) {
            console.error('Update reflection failed:', error);
        }
    }, []);

    // Remove item
    const handleRemove = useCallback(async (itemId: string, zone: 'methods' | 'assets' | 'notes') => {
        try {
            await api.delete(`/workbench/items/${itemId}`);
            if (zone === 'methods') setMethodItems(prev => prev.filter(i => i.id !== itemId));
            if (zone === 'assets') setAssetItems(prev => prev.filter(i => i.id !== itemId));
            if (zone === 'notes') setNoteItems(prev => prev.filter(i => i.id !== itemId));
        } catch (error) {
            console.error('Remove failed:', error);
        }
    }, []);

    const totalItems = methodItems.length + assetItems.length + noteItems.length;

    return (
        <div className="h-full flex flex-col bg-slate-100/50">
            {/* Header */}
            <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    <h2 className="font-bold text-slate-800">{t('workbench.title')}</h2>
                    {totalItems > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                            {totalItems}
                        </span>
                    )}
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <PanelRightClose className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Help Text */}
            <div className="px-4 py-2 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-slate-200 flex-shrink-0">
                <p className="text-xs text-indigo-600">
                    {t('workbench.helpText')}
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Auto-Generated Analysis Section */}
                {autoAnalysis && (autoAnalysis.methods.length > 0 || autoAnalysis.datasets.length > 0 || autoAnalysis.code_refs.length > 0) && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                        <button
                            onClick={() => setShowAutoSection(!showAutoSection)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 hover:bg-slate-200 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-slate-400">🤖</span>
                                <span className="text-xs font-medium text-slate-600">{t('workbench.autoAnalysis')}</span>
                                <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 text-[10px] rounded">
                                    {autoAnalysis.methods.length + autoAnalysis.datasets.length + autoAnalysis.code_refs.length}
                                </span>
                            </div>
                            {showAutoSection ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </button>

                        {showAutoSection && (
                            <div className="p-3 space-y-2">
                                {/* Auto Methods */}
                                {autoAnalysis.methods.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1 text-xs text-slate-500">
                                            <FlaskConical className="w-3 h-3" />
                                            <span>{t('workbench.methods')} ({autoAnalysis.methods.length})</span>
                                        </div>
                                        {autoAnalysis.methods.slice(0, 3).map((m, i) => (
                                            <div key={i} className="bg-white rounded-lg px-2 py-1.5 text-xs text-slate-600 border border-slate-100">
                                                <span className="font-medium">{m.name}</span>
                                                <p className="text-slate-400 line-clamp-1 mt-0.5">{m.description}</p>
                                            </div>
                                        ))}
                                        {autoAnalysis.methods.length > 3 && (
                                            <p className="text-[10px] text-slate-400 pl-2">{t('workbench.more', { count: autoAnalysis.methods.length - 3 })}</p>
                                        )}
                                    </div>
                                )}

                                {/* Auto Datasets */}
                                {autoAnalysis.datasets.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1 text-xs text-slate-500">
                                            <Database className="w-3 h-3" />
                                            <span>{t('workbench.datasets')} ({autoAnalysis.datasets.length})</span>
                                        </div>
                                        {autoAnalysis.datasets.slice(0, 3).map((d, i) => (
                                            <div key={i} className="bg-white rounded-lg px-2 py-1.5 text-xs text-slate-600 border border-slate-100">
                                                <span className="font-medium">{d.name}</span>
                                                {d.url && (
                                                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-indigo-500 hover:underline">
                                                        <ExternalLink className="w-3 h-3 inline" />
                                                    </a>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Auto Code */}
                                {autoAnalysis.code_refs.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1 text-xs text-slate-500">
                                            <span>💻</span>
                                            <span>{t('workbench.code')} ({autoAnalysis.code_refs.length})</span>
                                        </div>
                                        {autoAnalysis.code_refs.slice(0, 2).map((c, i) => (
                                            <div key={i} className="bg-white rounded-lg px-2 py-1.5 text-xs text-slate-600 border border-slate-100">
                                                {c.repo_url ? (
                                                    <a href={c.repo_url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
                                                        {c.repo_url.replace(/^https?:\/\//, '').substring(0, 40)}...
                                                    </a>
                                                ) : (
                                                    <span className="text-slate-400 line-clamp-1">{c.description}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* User Content Section Label */}
                {(methodItems.length > 0 || assetItems.length > 0 || noteItems.length > 0 || autoAnalysis) && (
                    <div className="flex items-center gap-2 pt-2">
                        <span className="text-xs font-medium text-slate-500">{t('workbench.myNotes')}</span>
                        <div className="flex-1 h-px bg-slate-200" />
                    </div>
                )}

                {/* Method Zone */}
                <DropZone
                    title={t('workbench.methodLab')}
                    icon={<FlaskConical className="w-4 h-4 text-indigo-600" />}
                    items={methodItems}
                    onDrop={handleMethodDrop}
                    onRemoveItem={(id) => handleRemove(id, 'methods')}
                    isLoading={isAnalyzingMethod}
                    renderItem={(item, onRemove) => <MethodCard key={item.id} item={item} onRemove={onRemove} />}
                />

                {/* Asset Zone */}
                <DropZone
                    title={t('workbench.assetVault')}
                    icon={<Database className="w-4 h-4 text-emerald-600" />}
                    items={assetItems}
                    onDrop={handleAssetDrop}
                    onRemoveItem={(id) => handleRemove(id, 'assets')}
                    isLoading={isAnalyzingAsset}
                    renderItem={(item, onRemove) => <AssetCard key={item.id} item={item} onRemove={onRemove} />}
                />

                {/* Notes Zone */}
                <DropZone
                    title={t('workbench.smartNotes')}
                    icon={<Lightbulb className="w-4 h-4 text-purple-600" />}
                    items={noteItems}
                    onDrop={handleNoteDrop}
                    onRemoveItem={(id) => handleRemove(id, 'notes')}
                    isLoading={false}
                    renderItem={(item, onRemove) => (
                        <SmartNoteCard
                            key={item.id}
                            item={item}
                            onRemove={onRemove}
                            onUpdateReflection={(reflection) => handleUpdateReflection(item.id, reflection)}
                            onJumpToItemLocation={onJumpToLocation}
                        />
                    )}
                />
            </div>
        </div>
    );
}
