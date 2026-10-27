import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/** Protects browser Back and every in-app route, as well as toolbar navigation. */
export default function ReadingLeaveGuard({ hasUnsaved, flush, onFailure }: {
    hasUnsaved: () => boolean; flush: () => Promise<boolean>; onFailure: () => void;
}) {
    const callbacks = useRef({ hasUnsaved, flush, onFailure });
    callbacks.current = { hasUnsaved, flush, onFailure };
    const busy = useRef(false);
    const shouldBlock = useCallback(({ currentLocation, nextLocation }: {
        currentLocation: { pathname: string }; nextLocation: { pathname: string };
    }) => currentLocation.pathname !== nextLocation.pathname && callbacks.current.hasUnsaved(), []);
    const blocker = useBlocker(shouldBlock);
    useEffect(() => {
        if (blocker.state !== 'blocked' || busy.current) return;
        busy.current = true;
        void callbacks.current.flush().then(ok => {
            if (ok) blocker.proceed();
            else { callbacks.current.onFailure(); blocker.reset(); }
        }).catch(() => { callbacks.current.onFailure(); blocker.reset(); })
            .finally(() => { busy.current = false; });
    }, [blocker]);
    return null;
}
