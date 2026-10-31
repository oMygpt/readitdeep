import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OpenPage from '../src/pages/OpenPage';
import { libraryApi } from '../src/lib/api';
import { seriesApi, type ImportItem } from '../src/lib/series';

vi.mock('../src/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/api')>(), isLinkedMode: () => true }));
vi.mock('../src/components/BillingBadge', () => ({ default: () => null }));
vi.mock('../src/components/PaperIntakeActions', () => ({ default: () => <div>Manual intake</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const item = (id: string, oa = false): ImportItem => ({ source_id: id, paper_id: id, status: 'metadata', oa_available: oa });
const blocked = { response: { data: { detail: { error: 'price_confirmation_required', price: 25, paper_id: 'one', message: 'confirm' } } } };
function mount(url: string) {
    const router = createMemoryRouter([
        { path: '/open', element: <OpenPage /> },
        { path: '/library', element: <div>Library destination</div> },
        { path: '/read/:id', element: <div>Reader destination</div> },
    ], { initialEntries: [url] });
    const view = render(<React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>);
    return { router, ...view };
}
beforeEach(() => {
    vi.spyOn(libraryApi, 'list').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 500 } as Awaited<ReturnType<typeof libraryApi.list>>);
    vi.spyOn(seriesApi, 'process');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens imported non-OA papers in the focused library once under StrictMode', async () => {
    const imported = vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [item('one'), item('two')] });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf');
    const { router } = mount('/open?paper=one&paper=two');
    await screen.findByText('Library destination');
    expect(router.state.location.search).toBe('?focus=one,two');
    expect(imported).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
});
it('opens one readable paper directly', async () => {
    vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [{ ...item('one'), status: 'content_ready' }] });
    const { router } = mount('/open?paper=one');
    await screen.findByText('Reader destination');
    expect(router.state.location.pathname).toBe('/read/one');
});
it('keeps partial collection failures visible and does not auto-process the successful subset', async () => {
    vi.spyOn(seriesApi, 'importCollection').mockResolvedValue({ title: 'Collection', items: [item('one', true), { source_id: 'missing', paper_id: null, status: 'error', error: 'Missing paper' }] });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf');
    const { router } = mount('/open?collection=c1');
    await screen.findByText('Missing paper');
    expect(router.state.location.pathname).toBe('/open');
    expect(fetch).not.toHaveBeenCalled();
});
it('keeps the review answer on the landing page', async () => {
    vi.spyOn(seriesApi, 'importReview').mockResolvedValue({ question: 'Question', answer: 'Saved review answer', items: [item('one')] });
    const { router } = mount('/open?review=1');
    await screen.findByText('Saved review answer');
    expect(router.state.location.pathname).toBe('/open');
});
it('stops after an OA error and preserves the error on screen', async () => {
    vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [item('one', true), item('two', true)] });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf').mockRejectedValue(new Error('OA unavailable'));
    const { router } = mount('/open?paper=one&paper=two');
    expect((await screen.findByRole('alert')).textContent).toBe('OA unavailable');
    await screen.findByText('OA unavailable');
    expect(router.state.location.pathname).toBe('/open');
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('stops the batch after a declined price without processing or fetching the next PDF', async () => {
    vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [item('one', true), item('two', true)] });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf').mockRejectedValue(blocked);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount('/open?paper=one&paper=two');
    await screen.findByText('Library destination');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(seriesApi.process).not.toHaveBeenCalled();
});
it('does not confirm, process, fetch the next PDF or redirect after leaving the page', async () => {
    vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [item('one', true), item('two', true)] });
    let rejectFetch: (error: unknown) => void = () => {};
    const fetch = vi.spyOn(seriesApi, 'fetchPdf').mockImplementation(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const confirm = vi.spyOn(window, 'confirm');
    const { router, unmount } = mount('/open?paper=one&paper=two');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { rejectFetch(blocked); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(seriesApi.process).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/open');
});

it('fetches eligible OA papers sequentially before focusing the imported batch', async () => {
    vi.spyOn(seriesApi, 'importPapers').mockResolvedValue({ items: [item('one', true), item('two', true)] });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf').mockResolvedValue({ paper_id: 'one', status: 'uploading', charged: false, price: 0, billing: 'off' });
    const { router } = mount('/open?paper=one&paper=two');
    await screen.findByText('Library destination');
    expect(fetch.mock.calls).toEqual([['one', undefined], ['two', undefined]]);
    expect(router.state.location.search).toBe('?focus=one,two');
});

it('polls the existing review task and never starts paid PDF work on resume', async () => {
    const imported = vi.spyOn(seriesApi, 'importReview').mockResolvedValue({ job_id: 'same-job', status: 'queued', question: 'Synthetic review', answer: '', items: [], total: 2, cited_total: 2 });
    const status = vi.spyOn(seriesApi, 'reviewStatus').mockResolvedValue({ job_id: 'same-job', status: 'done', question: 'Synthetic review', answer: '', items: [item('one', true), item('two', true)], total: 2, cited_total: 2 });
    const fetch = vi.spyOn(seriesApi, 'fetchPdf');
    mount('/open?review=7');
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1), { timeout: 2500 });
    await screen.findByText('Synthetic review');
    expect(imported).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(seriesApi.process).not.toHaveBeenCalled();
});

it('requests a valid library page size with imported targets focused', async () => {
    vi.spyOn(seriesApi, 'importReview').mockResolvedValue({ job_id: 'job', status: 'done', question: 'Review', answer: '', items: [item('one'), item('two')], total: 2, cited_total: 2 });
    mount('/open?review=8');
    await screen.findByText('Review');
    await waitFor(() => expect(libraryApi.list).toHaveBeenCalledWith(expect.objectContaining({ page_size: 100, focus: 'one,two' })));
    expect(await screen.findByText(/成功 2，失败 0/)).toBeTruthy();
});
