/**
 * Read it DEEP - 只有题录（metadata）或 PDF 待处理（pdf_pending）的论文的操作：
 * 上传 PDF / 获取开放获取 PDF / 继续处理。处理时按篇计费，主站报价需要确认时弹窗。
 */

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileUp, Globe, Loader2, RotateCw } from 'lucide-react';
import type { Paper } from '../lib/api';
import { seriesApi, withPriceConfirm } from '../lib/series';
import { useBillingStatus } from './BillingBadge';

interface Props {
    paper: Paper & { error_message?: string; external_full_text_url?: string };
    compact?: boolean;
    onDone?: () => void;
}

export default function PaperIntakeActions({ paper, compact = false, onDone }: Props) {
    const queryClient = useQueryClient();
    const { data: billing } = useBillingStatus();
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async (label: string, action: (price?: number) => Promise<any>) => {
        setBusy(label);
        setError(null);
        try {
            await withPriceConfirm(action, billing?.price);
            onDone?.();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(null);
            queryClient.invalidateQueries({ queryKey: ['library'] });
            queryClient.invalidateQueries({ queryKey: ['billing-status'] });
        }
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) run('upload', (price) => seriesApi.attachPdf(paper.id, file, price));
        if (fileRef.current) fileRef.current.value = '';
    };

    const canFetch = paper.status === 'metadata' && (paper.oa_available ?? (paper.arxiv_id || paper.external_full_text_url));
    const btn = `inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50`;
    const stop = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div className={`flex ${compact ? 'flex-col items-end' : 'flex-wrap items-center'} gap-1.5`} onClick={stop}>
            {paper.status === 'metadata' && <span className="text-[11px] text-content-muted">仅题录</span>}
            {paper.status === 'pdf_pending' ? (
                <button className={btn} disabled={!!busy} onClick={() => run('process', (price) => seriesApi.process(paper.id, price))}
                    title={paper.error_message || ''}>
                    {busy === 'process' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}继续处理
                </button>
            ) : (
                <>
                    <button className={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                        {busy === 'upload' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileUp className="w-3 h-3" />}上传 PDF
                    </button>
                    {canFetch && (
                        <button className={btn} disabled={!!busy} onClick={() => run('fetch', (price) => seriesApi.fetchPdf(paper.id, price))}
                            title="从开放获取来源（如 arXiv）下载">
                            {busy === 'fetch' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}获取开放获取 PDF
                        </button>
                    )}
                    {!canFetch && paper.access_links?.map((link) => (
                        <a key={link.url} className={btn} href={link.url} target="_blank" rel="noopener noreferrer"
                            title="非开放获取：到数据库下载 PDF 后用「上传 PDF」入库">
                            <ExternalLink className="w-3 h-3" />{link.label}
                        </a>
                    ))}
                </>
            )}
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFile} />
            {(error || (paper.status === 'pdf_pending' && paper.error_message)) && (
                <span className="text-[11px] text-error max-w-[220px]" title={error || paper.error_message}>{error || paper.error_message}</span>
            )}
        </div>
    );
}
