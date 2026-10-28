import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { withPriceConfirm } from '../src/lib/series';

const blocked = (detail: object, status = 409) => ({ isAxiosError: true, response: { status, data: { detail } } });

afterEach(() => vi.restoreAllMocks());

describe('per-PDF charge confirmation', () => {
    it('asks once, then continues processing the saved PDF with the confirmed price', async () => {
        const run = vi.fn().mockRejectedValue(blocked({ error: 'price_confirmation_required', message: 'm', price: 30, paper_id: 'p1' }));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { paper_id: 'p1', status: 'uploading', charged: true, price: 30 } });
        const result = await withPriceConfirm(run);
        expect(confirm.mock.calls[0][0]).toContain('30 积分');
        expect(post).toHaveBeenCalledWith('/papers/p1/process', { confirm_price: 30 });
        expect(result.charged).toBe(true);
    });

    it('does not charge when the user declines', async () => {
        const run = vi.fn().mockRejectedValue(blocked({ error: 'price_confirmation_required', message: 'm', price: 30, paper_id: 'p1' }));
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const post = vi.spyOn(api, 'post');
        await expect(withPriceConfirm(run)).rejects.toThrow('已取消');
        expect(post).not.toHaveBeenCalled();
    });

    it('surfaces limit and credit messages without asking', async () => {
        const confirm = vi.spyOn(window, 'confirm');
        const run = vi.fn().mockRejectedValue(blocked({ error: 'paper_limit_reached', message: '本月已用 5 篇' }, 403));
        await expect(withPriceConfirm(run, 30)).rejects.toThrow('本月已用 5 篇');
        expect(run).toHaveBeenCalledWith(30);
        expect(confirm).not.toHaveBeenCalled();
    });
});

it('does not start processing when the landing flow is no longer active after confirmation', async () => {
    let active = true;
    const run = vi.fn().mockRejectedValue(blocked({ error: 'price_confirmation_required', message: 'm', price: 25, paper_id: 'p1' }));
    vi.spyOn(window, 'confirm').mockImplementation(() => { active = false; return true; });
    const post = vi.spyOn(api, 'post');
    await expect(withPriceConfirm(run, undefined, () => active)).rejects.toThrow('已取消');
    expect(post).not.toHaveBeenCalled();
});
