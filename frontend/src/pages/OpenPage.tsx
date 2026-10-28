/**
 * Read it DEEP - ask / PaperDaily 深链落地页（深链契约 v1，设计 2026-10-27 v0.2 §7）
 *
 *   /open?paper=<id>[&paper=<id2>…最多 50]&from=ask|daily|library|review[&title=<批次名>]
 *   /open?collection=<主站合集 id>
 *   /open?review=<主站综述历史 id>
 *
 * 未登录时由 ProtectedRoute 送去 PaperDaily 登录并带回本页。导入题录免费；
 * 单篇且已可读时直接打开阅读器；否则自动抓取开放获取 PDF（主站要求确认价格时弹窗，取消则不再继续），
 * 然后直接进知识库并高亮这些论文。非开放获取的论文在知识库里给出版商数据库链接。
 * 综述（review）导入仍停在本页，因为要展示综述正文；授权或导入失败也停在本页。
 * 链接里的标题只用作标签名，题录一律由服务端以用户授权回主站获取。
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BookOpen, CheckCircle, Loader2 } from 'lucide-react';
import { isLinkedMode, libraryApi, type Paper } from '../lib/api';
import { errorMessage, seriesApi, withPriceConfirm, type ImportItem } from '../lib/series';
import { researchApi, researchError, researchLogin } from '../lib/research';
import BillingBadge from '../components/BillingBadge';
import PaperIntakeActions from '../components/PaperIntakeActions';

const READY = ['content_ready', 'completed', 'analyzed', 'embedding_done', 'analyzing', 'classifying'];

interface Imported {
    title?: string;
    question?: string;
    answer?: string;
    items: ImportItem[];
}

export default function OpenPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [result, setResult] = useState<Imported | null>(null);
    const [error, setError] = useState<string | null>(null);
    const started = useRef(false);
    const active = useRef(false);
    const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
    const [manualId, setManualId] = useState('');
    const [resourceBusy, setResourceBusy] = useState<string | null>(null);
    const [resourceMessages, setResourceMessages] = useState<Record<string, string>>({});

    const paperIds = params.getAll('paper').filter(Boolean).slice(0, 50);
    const collection = params.get('collection');
    const review = params.get('review');
    const title = params.get('title')?.slice(0, 100) || undefined;

    const [stage, setStage] = useState<'importing' | 'fetching'>('importing');

    // 逐篇抓开放获取 PDF；免费额度内直接处理，要扣积分时弹窗确认，用户取消一次就不再继续问
    const fetchOpenAccess = async (items: ImportItem[]): Promise<boolean> => {
        for (const item of items) {
            if (!active.current) return false;
            if (!item.paper_id || item.status !== 'metadata' || !item.oa_available) continue;
            try {
                await withPriceConfirm((price) => seriesApi.fetchPdf(item.paper_id!, price), undefined, () => active.current);
            } catch (e) {
                if (!active.current) return false;
                if (e instanceof Error && e.message.startsWith('已取消')) return true;
                setFetchErrors(previous => ({ ...previous, [item.source_id]: errorMessage(e) }));
                return false;
            }
        }
        return active.current;
    };

    useEffect(() => {
        active.current = true;
        const stop = () => { active.current = false; };
        if (started.current) return stop;
        started.current = true;
        if (!isLinkedMode()) {
            setError(t('open.notLinked'));
            return stop;
        }
        (async () => {
            try {
                if (review && /^\d+$/.test(review)) {
                    const r = await seriesApi.importReview(Number(review));
                    if (!active.current) return;
                    setResult(r);
                    if (!r.items.some(item => item.status === 'error')) await fetchOpenAccess(r.items);
                    if (active.current) void refetch();
                } else if (collection || paperIds.length) {
                    const r = collection
                        ? await seriesApi.importCollection(collection)
                        : await seriesApi.importPapers(paperIds, paperIds.length > 1 ? title : undefined);
                    if (!active.current) return;
                    if (r.items.some(item => item.status === 'error')) {
                        setResult(r);
                        return;
                    }
                    const only = r.items.length === 1 ? r.items[0] : null;
                    if (only?.paper_id && READY.includes(only.status)) {
                        navigate(`/read/${only.paper_id}`, { replace: true });
                        return;
                    }
                    const imported = r.items.map((i) => i.paper_id).filter(Boolean) as string[];
                    if (!imported.length) {
                        setResult({ title: (r as { title?: string }).title ?? title, items: r.items });
                        return;
                    }
                    setStage('fetching');
                    if (!await fetchOpenAccess(r.items)) {
                        if (active.current) setResult(r);
                        return;
                    }
                    navigate(`/library?focus=${imported.map(encodeURIComponent).join(',')}`, { replace: true });
                } else {
                    setError(t('open.empty'));
                }
            } catch (e) {
                if (active.current) setError(errorMessage(e));
            }
        })();
        return stop;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 导入后的论文（含状态、arXiv 等字段）从知识库列表取，便于直接上传/获取 PDF
    const ids = new Set((result?.items || []).map((i) => i.paper_id).filter(Boolean) as string[]);
    const { data: library, refetch } = useQuery({
        queryKey: ['library', 'open', [...ids].join(',')],
        queryFn: () => libraryApi.list({ page_size: 500 }),
        enabled: ids.size > 0,
        refetchInterval: (q) => (q.state.data?.items.some((p) => ids.has(p.id) && !['metadata', 'pdf_pending', 'failed', ...READY].includes(p.status)) ? 3000 : false),
    });
    const papers = new Map<string, Paper>((library?.items || []).filter((p) => ids.has(p.id)).map((p) => [p.id, p]));

    const loadResource = async (item: ImportItem) => {
        setResourceBusy(item.source_id);
        try {
            const imported = await researchApi.importPaper(item.source_id, true);
            setResourceMessages(previous => ({ ...previous, [item.source_id]: imported.availability === 'available' ? '主站允许转移的全文已就绪。' : imported.availability === 'scope_required' ? '需要连接研究权限后重试全文导入。' : '主站全文当前不可用，题录已保留；可使用下方 PDF 入库操作。' }));
            await refetch();
        } catch (e) { setResourceMessages(previous => ({ ...previous, [item.source_id]: researchError(e) })); }
        finally { setResourceBusy(null); }
    };
    const importManual = async () => {
        setError(null); setResourceBusy('manual');
        try { const value = await researchApi.importPaper(manualId.trim(), false); setResult({items:[{source_id:manualId.trim(),paper_id:value.paper_id,status:'metadata',created:!value.duplicate}]}); }
        catch (e) { setError(researchError(e)); } finally { setResourceBusy(null); }
    };

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="max-w-3xl mx-auto bg-surface rounded-2xl shadow-xl border border-border p-6 md:p-8">
                <div className="flex items-center gap-3 mb-4">
                    <div className="inline-flex items-center justify-center w-11 h-11 bg-primary/10 rounded-xl">
                        <BookOpen className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-serif font-bold text-content-main">{result?.title || result?.question || t('open.title')}</h1>
                        <BillingBadge className="mt-1" />
                    </div>
                </div>

                {!paperIds.length && !collection && !review && isLinkedMode() && <form className="mb-5" onSubmit={event => { event.preventDefault(); void importManual(); }}>
                    <label htmlFor="manual-paper" className="block text-sm font-medium">论文 ID、DOI 或 arXiv ID</label>
                    <input id="manual-paper" className="research-input mt-2" maxLength={512} value={manualId} onChange={event => setManualId(event.target.value)} />
                    <button className="research-primary mt-3" disabled={!!resourceBusy || !manualId.trim()}>导入题录</button>
                </form>}
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 text-error text-sm mb-4">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><div>{error}{isLinkedMode() && <a className="block underline mt-2" href={researchLogin(location.pathname + location.search)}>连接 PaperDaily 研究权限</a>}</div>
                    </div>
                )}
                {!error && !result && (
                    <div className="flex items-center gap-2 text-content-muted py-8 justify-center">
                        <Loader2 className="w-5 h-5 animate-spin" />{stage === 'fetching' ? t('open.fetchingOa') : t('open.importing')}
                    </div>
                )}

                {result?.answer && (
                    <details className="mb-4 rounded-lg border border-border p-3" open>
                        <summary className="cursor-pointer text-sm font-medium text-content-main">{t('open.reviewAnswer')}</summary>
                        <p className="mt-2 text-sm text-content-dim whitespace-pre-wrap">{result.answer}</p>
                    </details>
                )}

                {result && (
                    <>
                        <p className="text-sm text-content-muted mb-3">{t('open.hint')}</p>
                        <ul className="divide-y divide-border">
                            {result.items.map((item) => {
                                const paper = item.paper_id ? papers.get(item.paper_id) : undefined;
                                const ready = paper && (paper.content_ready || READY.includes(paper.status));
                                return (
                                    <li key={item.source_id} className="py-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-medium text-content-main truncate">{paper?.title || paper?.filename || item.source_id}</p>
                                            {fetchErrors[item.source_id] && <p role="alert" className="text-xs text-error">{fetchErrors[item.source_id]}</p>}
                                            {item.status === 'error' && <p className="text-xs text-error">{item.error || t('open.notFound')}</p>}
                                            {paper && !ready && !['metadata', 'pdf_pending', 'failed'].includes(paper.status) && (
                                                <p className="text-xs text-warning flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t('open.processing')}</p>
                                            )}
                                        </div>
                                        <div className="flex-shrink-0 max-w-[240px] flex flex-col items-end gap-2">
                                            {ready && (
                                                <Link to={`/read/${paper!.id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                                                    <CheckCircle className="w-4 h-4" />{t('open.read')}
                                                </Link>
                                            )}
                                            {paper && !ready && paper.status === 'metadata' && <button className="research-text-button text-xs" disabled={!!resourceBusy} onClick={() => void loadResource(item)}>{resourceBusy === item.source_id ? '正在导入…' : '导入主站可用全文'}</button>}
                                            {resourceMessages[item.source_id] && <p role="status" className="text-xs text-content-muted leading-5">{resourceMessages[item.source_id]} <a className="underline" href={researchLogin(location.pathname + location.search)}>研究权限</a></p>}
                                            {paper && (paper.status === 'metadata' || paper.status === 'pdf_pending') && (
                                                <PaperIntakeActions paper={paper} compact onDone={() => refetch()} />
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}

                <div className="mt-6 text-right">
                    <Link to="/library" className="text-sm text-content-muted hover:text-content-main">{t('open.toLibrary')} →</Link>
                </div>
            </div>
        </div>
    );
}
