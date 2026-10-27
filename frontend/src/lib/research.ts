import { api } from './api';
import type { TextAnchor } from './anchors';
export interface ResearchQuestion { id: number; question: string; status: string; updated_at?: string }
export interface Evidence { id: string; paper_id: string; paper_title: string; source_id?: string; quote: string; note?: string; anchor?: TextAnchor; research_question?: string }
export interface ComparisonItem { annotation_id: string; relationship: 'unassessed' | 'supports' | 'challenges' | 'boundary' | 'method'; judgement: string }
export interface Comparison { id: string; title: string; question: ResearchQuestion | null; items: ComparisonItem[]; notes: string; version: number; remote_id?: string; pending_id?: string }
export interface Publication { id: string; status: string; payload: {title: string; papers: {paper_id: string; depth: string; note_md: string}[]; report_md: string}; remote_id?: string; parent_id?: string }
export const researchApi = {
    resolve: async (paper_id: string): Promise<{id: string; title: string}> => (await api.get('/research/resolve', { params: { paper_id } })).data,
    bind: async (paperId: string, source_id: string): Promise<void> => { await api.post(`/research/papers/${paperId}/source`, { source_id }); },
    questions: async (offset = 0): Promise<ResearchQuestion[]> => (await api.get('/research/questions', { params: { offset } })).data.items,
    evidence: async (): Promise<Evidence[]> => (await api.get('/research/evidence')).data.items,
    comparisons: async (): Promise<Comparison[]> => (await api.get('/research/comparisons')).data.items,
    save: async (value: Comparison): Promise<Comparison> => (await api.put(`/research/comparisons/${value.id}`, {
        version: value.version, title: value.title, question_id: value.question?.id ?? null, items: value.items, notes: value.notes,
    })).data,
    preview: async (id: string): Promise<Publication> => (await api.post(`/research/comparisons/${id}/preview`)).data,
    publication: async (id: string): Promise<Publication> => (await api.get(`/research/publications/${id}`)).data,
    publish: async (id: string): Promise<Publication> => (await api.post(`/research/publications/${id}/publish`)).data,
    discard: async (id: string): Promise<void> => { await api.delete(`/research/publications/${id}`); },
    importPaper: async (paper_id: string, fulltext = true): Promise<{paper_id: string; availability: string; duplicate: boolean}> =>
        (await api.post('/research/import', { paper_id, fulltext })).data,
};
export function researchError(error: unknown): string {
    const e = error as { response?: { status?: number; data?: { detail?: string | {code?: string} } } };
    const detail = e.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (e.response?.status === 403) return '当前授权未开放此操作，请连接研究权限或稍后重试。';
    if (e.response?.status === 409) return '记录已变化或操作尚未完成，请重新载入后重试。';
    return '暂时无法完成，草稿仍保留在本页。请稍后重试。';
}
export function researchLogin(returnTo: string) { return `/api/auth/paperdaily/login?research=true&return_to=${encodeURIComponent(returnTo)}`; }
