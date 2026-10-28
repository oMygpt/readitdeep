/**
 * Read it DEEP - PaperDaily 系列站：题录导入、PDF 入库与按篇计费（设计 2026-10-27 v0.2）
 *
 * 题录导入免费；上传或抓取 PDF 时才按篇扣主站积分。主站报价需要确认时后端返回
 * 409 price_confirmation_required（PDF 已保存，论文停在 pdf_pending），确认后调 /process 继续。
 */

import { api } from './api';

export interface BillingStatus {
    mode: 'standalone' | 'off' | 'paperdaily';
    tier: string;
    period: string;
    price: number | null;
    price_version: string | null;
    papers_used: number;
    papers_limit: number | null;
    balance: { grant_remaining?: number; earned_balance?: number } | null;
}

export interface ImportItem {
    source_id: string;
    paper_id: string | null;
    status: string;
    created?: boolean;
    oa_available?: boolean;
    error?: string;
}

export interface ProcessResult {
    paper_id: string;
    status: string;
    charged: boolean;
    price: number;
    billing: string;
}

export interface Preferences {
    translate_target_lang: string;
    translate_style: 'literal' | 'fluent';
    glossary: { source: string; target: string }[];
    parse_quality: 'vlm' | 'fast';
    auto_translate: boolean;
}

export const seriesApi = {
    billingStatus: async (): Promise<BillingStatus> => (await api.get('/billing/status')).data,

    importPapers: async (paperIds: string[], title?: string): Promise<{ items: ImportItem[] }> =>
        (await api.post('/papers/import/paperdaily', { paper_ids: paperIds, title })).data,

    importCollection: async (collectionId: string): Promise<{ title: string; items: ImportItem[] }> =>
        (await api.post('/papers/import/paperdaily/collection', { collection_id: collectionId })).data,

    importReview: async (historyId: number): Promise<{ question: string; answer: string; items: ImportItem[] }> =>
        (await api.post('/papers/import/paperdaily/review', { history_id: historyId })).data,

    upload: async (file: File, confirmPrice?: number): Promise<ProcessResult & { id: string }> => {
        const form = new FormData();
        form.append('file', file);
        if (confirmPrice !== undefined) form.append('confirm_price', String(confirmPrice));
        return (await api.post('/papers/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },

    attachPdf: async (paperId: string, file: File, confirmPrice?: number): Promise<ProcessResult> => {
        const form = new FormData();
        form.append('file', file);
        if (confirmPrice !== undefined) form.append('confirm_price', String(confirmPrice));
        return (await api.post(`/papers/${paperId}/pdf`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },

    fetchPdf: async (paperId: string, confirmPrice?: number): Promise<ProcessResult> =>
        (await api.post(`/papers/${paperId}/fetch-pdf`, { confirm_price: confirmPrice })).data,

    process: async (paperId: string, confirmPrice?: number): Promise<ProcessResult> =>
        (await api.post(`/papers/${paperId}/process`, { confirm_price: confirmPrice })).data,

    getPreferences: async (): Promise<{ preferences: Preferences; languages: Record<string, string>; managed_by_site: boolean }> =>
        (await api.get('/preferences')).data,

    updatePreferences: async (prefs: Partial<Preferences>) => (await api.put('/preferences', prefs)).data,
};

/** 后端计费拦截（detail 为对象）的统一形状 */
export interface ChargeBlock {
    error: string;
    message: string;
    price?: number;
    paper_id?: string;
    used?: number;
    limit?: number;
}

export function chargeBlockOf(err: any): ChargeBlock | null {
    const detail = err?.response?.data?.detail;
    return detail && typeof detail === 'object' && typeof detail.error === 'string' ? detail : null;
}

export function errorMessage(err: any): string {
    const block = chargeBlockOf(err);
    if (block) return block.message;
    const detail = err?.response?.data?.detail;
    return typeof detail === 'string' ? detail : err?.message || '操作失败';
}

/**
 * 执行一次可能计费的操作：主站要求确认价格时弹窗确认，确认后对已保存的 PDF 调 /process。
 * 返回结果；用户取消或被拦下（积分不足、达到篇数等）时抛出带中文消息的 Error。
 * 自动落地流程可提供 shouldContinue，在页面离开后阻止确认与处理。
 */
export async function withPriceConfirm(
    run: (confirmPrice?: number) => Promise<ProcessResult>,
    knownPrice?: number | null,
    shouldContinue: () => boolean = () => true,
): Promise<ProcessResult> {
    if (!shouldContinue()) throw new Error('已取消，页面已离开');
    try {
        return await run(knownPrice ?? undefined);
    } catch (err) {
        const block = chargeBlockOf(err);
        if (block?.error === 'price_confirmation_required' && block.paper_id && typeof block.price === 'number') {
            if (!shouldContinue()) throw new Error('已取消，页面已离开');
            if (!window.confirm(`处理这篇 PDF 将消耗 ${block.price} 积分（OCR/解析、全文翻译与分析都包含在内，同一篇不重复扣）。确认？`)) {
                throw new Error('已取消，PDF 已保存，可稍后在知识库继续处理');
            }
            if (!shouldContinue()) throw new Error('已取消，页面已离开');
            try {
                return await seriesApi.process(block.paper_id, block.price);
            } catch (err2) {
                throw new Error(errorMessage(err2));
            }
        }
        throw new Error(errorMessage(err));
    }
}
