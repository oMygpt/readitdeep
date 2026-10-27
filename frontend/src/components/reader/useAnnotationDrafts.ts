import { useCallback, useRef, useState } from 'react';
import { annotationsApi } from '../../lib/api';

/** All writes for one annotation share a queue, including navigation flushes. */
export function useAnnotationDrafts() {
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const latest = useRef(drafts);
    const flights = useRef(new Map<string, Promise<boolean>>());

    const update = useCallback((id: string, text: string) => {
        latest.current = { ...latest.current, [id]: text };
        setDrafts(latest.current);
    }, []);
    const drop = useCallback((id: string) => {
        const next = { ...latest.current }; delete next[id];
        latest.current = next; setDrafts(next);
    }, []);

    const saveOne = useCallback(async (id: string): Promise<boolean> => {
        while (flights.current.has(id)) {
            if (!await flights.current.get(id)) return false;
        }
        const text = latest.current[id];
        if (text === undefined) return true;
        const pending = (async () => {
            try {
                await annotationsApi.update(id, { content: text });
                if (latest.current[id] === text) drop(id);
                return true;
            } catch { return false; }
        })();
        flights.current.set(id, pending);
        const ok = await pending;
        flights.current.delete(id);
        if (!ok) return false;
        return latest.current[id] === undefined ? true : saveOne(id);
    }, [drop]);

    const saveAll = useCallback(async (): Promise<boolean> => {
        while (Object.keys(latest.current).length || flights.current.size) {
            const ids = new Set([...Object.keys(latest.current), ...flights.current.keys()]);
            if ((await Promise.all([...ids].map(saveOne))).some(ok => !ok)) return false;
        }
        return true;
    }, [saveOne]);
    const hasUnsaved = useCallback(() => Object.keys(latest.current).length > 0 || flights.current.size > 0, []);
    return { drafts, update, drop, saveOne, saveAll, hasUnsaved };
}
