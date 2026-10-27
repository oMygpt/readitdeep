import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { annotationsApi } from '../src/lib/api';
import type { Annotation } from '../src/lib/api';
import { useAnnotationDrafts } from '../src/components/reader/useAnnotationDrafts';

vi.mock('../src/lib/api', () => ({ annotationsApi: { update: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('serializes blur and navigation, draining edits made during each save', async () => {
    let releaseA!: (value: Annotation) => void;
    let releaseB!: (value: Annotation) => void;
    vi.mocked(annotationsApi.update)
        .mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { releaseB = resolve; }))
        .mockResolvedValue({ id: 'note-a' } as Annotation);
    const { result } = renderHook(useAnnotationDrafts);
    act(() => result.current.update('note-a', 'A'));
    let blur!: Promise<boolean>; let navigation!: Promise<boolean>;
    act(() => { blur = result.current.saveOne('note-a'); });
    act(() => result.current.update('note-a', 'B'));
    act(() => { navigation = result.current.saveAll(); });
    await act(async () => { releaseA({ id: 'note-a' } as Annotation); });
    await waitFor(() => expect(annotationsApi.update).toHaveBeenCalledTimes(2));
    act(() => result.current.update('note-a', 'C'));
    await act(async () => {
        releaseB({ id: 'note-a' } as Annotation);
        expect(await blur).toBe(true); expect(await navigation).toBe(true);
    });
    expect(annotationsApi.update).toHaveBeenCalledTimes(3);
    expect(vi.mocked(annotationsApi.update).mock.calls.map(call => call[1].content)).toEqual(['A', 'B', 'C']);
    expect(result.current.hasUnsaved()).toBe(false);
});

it('keeps failed annotation drafts available for another panel or retry', async () => {
    vi.mocked(annotationsApi.update).mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ id: 'note-a' } as Annotation);
    const { result } = renderHook(useAnnotationDrafts);
    act(() => result.current.update('note-a', '保留这段理解'));
    await act(async () => { expect(await result.current.saveAll()).toBe(false); });
    expect(result.current.drafts['note-a']).toBe('保留这段理解');
    await act(async () => { expect(await result.current.saveAll()).toBe(true); });
    expect(result.current.hasUnsaved()).toBe(false);
});
