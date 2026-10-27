import { api } from './api';
import type { TextAnchor } from './anchors';

export interface ReadingCheckpoint {
    revision_id: string;
    representation: 'original' | 'translation';
    scroll_ratio: number;
    font_size: number;
    anchor?: TextAnchor | null;
    block_offset?: number;
}

export interface ReadingWorkspace {
    version: number;
    focus: string;
    next_action: string;
    checkpoint: ReadingCheckpoint | null;
    updated_at?: string;
}

export const readingApi = {
    get: async (paperId: string): Promise<ReadingWorkspace> =>
        (await api.get(`/papers/${paperId}/reading-workspace`)).data,
    save: async (paperId: string, body: ReadingWorkspace): Promise<ReadingWorkspace> =>
        (await api.put(`/papers/${paperId}/reading-workspace`, {
            version: body.version, focus: body.focus, next_action: body.next_action, checkpoint: body.checkpoint,
        })).data,
};
