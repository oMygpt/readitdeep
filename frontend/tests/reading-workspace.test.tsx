import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readingApi } from '../src/lib/reading';
import type { ReadingWorkspace } from '../src/lib/reading';
import { useReadingWorkspace } from '../src/components/reader/useReadingWorkspace';

vi.mock('../src/lib/reading', () => ({ readingApi: { get: vi.fn(), save: vi.fn() } }));
const initial: ReadingWorkspace = { version: 0, focus: '', next_action: '', checkpoint: null };

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readingApi.get).mockResolvedValue(initial);
});
afterEach(cleanup);

describe('reading state saves', () => {
    it('returns failure and preserves the draft when a newer window wins', async () => {
        const { result } = renderHook(() => useReadingWorkspace('paper-a', 'user-a'));
        await waitFor(() => expect(result.current.status).toBe('saved'));
        vi.mocked(readingApi.save).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
        act(() => result.current.update({ focus: '保留这份研究问题草稿' }));
        let ok = true;
        await act(async () => { ok = await result.current.save(); });
        expect(ok).toBe(false);
        expect(result.current.status).toBe('conflict');
        expect(result.current.workspace.focus).toBe('保留这份研究问题草稿');
        await act(async () => { expect(await result.current.save()).toBe(false); });
        expect(readingApi.save).toHaveBeenCalledTimes(1);
    });

    it('serializes blur/navigation behind an in-flight autosave', async () => {
        const { result } = renderHook(() => useReadingWorkspace('paper-a', 'user-a'));
        await waitFor(() => expect(result.current.status).toBe('saved'));
        let release!: (value: ReadingWorkspace) => void;
        vi.mocked(readingApi.save).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
            .mockImplementation(async (_id, body) => ({ ...body, version: body.version + 1 }));
        act(() => result.current.update({ focus: 'first' }));
        let first!: Promise<boolean>;
        act(() => { first = result.current.save(); });
        act(() => result.current.update({ focus: 'latest', next_action: '核对样本' }));
        let blur!: Promise<boolean>; let navigation!: Promise<boolean>;
        act(() => { blur = result.current.save(); navigation = result.current.save(); });
        await act(async () => {
            release({ ...initial, focus: 'first', version: 1 });
            expect(await first).toBe(true); expect(await blur).toBe(true); expect(await navigation).toBe(true);
        });
        expect(readingApi.save).toHaveBeenCalledTimes(2);
        expect(vi.mocked(readingApi.save).mock.calls[1][1]).toMatchObject({ version: 1, focus: 'latest', next_action: '核对样本' });
        expect(result.current.status).toBe('saved');
    });

    it('keeps a failed local draft and retries it without reloading remote state', async () => {
        const { result } = renderHook(() => useReadingWorkspace('paper-a', 'user-a'));
        await waitFor(() => expect(result.current.status).toBe('saved'));
        vi.mocked(readingApi.save).mockRejectedValueOnce(new Error('offline'))
            .mockImplementation(async (_id, body) => ({ ...body, version: 1 }));
        act(() => result.current.update({ focus: '自己的理解' }));
        await act(async () => { expect(await result.current.save()).toBe(false); });
        expect(result.current.status).toBe('error');
        await act(async () => result.current.retry());
        await waitFor(() => expect(result.current.status).toBe('saved'));
        expect(result.current.workspace.focus).toBe('自己的理解');
        expect(readingApi.get).toHaveBeenCalledTimes(1);
    });
});
