import { useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ChevronDown, FileText, Loader2, MessageSquare, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, annotationsApi } from '../../lib/api';
import type { Annotation, TextLocation } from '../../lib/api';
import Workbench from '../Workbench';
import type { WorkbenchItem } from '../Workbench';
import type { useReadingWorkspace } from './useReadingWorkspace';

type ReadingState = ReturnType<typeof useReadingWorkspace>;

function AnnotationCard({ item, onChange, onJump, draft, onDraftChange, onDraftDrop, onDraftError, focus, onSaveNote }: {
    item: Annotation; onChange: () => void; onJump: (item: Annotation) => void;
    focus: string; draft?: string; onDraftChange: (id: string, text: string) => void;
    onDraftDrop: (id: string) => void; onSaveNote: (id: string) => Promise<boolean>; onDraftError: (message: string) => void;
}) {
    const note = draft ?? item.content ?? '';
    const dirty = note !== (item.content || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const change = async (action: 'note' | 'evidence' | 'delete') => {
        setBusy(true); setError('');
        try {
            if (action === 'note') {
                if (!await onSaveNote(item.id)) throw new Error('note-save-failed');
            } else if (action === 'delete') { await annotationsApi.delete(item.id); onDraftDrop(item.id); }
            else await annotationsApi.update(item.id, { is_evidence: !item.is_evidence, research_question: item.research_question || focus });
            onChange();
        } catch { setError('保存失败，内容仍保留在这里，请重试。'); onDraftError('批注未保存，文字仍保留在研究笔记中。'); }
        finally { setBusy(false); }
    };
    return <section className="research-card" data-testid="annotation-card">
        <div className="flex items-center justify-between gap-2 text-xs text-content-muted">
            <span>{item.is_evidence ? '证据材料' : item.type === 'highlight' ? '高亮' : '我的批注'}</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{item.visibility === 'team' ? '团队可见' : '仅自己'}</span>
        </div>
        {item.selected_text && <blockquote className="research-quote">{item.selected_text}</blockquote>}
        {item.research_question && <p className="text-xs text-content-muted mt-3">关联问题 · {item.research_question}</p>}
        <label className="block mt-3 text-xs font-medium text-content-muted" htmlFor={`note-${item.id}`}>我的理解{item.visibility === 'team' ? '（团队可见）' : ''}</label>
        <textarea id={`note-${item.id}`} className="research-input mt-1" rows={2} value={note}
            onChange={event => onDraftChange(item.id, event.target.value)} onBlur={() => { if (dirty && !busy) void change('note'); }} placeholder="为什么重要？有什么条件或疑问？" />
        {note !== (item.content || '') && <button className="research-text-button mt-1" disabled={busy} onClick={() => void change('note')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}保存理解
        </button>}
        {error && <p role="alert" className="text-xs text-red-700 mt-2">{error}</p>}
        {!item.anchor && <p className="text-[11px] text-amber-700 mt-3">旧笔记 · 原文位置待核对</p>}
        {item.anchor?.representation === 'translation' && <p className="text-[11px] text-amber-700 mt-3">摘自译文，引用前请核对原文</p>}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <button className="research-text-button" onClick={() => onJump(item)}><ArrowUpRight className="w-3.5 h-3.5" />回到原文</button>
            <div className="flex items-center gap-1">
                {item.selected_text && <button className="research-icon-button" title={item.is_evidence ? '移出证据篮，保留批注' : '收进证据篮'}
                    disabled={busy} onClick={() => void change('evidence')}><Bookmark className={`w-4 h-4 ${item.is_evidence ? 'fill-current text-emerald-700' : ''}`} /></button>}
                <button className="research-icon-button" title="删除这条批注" disabled={busy} onClick={() => void change('delete')}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
        </div>
    </section>;
}

export default function ResearchPanel({ paperId, ownerId, paperTitle, annotations, reading, onChange, onJump, onJumpToLocation, onClose, refreshKey, noteDrafts, onDraftChange, onDraftDrop, onDraftError, onSaveNote }: {
    paperId: string; ownerId?: string; paperTitle: string; annotations: Annotation[]; reading: ReadingState;
    onChange: () => void; onJump: (item: Annotation) => void; onJumpToLocation: (location: TextLocation) => void;
    onClose: () => void; refreshKey: number;
    noteDrafts: Record<string, string>; onDraftChange: (id: string, text: string) => void;
    onDraftDrop: (id: string) => void; onSaveNote: (id: string) => Promise<boolean>; onDraftError: (message: string) => void;
}) {
    const [tab, setTab] = useState<'evidence' | 'notes' | 'tools'>('evidence');
    const [legacyError, setLegacyError] = useState('');
    const { data: legacy, isError: legacyLoadError } = useQuery({
        queryKey: ['reading-legacy-notes', ownerId, paperId, refreshKey],
        queryFn: async () => (await api.get<{ notes: WorkbenchItem[] }>(`/papers/${paperId}/workbench`)).data.notes,
    });
    const evidence = annotations.filter(item => item.is_evidence);
    const items = tab === 'evidence' ? evidence : annotations;
    const saveLabels = { loading: '正在载入', saved: '已保存到账号', pending: '有待保存内容', saving: '正在保存', error: '保存未完成', conflict: '其他窗口已更新' };

    return <div className="research-panel" aria-label="研究笔记面板">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div><p className="research-eyebrow">READ · THINK · CONNECT</p><h2 className="text-lg font-semibold mt-1">研究笔记</h2></div>
            <button className="research-icon-button" aria-label="关闭研究笔记" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pb-4">
            <label htmlFor="reading-focus" className="text-xs font-semibold text-content-muted">这次想弄清什么？</label>
            <textarea id="reading-focus" className="research-focus mt-2" rows={3} maxLength={2000}
                placeholder="带着一个问题读，也可以先读再补。" value={reading.workspace.focus}
                disabled={reading.status === 'loading' || !reading.initial}
                onChange={event => reading.update({ focus: event.target.value })} onBlur={() => void reading.save()} />
            <div className="flex justify-between items-center mt-2 text-[11px] text-content-muted" aria-live="polite">
                <span className="flex items-center gap-1.5">{reading.status === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}{saveLabels[reading.status]}</span>
                <span>当前论文的阅读问题</span>
            </div>
            {reading.status === 'error' && <button className="research-text-button mt-2" onClick={reading.retry}><RotateCcw className="w-3 h-3" />重试保存</button>}
            {reading.status === 'conflict' && <div className="research-warning mt-2">
                当前草稿仍在本页。请先复制需要保留的文字，再载入其他窗口的阅读现场。
                <button className="underline block mt-1" onClick={() => void reading.reload()}>载入远端现场并替换本页草稿</button>
            </div>}
        </div>
        <div className="research-tabs" role="tablist" aria-label="阅读材料">
            <button role="tab" aria-selected={tab === 'evidence'} onClick={() => setTab('evidence')}><Bookmark className="w-3.5 h-3.5" />证据篮<span>{evidence.length}</span></button>
            <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}><MessageSquare className="w-3.5 h-3.5" />批注<span>{annotations.length + (legacy?.length || 0)}</span></button>
            <button role="tab" aria-selected={tab === 'tools'} onClick={() => setTab('tools')}>工具</button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3" role="tabpanel">
            {tab !== 'tools' && <>
                {items.length === 0 && <div className="research-empty">
                    {tab === 'evidence' ? <Bookmark className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
                    <h3>{tab === 'evidence' ? '让问题有据可循' : '留下自己的理解'}</h3>
                    <p>{tab === 'evidence' ? '选中正文，收进证据篮。先留下材料，再慢慢判断它说明了什么。' : '选中一段原文添加批注。原文和你的理解会一起保留。'}</p>
                    <span className="flex items-center gap-1 text-xs mt-3"><Plus className="w-3 h-3" />在正文中选一段文字开始</span>
                </div>}
                {items.map(item => <AnnotationCard key={item.id} item={item} onChange={onChange} onJump={onJump}
                    draft={noteDrafts[item.id]} focus={reading.workspace.focus} onDraftChange={onDraftChange} onDraftDrop={onDraftDrop} onDraftError={onDraftError} onSaveNote={onSaveNote} />)}
                {tab === 'notes' && legacyLoadError && <p role="alert" className="research-warning">旧工作台笔记暂时无法载入，请稍后重试。</p>}
                {tab === 'notes' && legacy?.map(item => <details className="research-card" key={item.id}>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm"><FileText className="w-4 h-4" />{item.title}<ChevronDown className="w-3 h-3 ml-auto" /></summary>
                    <p className="text-[11px] text-amber-700 mt-3">旧工作台笔记 · 原文位置待核对</p>
                    <blockquote className="research-quote">{String(item.data?.original_text || '')}</blockquote>
                    <p className="text-sm mt-3 whitespace-pre-wrap">{String(item.data?.reflection || item.description || '')}</p>
                    <button className="research-text-button mt-3" onClick={() => {
                        const quote = String(item.data?.original_text || '');
                        if (!quote) { setLegacyError('这条旧笔记没有原文摘录，请在工具面板核对。'); return; }
                        onJump({ selected_text: quote } as Annotation);
                    }}>核对原文<ArrowUpRight className="w-3 h-3" /></button>
                </details>)}
                {legacyError && <p role="status" className="research-warning">{legacyError}</p>}
            </>}
            {tab === 'tools' && <>
                <p className="text-xs leading-6 text-content-muted px-1">按需提炼方法与资产。AI 结果需要回到原文核对后使用。</p>
                <Workbench paperId={paperId} paperTitle={paperTitle} refreshKey={refreshKey} annotations={annotations}
                    onJumpToLocation={onJumpToLocation} onJumpToHighlight={text => onJump({ selected_text: text } as Annotation)} />
            </>}
        </div>
        <div className="research-next">
            <label htmlFor="reading-next" className="text-xs font-semibold text-content-muted">下次从这里继续</label>
            <textarea id="reading-next" className="research-input mt-2" rows={2} maxLength={4000} value={reading.workspace.next_action}
                disabled={!reading.initial || reading.status === 'loading'} placeholder="例如：核对表 2，看看结论在另一组样本中是否成立。"
                onChange={event => reading.update({ next_action: event.target.value })} onBlur={() => void reading.save()} />
        </div>
    </div>;
}
