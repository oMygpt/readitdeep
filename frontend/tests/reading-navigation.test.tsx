import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readingApi } from '../src/lib/reading';
import type { ReadingWorkspace } from '../src/lib/reading';
import { useReadingWorkspace } from '../src/components/reader/useReadingWorkspace';
import ReadingLeaveGuard from '../src/components/reader/ReadingLeaveGuard';

vi.mock('../src/lib/reading', () => ({ readingApi: { get: vi.fn(), save: vi.fn() } }));
const initial: ReadingWorkspace = { version: 0, focus: '', next_action: '', checkpoint: null };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readingApi.get).mockResolvedValue(initial); });
afterEach(cleanup);

function Editor() {
    const reading = useReadingWorkspace('paper-a', 'user-a');
    const [failed, setFailed] = useState(false);
    return <>
        <ReadingLeaveGuard hasUnsaved={reading.hasUnsaved} flush={reading.save} onFailure={() => setFailed(true)} />
        <textarea aria-label="focus" value={reading.workspace.focus} disabled={!reading.initial}
            onChange={event => reading.update({ focus: event.target.value })} />
        {failed && <p role="alert">草稿仍保留在这里</p>}
    </>;
}

function setup() {
    const router = createMemoryRouter([{ path: '/', element: <p>Library</p> }, { path: '/read', element: <Editor /> }],
        { initialEntries: ['/', '/read'], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    return router;
}

it('flushes the latest focus before allowing browser Back inside the debounce window', async () => {
    let release!: (value: ReadingWorkspace) => void;
    vi.mocked(readingApi.save).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const router = setup();
    await waitFor(() => expect((screen.getByLabelText('focus') as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('focus'), { target: { value: '立即后退时也保存' } });
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/read');
    await waitFor(() => expect(readingApi.save).toHaveBeenCalledTimes(1));
    await act(async () => release({ ...initial, focus: '立即后退时也保存', version: 1 }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

it.each([409, 500])('stays on the reading page after browser Back when saving returns %s', async status => {
    vi.mocked(readingApi.save).mockRejectedValue({ isAxiosError: true, response: { status } });
    const router = setup();
    await waitFor(() => expect((screen.getByLabelText('focus') as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('focus'), { target: { value: '不能丢掉的研究问题' } });
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole('alert');
    expect(router.state.location.pathname).toBe('/read');
    expect((screen.getByLabelText('focus') as HTMLTextAreaElement).value).toBe('不能丢掉的研究问题');
});
