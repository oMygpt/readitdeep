import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Columns3, Send, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isLinkedMode } from '../lib/api';
import { researchApi, researchError, researchLogin } from '../lib/research';
import type { Comparison, ComparisonItem, Publication } from '../lib/research';
import SourceIdentity from '../components/reader/SourceIdentity';
import QuestionPicker from '../components/reader/QuestionPicker';
import ReadingLeaveGuard from '../components/reader/ReadingLeaveGuard';

const blank = (): Comparison => ({ id: crypto.randomUUID(), title: '新的证据比较', question: null, items: [], notes: '', version: 0 });
const relationships = { unassessed: '待判断', supports: '支持', challenges: '质疑', boundary: '适用边界', method: '方法参照' };
export default function ResearchPage() {
    const evidence = useQuery({ queryKey: ['research-evidence'], queryFn: researchApi.evidence });
    const comparisons = useQuery({ queryKey: ['research-comparisons'], queryFn: researchApi.comparisons });
    const [draft, setDraft] = useState<Comparison>(blank);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<Publication | null>(null);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
        window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const change = (patch: Partial<Comparison>) => { setDraft(value => ({ ...value, ...patch })); setDirty(true); setNotice(''); };
    const saving = useRef<Promise<boolean> | null>(null);
    const save = (): Promise<boolean> => {
        if (saving.current) return saving.current;
        const pending = saveDraft();
        saving.current = pending;
        void pending.finally(() => { if (saving.current === pending) saving.current = null; });
        return pending;
    };
    const saveDraft = async (): Promise<boolean> => {
        setError(''); setBusy(true);
        try { const value = await researchApi.save(draft); setDraft(value); setDirty(false); void comparisons.refetch(); setNotice('比较草稿已保存，仅自己可见。'); return true; }
        catch (e) { setError(researchError(e)); return false; } finally { setBusy(false); }
    };
    const switchDraft = async (value: Comparison) => {
        if (value.id === draft.id) return;
        if (dirty && !await save()) return;
        setDraft(value); setDirty(false); setReceipt(null); setError(''); setNotice('');
    };
    const preview = async () => {
        if ((dirty || draft.version === 0) && !await save()) return;
        setBusy(true); setError('');
        try { setReceipt(await researchApi.preview(draft.id)); }
        catch (e) { setError(researchError(e)); } finally { setBusy(false); }
    };
    const publish = async () => {
        if (!receipt) return;
        setBusy(true); setError('');
        try { const result = await researchApi.publish(receipt.id); setReceipt(result); setNotice('已发布到 PaperDaily 私有研究记忆。'); void comparisons.refetch(); }
        catch (e) { setError(researchError(e) + ' 可按同一预览重试，不会改用新的上传内容。'); const server = await researchApi.publication(receipt.id).catch(() => null); if (server) { setReceipt(server); if (server.status === 'succeeded') { setError(''); setNotice('已查询确认：本次内容已发布到研究记忆。'); } } }
        finally { setBusy(false); }
    };
    const changeItem = (id: string, patch: Partial<ComparisonItem>) => change({ items: draft.items.map(item => item.annotation_id === id ? { ...item, ...patch } : item) });
    const selected = new Set(draft.items.map(item => item.annotation_id));
    return <main className="research-hub">
        <ReadingLeaveGuard hasUnsaved={() => dirty} flush={save} onFailure={() => setError('草稿未保存，已留在本页。')} />
        <header className="research-hub-header"><Link to="/library" className="research-text-button"><ArrowLeft className="w-4 h-4" />文献库</Link>
            <div className="flex items-center gap-2"><Columns3 className="w-4 h-4" /><span className="text-sm font-semibold">研究证据工作台</span></div>
            <Link to="/open" className="research-text-button">从 PaperDaily 导入 →</Link></header>
        <div className="research-hub-grid">
            <aside className="research-hub-sidebar">
                <p className="research-eyebrow">QUESTIONS & EVIDENCE</p><h1 className="text-2xl font-serif mt-3">把发现放在一起看</h1>
                <p className="text-sm text-content-muted leading-7 mt-4">选取自己的证据，比较研究结论、方法和适用条件。每段材料都可以回到阅读原文。</p>
                <button className="research-primary mt-6" disabled={busy} onClick={() => void switchDraft(blank())}><Plus className="w-4 h-4" />新的比较</button>
                <h2 className="text-xs font-semibold text-content-muted mt-8 mb-3">我的比较草稿</h2>
                {comparisons.isError && <p role="alert" className="research-warning">草稿载入失败。<button onClick={() => void comparisons.refetch()}>重试</button></p>}
                {comparisons.isLoading && <p className="text-sm">载入中…</p>}
                {comparisons.data?.map(value => <button key={value.id} disabled={busy} className={`comparison-list-item ${draft.id === value.id ? 'active' : ''}`} onClick={() => void switchDraft(value)}>
                    <span className="block text-sm font-medium">{value.title}</span><span className="text-xs text-content-muted">{value.items.length} 段证据{value.remote_id ? ' · 已发布' : ''}</span>
                </button>)}
            </aside>
            <section className="research-hub-main">
                <div className="flex flex-wrap justify-between gap-4 items-center mb-6"><div className="flex-1 min-w-48"><label className="research-eyebrow" htmlFor="comparison-title">COMPARISON DRAFT · 仅自己</label>
                    <input id="comparison-title" className="comparison-title" maxLength={200} value={draft.title} disabled={busy} onChange={e => change({ title: e.target.value })} /></div>
                    <button className="research-primary" disabled={busy} onClick={() => void save()}><Save className="w-4 h-4" />{busy ? '处理中…' : dirty ? '保存草稿' : '保存'}</button></div>
                <QuestionPicker showComparison={false} value={draft.question} disabled={busy} onChange={question => change({ question })} />
                {(error || notice) && <p role={error ? 'alert' : 'status'} className={error ? 'research-warning mt-4' : 'text-sm text-emerald-800 mt-4'}>{error || notice}</p>}
                <div className="comparison-matrix mt-6">
                    {draft.items.length === 0 && <div className="research-empty"><Columns3 className="w-7 h-7" /><h3>先选材料，再作判断</h3><p>从下方证据库选入两篇或更多论文的摘录，也可以先整理单篇。待判断是一种有效状态。</p></div>}
                    {draft.items.map(item => {
                        const source = evidence.data?.find(value => value.id === item.annotation_id);
                        return <article className="comparison-column" key={item.annotation_id}>
                            <div className="flex justify-between gap-3"><h2 className="text-sm font-semibold leading-6">{source?.paper_title || '证据已不可用，请移除后重新选择'}</h2><button className="research-text-button shrink-0" disabled={busy} onClick={() => change({ items: draft.items.filter(value => value !== item) })}>移除</button></div>
                            {source && <><blockquote className="research-quote mt-4">{source.quote}</blockquote><p className="text-xs text-content-muted mt-3 whitespace-pre-wrap">我的批注 · {source.note || '尚未填写'}</p>
                                <Link className="research-text-button mt-3" to={`/read/${source.paper_id}?annotation=${encodeURIComponent(source.id)}`}><ExternalLink className="w-3 h-3" />回到论文核对</Link>
                                <SourceIdentity paperId={source.paper_id} sourceId={source.source_id} disabled={busy} onBound={() => void evidence.refetch()} />
                                <p className="text-[11px] text-content-muted mt-2">{source.anchor ? `${source.anchor.representation === 'translation' ? '译文 · 引用前核对原文' : '原文'} · ${source.anchor.revision_id.slice(0, 10)}` : '旧证据 · 原文位置待核对'}</p></>}
                            <label className="block text-xs font-semibold mt-5" htmlFor={`relation-${item.annotation_id}`}>与问题的关系</label>
                            <select id={`relation-${item.annotation_id}`} disabled={busy} className="research-input mt-2" value={item.relationship} onChange={e => changeItem(item.annotation_id, { relationship: e.target.value as ComparisonItem['relationship'] })}>{Object.entries(relationships).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                            <label className="block text-xs font-semibold mt-4" htmlFor={`judgement-${item.annotation_id}`}>我的比较判断</label>
                            <textarea id={`judgement-${item.annotation_id}`} disabled={busy} className="research-input mt-2" rows={4} maxLength={4000} value={item.judgement} placeholder="结论是否一致？样本、测量或识别策略有什么差异？" onChange={e => changeItem(item.annotation_id, { judgement: e.target.value })} />
                        </article>;
                    })}
                </div>
                <label htmlFor="comparison-notes" className="block text-sm font-semibold mt-6">综合理解与下一步</label>
                <textarea id="comparison-notes" disabled={busy} className="research-input mt-2" rows={5} maxLength={20000} value={draft.notes} placeholder="这些材料共同说明了什么？哪些矛盾还需要更多证据？" onChange={e => change({ notes: e.target.value })} />
                {isLinkedMode() && <div className="mt-4 flex flex-wrap items-center gap-4"><button className="research-primary" disabled={busy || draft.items.length === 0} onClick={() => void preview()}><Send className="w-4 h-4" />预览发布到研究记忆</button><a className="research-text-button" href={researchLogin('/research')}>连接研究权限</a></div>}
                {receipt && <section aria-label="研究记忆发布预览" className="publication-preview mt-5">
                    <h2 className="font-semibold">{receipt.status === 'succeeded' ? '已发布' : '确认这次发布的内容'}</h2><p className="text-xs text-content-muted mt-2 leading-6">固定预览：仅含以下所选摘录、批注和比较判断。以“选段阅读”记入个人研究记忆；不会自动产生论断、奖励或问题订阅。之后修改草稿不会改变此预览。</p>
                    <h3 className="text-lg font-serif mt-4">{receipt.payload.title}</h3><p className="whitespace-pre-wrap text-sm mt-3">{receipt.payload.report_md}</p>
                    {receipt.payload.papers.map(paper => <details key={paper.paper_id} className="mt-3"><summary className="cursor-pointer text-sm font-medium">{paper.paper_id} · 选段阅读</summary><pre className="whitespace-pre-wrap text-xs leading-6 mt-2">{paper.note_md}</pre></details>)}
                    {receipt.status === 'rejected' && <p className="research-warning mt-3">主站已明确拒绝这次请求。可撤销预览，修改草稿后重新发布。</p>}
                    <p className="text-xs text-content-muted mt-4">状态：{receipt.status}{receipt.remote_id ? ` · PaperDaily session ${receipt.remote_id}` : ''}</p>
                    {receipt.status !== 'succeeded' && <button className="research-primary mt-4" disabled={busy} onClick={() => void publish()}>{receipt.status === 'unknown' ? '按同一内容重试发布' : '确认发布到我的研究记忆'}</button>}
                    {['prepared', 'rejected'].includes(receipt.status) && <button disabled={busy} className="research-text-button ml-4" onClick={async () => { try { await researchApi.discard(receipt.id); setReceipt(null); } catch (e) { setError(researchError(e)); } }}>撤销这次预览</button>}
                </section>}
                <div className="flex justify-between mt-10 mb-4"><h2 className="font-semibold">我的证据库</h2><button className="research-text-button" onClick={() => void evidence.refetch()}>刷新证据</button></div>
                {evidence.isError && <p role="alert" className="research-warning">证据载入失败，请刷新重试。</p>}
                {!evidence.isLoading && evidence.data?.length === 0 && <p className="text-sm text-content-muted leading-7">还没有证据。在阅读页选中原文并“收进证据篮”，就会出现在这里。</p>}
                <div className="evidence-library">{evidence.data?.map(value => <label key={value.id} className="evidence-library-item">
                    <input type="checkbox" disabled={busy} checked={selected.has(value.id)} onChange={event => change({ items: event.target.checked ? [...draft.items, { annotation_id: value.id, relationship: 'unassessed', judgement: '' }] : draft.items.filter(item => item.annotation_id !== value.id) })} />
                    <div><h3 className="text-sm font-semibold leading-6">{value.paper_title}</h3><p className="text-sm leading-6 text-content-muted mt-2 line-clamp-3">{value.quote}</p>{value.research_question && <p className="text-xs text-content-muted mt-2">阅读焦点 · {value.research_question}</p>}</div>
                </label>)}</div>
            </section>
        </div>
    </main>;
}
