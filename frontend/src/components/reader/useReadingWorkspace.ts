import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { readingApi } from '../../lib/reading';
import type { ReadingWorkspace } from '../../lib/reading';

const empty: ReadingWorkspace = { version: 0, focus: '', next_action: '', checkpoint: null };
type SaveStatus = 'loading' | 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export function useReadingWorkspace(paperId: string, userId?: string) {
    const [workspace, setWorkspace] = useState<ReadingWorkspace>(empty);
    const [status, setStatus] = useState<SaveStatus>('loading');
    const latest = useRef(workspace);
    const version = useRef(0);
    const saved = useRef('');
    const ready = useRef(false);
    const blocked = useRef(false);
    const inFlight = useRef<Promise<void> | null>(null);
    const mounted = useRef(true);
    const [initial, setInitial] = useState<ReadingWorkspace | null>(null);

    const load = useCallback(async () => {
        setStatus('loading');
        try {
            const data = await readingApi.get(paperId);
            if (!mounted.current) return;
            version.current = data.version;
            latest.current = data;
            saved.current = JSON.stringify({ ...data, version: 0, updated_at: undefined });
            ready.current = true;
            blocked.current = false;
            setWorkspace(data);
            setInitial(data);
            setStatus('saved');
        } catch { if (mounted.current) setStatus('error'); }
    }, [paperId]);

    useEffect(() => {
        mounted.current = true;
        if (userId) void load();
        return () => { mounted.current = false; };
    }, [load, userId]);

    const save = useCallback(async (): Promise<boolean> => {
        if (!ready.current || blocked.current) return false;
        while (inFlight.current) {
            await inFlight.current;
            if (blocked.current) return false;
        }
        const snapshot = latest.current;
        const fingerprint = JSON.stringify({ ...snapshot, version: 0, updated_at: undefined });
        if (fingerprint === saved.current) return true;
        setStatus('saving');
        const pending = (async () => {
            try {
                const data = await readingApi.save(paperId, { ...snapshot, version: version.current });
                version.current = data.version;
                saved.current = fingerprint;
                if (mounted.current) setStatus(latest.current === snapshot ? 'saved' : 'pending');
            } catch (error) {
                // Never silently replace a newer checkpoint from another tab/device.
                blocked.current = true;
                if (mounted.current) setStatus(axios.isAxiosError(error) && error.response?.status === 409 ? 'conflict' : 'error');
            }
        })();
        inFlight.current = pending;
        await pending;
        if (inFlight.current === pending) inFlight.current = null;
        if (!blocked.current && latest.current !== snapshot) return save();
        return !blocked.current;
    }, [paperId]);

    const update = useCallback((changes: Partial<ReadingWorkspace>) => {
        if (!ready.current) return;
        const next = { ...latest.current, ...changes };
        latest.current = next;
        setWorkspace(next);
        if (!blocked.current) setStatus('pending');
    }, []);

    useEffect(() => {
        if (status !== 'pending') return;
        const timer = setTimeout(() => { void save(); }, 700);
        return () => clearTimeout(timer);
    }, [workspace, status, save]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (status === 'pending' || status === 'saving' || (ready.current && blocked.current)) {
                event.preventDefault();
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [status]);

    const retry = useCallback(() => {
        if (!ready.current) { void load(); return; }
        blocked.current = false;
        void save();
    }, [load, save]);
    const hasUnsaved = useCallback(() => ready.current && (blocked.current || !!inFlight.current
        || JSON.stringify({ ...latest.current, version: 0, updated_at: undefined }) !== saved.current), []);
    return { workspace, initial, status, update, save, hasUnsaved, reload: load, retry };
}
