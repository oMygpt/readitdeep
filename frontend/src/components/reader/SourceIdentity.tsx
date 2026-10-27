import { Link } from 'react-router-dom';
import { useState } from 'react';
import { isLinkedMode } from '../../lib/api';
import { researchApi, researchError } from '../../lib/research';

export default function SourceIdentity({ paperId, sourceId, onBound, disabled }: {
    paperId: string; sourceId?: string; onBound: () => void; disabled: boolean;
}) {
    const [identifier, setIdentifier] = useState('');
    const [candidate, setCandidate] = useState<{id: string; title: string} | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const resolve = async () => { setBusy(true); setError(''); try { setCandidate(await researchApi.resolve(identifier)); } catch (e) { setError(researchError(e)); } finally { setBusy(false); } };
    const bind = async () => { if (!candidate) return; setBusy(true); setError(''); try { await researchApi.bind(paperId, candidate.id); setCandidate(null); onBound(); } catch (e) { setError(researchError(e)); } finally { setBusy(false); } };
    if (sourceId) return <p className="text-xs text-content-muted mt-3">PaperDaily · {sourceId}</p>;
    if (!isLinkedMode()) return null;
    return <details className="mt-3"><summary className="text-xs cursor-pointer">关联主站题录，以便发布记忆</summary>
        <label className="block text-xs mt-3" htmlFor={`source-${paperId}`}>DOI、arXiv 或 PaperDaily ID</label>
        <input id={`source-${paperId}`} className="research-input mt-1" value={identifier} maxLength={512} disabled={disabled || busy} onChange={e => { setIdentifier(e.target.value); setCandidate(null); }} />
        <button className="research-text-button mt-2" disabled={disabled || busy || !identifier.trim()} onClick={() => void resolve()}>查找确切标识</button>
        {candidate && <div className="text-xs leading-6 mt-2"><p>请核对：{candidate.title}</p><p>{candidate.id}</p><button disabled={disabled || busy} className="research-text-button" onClick={() => void bind()}>确认为同一论文并关联</button></div>}
        {error && <p role="alert" className="research-warning mt-2">{error}<Link to="/library" className="block underline mt-2">前往文献库处理题录</Link></p>}
    </details>;
}
