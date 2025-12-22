/**
 * CategoryTagEditor - 分类和标签编辑组件
 */

import { useState, useEffect } from 'react';
import { X, Plus, Check, Tag, Folder } from 'lucide-react';
import { classificationApi, libraryApi } from '../lib/api';

interface Props {
    paperId: string;
    currentCategory?: string;
    currentTags: string[];
    onClose: () => void;
    onSaved: () => void;
}

export default function CategoryTagEditor({
    paperId,
    currentCategory,
    currentTags,
    onClose,
    onSaved
}: Props) {
    const [category, setCategory] = useState(currentCategory || '');
    const [tags, setTags] = useState<string[]>(currentTags || []);
    const [newTag, setNewTag] = useState('');
    const [saving, setSaving] = useState(false);
    const [allCategories, setAllCategories] = useState<string[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);

    useEffect(() => {
        // 加载所有分类和标签
        loadOptions();
    }, []);

    const loadOptions = async () => {
        try {
            const [cats, tagStats] = await Promise.all([
                libraryApi.getCategories(),
                fetch('/api/v1/library/tags').then(r => r.json())
            ]);
            // Defensive check: ensure cats is an array before mapping
            setAllCategories(
                Array.isArray(cats)
                    ? cats.map((c: { name: string }) => c.name).filter((n: string) => n !== 'Uncategorized')
                    : []
            );
            // Defensive check: ensure tagStats is an array before mapping
            setAllTags(
                Array.isArray(tagStats)
                    ? tagStats.map((t: { name: string }) => t.name)
                    : []
            );
        } catch (e) {
            console.error('Failed to load options', e);
        }
    };

    const handleAddTag = () => {
        if (newTag.trim() && !tags.includes(newTag.trim())) {
            setTags([...tags, newTag.trim()]);
            setNewTag('');
        }
    };

    const handleRemoveTag = (tag: string) => {
        setTags(tags.filter(t => t !== tag));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            // 更新分类
            if (category !== currentCategory) {
                await classificationApi.updateCategory(paperId, category);
            }
            // 更新标签
            if (JSON.stringify(tags.sort()) !== JSON.stringify((currentTags || []).sort())) {
                await classificationApi.updateTags(paperId, tags);
            }
            onSaved();
            onClose();
        } catch (e) {
            console.error('Save failed', e);
            alert('保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-surface rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-content-main">编辑分类和标签</h3>
                    <button onClick={onClose} className="p-1 hover:bg-surface-elevated rounded-lg">
                        <X className="w-5 h-5 text-content-muted" />
                    </button>
                </div>

                {/* 分类选择 */}
                <div className="mb-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-content-main mb-2">
                        <Folder className="w-4 h-4" />
                        分类
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            placeholder="输入或选择分类"
                            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary bg-surface text-content-main"
                            list="category-options"
                        />
                        <datalist id="category-options">
                            {allCategories.map(cat => (
                                <option key={cat} value={cat} />
                            ))}
                        </datalist>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {allCategories.slice(0, 5).map(cat => (
                            <button
                                key={cat}
                                onClick={() => setCategory(cat)}
                                className={`px-2 py-1 text-xs rounded-full transition-colors ${category === cat
                                    ? 'bg-primary text-primary-content'
                                    : 'bg-surface-elevated text-content-muted hover:bg-surface-active'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 标签编辑 */}
                <div className="mb-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-content-main mb-2">
                        <Tag className="w-4 h-4" />
                        标签
                    </label>

                    {/* 当前标签 */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {tags.map(tag => (
                            <span
                                key={tag}
                                className="px-2 py-1 bg-secondary/10 text-secondary text-sm rounded-full flex items-center gap-1"
                            >
                                {tag}
                                <button onClick={() => handleRemoveTag(tag)} className="hover:text-secondary-hover">
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                        {tags.length === 0 && (
                            <span className="text-sm text-content-dim">暂无标签</span>
                        )}
                    </div>

                    {/* 添加新标签 */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                            placeholder="添加新标签"
                            className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-secondary text-sm bg-surface text-content-main"
                            list="tag-options"
                        />
                        <datalist id="tag-options">
                            {allTags.filter(t => !tags.includes(t)).map(tag => (
                                <option key={tag} value={tag} />
                            ))}
                        </datalist>
                        <button
                            onClick={handleAddTag}
                            className="px-3 py-2 bg-secondary text-secondary-content rounded-lg hover:bg-secondary-hover transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* 常用标签 */}
                    <div className="flex flex-wrap gap-2 mt-3">
                        {allTags.filter(t => !tags.includes(t)).slice(0, 6).map(tag => (
                            <button
                                key={tag}
                                onClick={() => setTags([...tags, tag])}
                                className="px-2 py-1 text-xs bg-surface-elevated text-content-muted rounded-full hover:bg-secondary/10 hover:text-secondary transition-colors"
                            >
                                + {tag}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-content-main hover:bg-surface-elevated rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-content rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
                    >
                        <Check className="w-4 h-4" />
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
}
