// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isLinkedMode } from '../src/lib/api';
import ResearchPage from '../src/pages/ResearchPage';
import { researchApi } from '../src/lib/research';
vi.mock('../src/lib/api', () => ({ isLinkedMode: vi.fn(() => false) }));
vi.mock('../src/components/reader/QuestionPicker', () => ({ default: () => <div>Question picker</div> }));
vi.mock('../src/lib/research', () => ({ researchApi: { evidence: vi.fn(), comparisons: vi.fn(), save: vi.fn(), preview: vi.fn(), publish: vi.fn(), publication: vi.fn() }, researchError: () => '保存失败', researchLogin: () => '/login' }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('shares the in-flight manual save with browser Back', async () => {
    vi.mocked(researchApi.evidence).mockResolvedValue([]); vi.mocked(researchApi.comparisons).mockResolvedValue([]);
    let finish: (value: unknown) => void = () => {};
    vi.mocked(researchApi.save).mockImplementation(value => new Promise(resolve => { finish = () => resolve({ ...value, version: 1 }); }));
    const router = createMemoryRouter([{path: '/library', element: <div>Library destination</div>}, {path:'/research', element:<ResearchPage/>}], { initialEntries:['/library','/research'], initialIndex:1 });
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><RouterProvider router={router}/></QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText('COMPARISON DRAFT · 仅自己'), {target:{value:'My comparison'}});
    fireEvent.click(screen.getByText('保存草稿'));
    await waitFor(() => expect(researchApi.save).toHaveBeenCalledTimes(1));
    await act(async () => { void router.navigate(-1); });
    expect(researchApi.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Library destination')).toBeNull();
    await act(async () => { finish(null); });
    await screen.findByText('Library destination');
    expect(researchApi.save).toHaveBeenCalledTimes(1);
});
it('keeps the draft on screen when navigation save fails', async () => {
    vi.mocked(researchApi.evidence).mockResolvedValue([]); vi.mocked(researchApi.comparisons).mockResolvedValue([]);
    vi.mocked(researchApi.save).mockRejectedValue(new Error('offline'));
    const router = createMemoryRouter([{path:'/library',element:<div>Library destination</div>},{path:'/research',element:<ResearchPage/>}],{initialEntries:['/library','/research'],initialIndex:1});
    render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText('COMPARISON DRAFT · 仅自己'),{target:{value:'Keep this thought'}});
    await act(async()=>{void router.navigate(-1);});
    await screen.findByText('草稿未保存，已留在本页。');
    expect((screen.getByLabelText('COMPARISON DRAFT · 仅自己') as HTMLInputElement).value).toBe('Keep this thought');
    expect(router.state.location.pathname).toBe('/research');
});

it('reads the original receipt after a lost success response without creating a new preview', async () => {
    vi.mocked(isLinkedMode).mockReturnValue(true);
    vi.mocked(researchApi.evidence).mockResolvedValue([{id:'e1',paper_id:'p1',paper_title:'Paper one',quote:'A quote',source_id:'EX1'}]);
    vi.mocked(researchApi.comparisons).mockResolvedValue([{id:'c1',title:'Saved comparison',question:null,items:[{annotation_id:'e1',relationship:'unassessed',judgement:''}],notes:'My synthesis',version:1}]);
    const frozen = {id:'receipt-one',status:'prepared',payload:{title:'Saved comparison',papers:[{paper_id:'EX1',depth:'selected-passages',note_md:'A quote'}],report_md:'My synthesis'}};
    vi.mocked(researchApi.preview).mockResolvedValue(frozen);
    vi.mocked(researchApi.publish).mockRejectedValue(new Error('response lost'));
    vi.mocked(researchApi.publication).mockResolvedValue({...frozen,status:'succeeded',remote_id:'session-one'});
    const router=createMemoryRouter([{path:'/research',element:<ResearchPage/>}],{initialEntries:['/research']});
    render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
    fireEvent.click(await screen.findByText('Saved comparison'));
    fireEvent.click(screen.getByText('预览发布到研究记忆'));
    fireEvent.click(await screen.findByText('确认发布到我的研究记忆'));
    await screen.findByText('已查询确认：本次内容已发布到研究记忆。');
    expect(researchApi.preview).toHaveBeenCalledTimes(1);
    expect(researchApi.publication).toHaveBeenCalledWith('receipt-one');
    expect(screen.queryByText('确认发布到我的研究记忆')).toBeNull();
});
