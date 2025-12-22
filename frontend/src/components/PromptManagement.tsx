/**
 * Read it DEEP - 提示词管理组件
 * 
 * 功能:
 * - 查看/编辑所有提示词类型和版本
 * - 版本管理(创建/切换活跃版本)
 * - 编辑历史和回滚
 * - 实时预览 (内嵌)
 */

import { useState, useEffect } from 'react';
import {
    FileText,
    Plus,
    Check,
    Loader2,
    Save,
    History,
    Eye,
    RotateCcw,
    RefreshCw,
    ChevronRight,
    X,
    AlertCircle,
    Play,
} from 'lucide-react';
import {
    promptsApi,
    type PromptTypeItem,
    type PromptVersionItem,
    type PromptDetail,
    type PromptHistoryItem,
    type PromptHistoryDetail,
    type PreviewPaper,
} from '../lib/api';

interface PromptManagementProps {
    onMessage?: (message: string, type: 'success' | 'error') => void;
}

export default function PromptManagement({ onMessage }: PromptManagementProps) {
    // 状态
    const [types, setTypes] = useState<PromptTypeItem[]>([]);
    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [versions, setVersions] = useState<PromptVersionItem[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const [promptDetail, setPromptDetail] = useState<PromptDetail | null>(null);

    // 编辑状态
    const [editSystemPrompt, setEditSystemPrompt] = useState('');
    const [editUserPrompt, setEditUserPrompt] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    // 历史记录
    const [historyList, setHistoryList] = useState<PromptHistoryItem[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [selectedHistory, setSelectedHistory] = useState<PromptHistoryDetail | null>(null);

    // 预览 - 内嵌显示
    const [previewPapers, setPreviewPapers] = useState<PreviewPaper[]>([]);
    const [selectedPaperId, setSelectedPaperId] = useState<string>('');
    const [previewResult, setPreviewResult] = useState<string>('');
    const [previewTokens, setPreviewTokens] = useState<number | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [showPreviewPanel, setShowPreviewPanel] = useState(false);

    // 新建版本
    const [showCreateVersion, setShowCreateVersion] = useState(false);
    const [newVersionNumber, setNewVersionNumber] = useState('');
    const [newVersionDescription, setNewVersionDescription] = useState('');

    // 加载状态
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingPapers, setIsLoadingPapers] = useState(false);

    // 加载类型列表 & 预览论文
    useEffect(() => {
        loadTypes();
        loadPreviewPapers();
    }, []);

    // 当选择类型时加载版本
    useEffect(() => {
        if (selectedType) {
            loadVersions(selectedType);
        }
    }, [selectedType]);

    // 当选择版本时加载详情
    useEffect(() => {
        if (selectedType && selectedVersion) {
            loadDetail(selectedType, selectedVersion);
        }
    }, [selectedType, selectedVersion]);

    // 检测编辑变化
    useEffect(() => {
        if (promptDetail) {
            const changed =
                editSystemPrompt !== promptDetail.system_prompt ||
                editUserPrompt !== promptDetail.user_prompt_template ||
                editDescription !== (promptDetail.description || '');
            setHasChanges(changed);
        }
    }, [editSystemPrompt, editUserPrompt, editDescription, promptDetail]);

    const loadTypes = async () => {
        setIsLoading(true);
        try {
            const response = await promptsApi.getTypes();
            setTypes(response.types);
            if (response.types.length > 0 && !selectedType) {
                setSelectedType(response.types[0].name);
            }
        } catch (error) {
            console.error('Failed to load types:', error);
            onMessage?.('加载提示词类型失败', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const loadVersions = async (type: string) => {
        try {
            const response = await promptsApi.getVersions(type);
            setVersions(response.versions);
            // 选择活跃版本或第一个版本
            const activeVersion = response.versions.find(v => v.is_active);
            if (activeVersion) {
                setSelectedVersion(activeVersion.version);
            } else if (response.versions.length > 0) {
                setSelectedVersion(response.versions[0].version);
            }
        } catch (error) {
            console.error('Failed to load versions:', error);
        }
    };

    const loadDetail = async (type: string, version: string) => {
        setIsLoading(true);
        try {
            const detail = await promptsApi.getDetail(type, version);
            setPromptDetail(detail);
            setEditSystemPrompt(detail.system_prompt);
            setEditUserPrompt(detail.user_prompt_template);
            setEditDescription(detail.description || '');
            setHasChanges(false);
            // 清空之前的预览结果
            setPreviewResult('');
            setPreviewTokens(null);
        } catch (error) {
            console.error('Failed to load detail:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadPreviewPapers = async () => {
        setIsLoadingPapers(true);
        try {
            const response = await promptsApi.getPreviewPapers();
            setPreviewPapers(response.papers);
            if (response.papers.length > 0) {
                setSelectedPaperId(response.papers[0].id);
            }
        } catch (error) {
            console.error('Failed to load preview papers:', error);
        } finally {
            setIsLoadingPapers(false);
        }
    };

    const handleSave = async () => {
        if (!selectedType || !selectedVersion) return;

        setIsSaving(true);
        try {
            const updated = await promptsApi.updatePrompt(selectedType, selectedVersion, {
                description: editDescription,
                system_prompt: editSystemPrompt,
                user_prompt_template: editUserPrompt,
                change_note: '通过管理界面更新',
            });
            setPromptDetail(updated);
            setHasChanges(false);
            onMessage?.('保存成功', 'success');
        } catch (error) {
            console.error('Failed to save:', error);
            onMessage?.('保存失败', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSetActive = async () => {
        if (!selectedType || !selectedVersion) return;

        try {
            await promptsApi.setActiveVersion(selectedType, selectedVersion);
            await loadVersions(selectedType);
            onMessage?.(`已设置 ${selectedVersion} 为活跃版本`, 'success');
        } catch (error) {
            console.error('Failed to set active:', error);
            onMessage?.('设置活跃版本失败', 'error');
        }
    };

    const handleLoadHistory = async () => {
        if (!selectedType || !selectedVersion) return;

        try {
            const response = await promptsApi.getHistory(selectedType, selectedVersion);
            setHistoryList(response.history);
            setShowHistory(true);
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    };

    const handleViewHistoryDetail = async (historyId: string) => {
        if (!selectedType || !selectedVersion) return;

        try {
            const detail = await promptsApi.getHistoryDetail(selectedType, selectedVersion, historyId);
            setSelectedHistory(detail);
        } catch (error) {
            console.error('Failed to load history detail:', error);
        }
    };

    const handleRollback = async (historyId: string) => {
        if (!selectedType || !selectedVersion) return;

        if (!confirm('确定要回滚到这个历史版本吗？')) return;

        try {
            const updated = await promptsApi.rollback(selectedType, selectedVersion, historyId);
            setPromptDetail(updated);
            setEditSystemPrompt(updated.system_prompt);
            setEditUserPrompt(updated.user_prompt_template);
            setEditDescription(updated.description || '');
            setHasChanges(false);
            setShowHistory(false);
            setSelectedHistory(null);
            onMessage?.('回滚成功', 'success');
        } catch (error) {
            console.error('Failed to rollback:', error);
            onMessage?.('回滚失败', 'error');
        }
    };

    const handlePreview = async () => {
        if (!selectedType || !selectedPaperId) return;

        setIsPreviewing(true);
        setPreviewResult('');
        setPreviewTokens(null);
        setShowPreviewPanel(true);

        try {
            const result = await promptsApi.preview({
                prompt_type: selectedType,
                system_prompt: editSystemPrompt,
                user_prompt_template: editUserPrompt,
                paper_id: selectedPaperId,
            });
            setPreviewResult(result.result);
            setPreviewTokens(result.tokens_used);
        } catch (error) {
            console.error('Failed to preview:', error);
            setPreviewResult('预览失败: ' + (error as Error).message);
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleCreateVersion = async () => {
        if (!selectedType || !newVersionNumber) return;

        try {
            await promptsApi.createVersion(selectedType, {
                version: newVersionNumber,
                description: newVersionDescription,
                system_prompt: editSystemPrompt,
                user_prompt_template: editUserPrompt,
            });
            setShowCreateVersion(false);
            setNewVersionNumber('');
            setNewVersionDescription('');
            await loadVersions(selectedType);
            setSelectedVersion(newVersionNumber);
            onMessage?.(`版本 ${newVersionNumber} 创建成功`, 'success');
        } catch (error) {
            console.error('Failed to create version:', error);
            onMessage?.('创建版本失败', 'error');
        }
    };

    const handleReload = async () => {
        try {
            await promptsApi.reload();
            await loadTypes();
            await loadPreviewPapers();
            onMessage?.('提示词已重新加载', 'success');
        } catch (error) {
            console.error('Failed to reload:', error);
            onMessage?.('重新加载失败', 'error');
        }
    };

    // 建议下一个版本号
    const suggestNextVersion = () => {
        if (versions.length === 0) return 'v1.0.0';
        const latestVersion = versions[versions.length - 1].version;
        const match = latestVersion.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (match) {
            const minor = parseInt(match[2]) + 1;
            return `v${match[1]}.${minor}.0`;
        }
        return 'v1.0.0';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-content-main">提示词管理</h3>
                        <p className="text-sm text-content-muted">编辑和管理 AI 分析提示词</p>
                    </div>
                </div>
                <button
                    onClick={handleReload}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-content-muted hover:bg-surface-elevated rounded-lg"
                >
                    <RefreshCw className="w-4 h-4" />
                    重新加载
                </button>
            </div>

            {/* Main Layout - 三栏布局 */}
            <div className="grid grid-cols-12 gap-4">
                {/* Left Sidebar - Types & Versions */}
                <div className="col-span-2 space-y-4">
                    {/* 类型列表 */}
                    <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
                        <div className="px-3 py-2 bg-surface-elevated border-b border-border">
                            <h4 className="font-medium text-content-dim text-xs">提示词类型</h4>
                        </div>
                        <div className="divide-y divide-border max-h-48 overflow-y-auto">
                            {types.map(type => (
                                <button
                                    key={type.name}
                                    onClick={() => setSelectedType(type.name)}
                                    className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${selectedType === type.name
                                        ? 'bg-primary/5 text-primary'
                                        : 'hover:bg-surface-hover text-content-main'
                                        }`}
                                >
                                    <span className="font-medium text-xs truncate">{type.name}</span>
                                    <span className="text-xs text-content-dim">{type.version_count}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 版本列表 */}
                    {selectedType && (
                        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
                            <div className="px-3 py-2 bg-surface-elevated border-b border-border flex items-center justify-between">
                                <h4 className="font-medium text-content-dim text-xs">版本</h4>
                                <button
                                    onClick={() => {
                                        setNewVersionNumber(suggestNextVersion());
                                        setShowCreateVersion(true);
                                    }}
                                    className="p-1 text-content-dim hover:text-primary hover:bg-primary/10 rounded"
                                    title="新建版本"
                                >
                                    <Plus className="w-3 h-3" />
                                </button>
                            </div>
                            <div className="divide-y divide-border max-h-40 overflow-y-auto">
                                {versions.map(version => (
                                    <button
                                        key={version.version}
                                        onClick={() => setSelectedVersion(version.version)}
                                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${selectedVersion === version.version
                                            ? 'bg-primary/5 text-primary'
                                            : 'hover:bg-surface-hover text-content-main'
                                            }`}
                                    >
                                        <div className="flex items-center gap-1">
                                            <span className="font-mono text-xs">{version.version}</span>
                                            {version.is_active && (
                                                <span className="w-1.5 h-1.5 bg-success rounded-full" title="活跃版本" />
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Center Panel - Editor */}
                <div className="col-span-6">
                    {isLoading ? (
                        <div className="bg-surface rounded-xl shadow-sm border border-border p-12 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                    ) : promptDetail ? (
                        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
                            {/* Editor Header */}
                            <div className="px-4 py-3 bg-surface-elevated border-b border-border flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-content-main text-sm">
                                        {promptDetail.prompt_type}/{promptDetail.version}
                                    </span>
                                    {promptDetail.is_active && (
                                        <span className="px-1.5 py-0.5 bg-success/10 text-success text-xs rounded">
                                            活跃
                                        </span>
                                    )}
                                    {hasChanges && (
                                        <span className="px-1.5 py-0.5 bg-warning/10 text-warning text-xs rounded">
                                            未保存
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={handleLoadHistory}
                                        className="p-1.5 text-content-dim hover:bg-surface-hover rounded"
                                        title="编辑历史"
                                    >
                                        <History className="w-4 h-4" />
                                    </button>
                                    {!promptDetail.is_active && (
                                        <button
                                            onClick={handleSetActive}
                                            className="p-1.5 text-success hover:bg-success/10 rounded"
                                            title="设为活跃版本"
                                        >
                                            <Check className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSave}
                                        disabled={!hasChanges || isSaving}
                                        className="flex items-center gap-1 px-3 py-1 bg-primary text-primary-content text-xs rounded hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSaving ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <Save className="w-3 h-3" />
                                        )}
                                        保存
                                    </button>
                                </div>
                            </div>

                            {/* 描述 */}
                            <div className="px-4 py-2 border-b border-border">
                                <input
                                    type="text"
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    placeholder="版本描述..."
                                    className="w-full text-sm text-content-muted bg-transparent border-none focus:outline-none"
                                />
                            </div>

                            {/* Editor Body */}
                            <div className="p-4 space-y-4">
                                {/* System Prompt */}
                                <div>
                                    <label className="block text-xs font-medium text-content-dim mb-1">
                                        System Prompt
                                    </label>
                                    <textarea
                                        value={editSystemPrompt}
                                        onChange={(e) => setEditSystemPrompt(e.target.value)}
                                        rows={4}
                                        className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs resize-none text-content-main bg-surface"
                                        placeholder="系统提示词..."
                                    />
                                </div>

                                {/* User Prompt */}
                                <div>
                                    <label className="block text-xs font-medium text-content-dim mb-1">
                                        User Prompt Template
                                        <span className="ml-2 text-content-dim font-normal">
                                            (使用 {'{content}'} 占位符)
                                        </span>
                                    </label>
                                    <textarea
                                        value={editUserPrompt}
                                        onChange={(e) => setEditUserPrompt(e.target.value)}
                                        rows={10}
                                        className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs resize-none text-content-main bg-surface"
                                        placeholder="用户提示词模板..."
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-surface rounded-xl shadow-sm border border-border p-12 text-center text-content-dim">
                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>选择提示词类型和版本</p>
                        </div>
                    )}
                </div>

                {/* Right Panel - Preview */}
                <div className="col-span-4">
                    <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden sticky top-4">
                        <div className="px-4 py-3 bg-surface-elevated border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Eye className="w-4 h-4 text-content-dim" />
                                <h4 className="font-medium text-content-main text-sm">实时预览</h4>
                            </div>
                        </div>

                        <div className="p-4 space-y-3">
                            {/* 论文选择 */}
                            <div>
                                <label className="block text-xs font-medium text-content-muted mb-1">
                                    选择论文测试
                                </label>
                                {isLoadingPapers ? (
                                    <div className="flex items-center gap-2 text-content-dim text-sm">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        加载中...
                                    </div>
                                ) : previewPapers.length === 0 ? (
                                    <div className="p-3 bg-warning/5 border border-warning/20 rounded-lg text-xs text-warning flex items-start gap-2">
                                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        <span>暂无可用论文，请先上传并分析一篇论文</span>
                                    </div>
                                ) : (
                                    <select
                                        value={selectedPaperId}
                                        onChange={(e) => setSelectedPaperId(e.target.value)}
                                        className="w-full px-3 py-2 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-content-main"
                                    >
                                        {previewPapers.map(paper => (
                                            <option key={paper.id} value={paper.id}>
                                                {paper.title || paper.filename}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* 预览按钮 */}
                            <button
                                onClick={handlePreview}
                                disabled={isPreviewing || !selectedPaperId || !promptDetail}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-content text-sm rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isPreviewing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        分析中...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        运行预览
                                    </>
                                )}
                            </button>

                            {/* 预览结果 */}
                            {(showPreviewPanel || previewResult) && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-xs text-content-dim">
                                        <span>预览结果</span>
                                        {previewTokens && (
                                            <span className="font-mono">{previewTokens} tokens</span>
                                        )}
                                    </div>
                                    <div className="p-3 bg-surface-elevated rounded-lg max-h-80 overflow-y-auto border border-border">
                                        {isPreviewing ? (
                                            <div className="flex items-center justify-center py-8 text-content-dim">
                                                <Loader2 className="w-6 h-6 animate-spin" />
                                            </div>
                                        ) : previewResult ? (
                                            <pre className="whitespace-pre-wrap text-xs text-content-main">
                                                {previewResult}
                                            </pre>
                                        ) : (
                                            <div className="text-center text-content-dim text-xs py-4">
                                                点击"运行预览"查看效果
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* History Panel Modal */}
            {showHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-surface rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-semibold text-content-main">编辑历史</h3>
                            <button
                                onClick={() => { setShowHistory(false); setSelectedHistory(null); }}
                                className="p-2 hover:bg-surface-elevated rounded-lg"
                            >
                                <X className="w-5 h-5 text-content-main" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden flex">
                            {/* History List */}
                            <div className="w-1/3 border-r border-border overflow-y-auto">
                                {historyList.length === 0 ? (
                                    <div className="p-6 text-center text-content-dim">
                                        暂无编辑历史
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border">
                                        {historyList.map(history => (
                                            <button
                                                key={history.id}
                                                onClick={() => handleViewHistoryDetail(history.id)}
                                                className={`w-full px-4 py-3 text-left hover:bg-surface-hover ${selectedHistory?.id === history.id ? 'bg-primary/5' : ''
                                                    }`}
                                            >
                                                <div className="text-sm font-medium text-content-main">
                                                    {history.change_note || '内容更新'}
                                                </div>
                                                <div className="text-xs text-content-dim mt-1">
                                                    {history.changed_at ? new Date(history.changed_at).toLocaleString() : ''}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* History Detail */}
                            <div className="flex-1 overflow-y-auto p-6">
                                {selectedHistory ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="text-sm text-content-muted">
                                                {selectedHistory.changed_at ? new Date(selectedHistory.changed_at).toLocaleString() : ''}
                                            </div>
                                            <button
                                                onClick={() => handleRollback(selectedHistory.id)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-warning hover:bg-warning/10 rounded-lg"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                回滚到此版本
                                            </button>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-content-dim mb-1">System Prompt</label>
                                            <pre className="p-3 bg-surface-elevated rounded-lg text-xs overflow-x-auto max-h-40 text-content-main">
                                                {selectedHistory.system_prompt}
                                            </pre>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-content-dim mb-1">User Prompt</label>
                                            <pre className="p-3 bg-surface-elevated rounded-lg text-xs overflow-x-auto max-h-60 text-content-main">
                                                {selectedHistory.user_prompt_template}
                                            </pre>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-content-dim">
                                        <div className="text-center">
                                            <ChevronRight className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p>选择一条历史记录查看详情</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Version Modal */}
            {showCreateVersion && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-surface rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
                        <h3 className="font-semibold text-content-main mb-4">创建新版本</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-content-main mb-1">版本号</label>
                                <input
                                    type="text"
                                    value={newVersionNumber}
                                    onChange={(e) => setNewVersionNumber(e.target.value)}
                                    placeholder="v1.0.0"
                                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono bg-surface text-content-main"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-content-main mb-1">描述</label>
                                <input
                                    type="text"
                                    value={newVersionDescription}
                                    onChange={(e) => setNewVersionDescription(e.target.value)}
                                    placeholder="版本描述..."
                                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-content-main"
                                />
                            </div>
                            <p className="text-sm text-content-muted">
                                新版本将基于当前编辑内容创建
                            </p>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setShowCreateVersion(false)}
                                className="px-4 py-2 text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreateVersion}
                                disabled={!newVersionNumber}
                                className="px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
