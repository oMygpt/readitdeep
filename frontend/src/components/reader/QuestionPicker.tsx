import { useState } from 'react';
import { Link } from 'react-router-dom';
import { researchApi, researchError, researchLogin } from '../../lib/research';
import type { ResearchQuestion } from '../../lib/research';
import { isLinkedMode } from '../../lib/api';

export default function QuestionPicker({ value, onChange, disabled = false, showComparison = true }: {
    value: ResearchQuestion | null; onChange: (question: ResearchQuestion | null) => void; disabled?: boolean; showComparison?: boolean;
}) {
    const [questions, setQuestions] = useState<ResearchQuestion[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [more, setMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const load = async (append = false) => {
        setBusy(true); setError('');
        try { const page = await researchApi.questions(append ? questions.length : 0); setQuestions(previous => append ? [...previous, ...page] : page); setMore(page.length === 100); setLoaded(true); }
        catch (e) { setError(researchError(e)); } finally { setBusy(false); }
    };
    return <div className="question-picker">
        <div className="flex justify-between gap-3 items-center"><label className="text-xs font-semibold text-content-muted" htmlFor="formal-question">正式研究问题</label>
            {isLinkedMode() && <button className="research-text-button" disabled={busy || disabled} onClick={() => void load()}>{busy ? '载入中…' : loaded ? '刷新问题' : '选择问题'}</button>}</div>
        {value && <p className="text-sm mt-2 leading-6">{value.question}<span className="text-xs text-content-muted block">PaperDaily #{value.id} · {value.status} · 文本快照</span></p>}
        {loaded && <select id="formal-question" aria-label="正式研究问题" className="research-input mt-2" disabled={disabled} value={value?.id || ''}
            onChange={event => onChange(questions.find(q => q.id === Number(event.target.value)) || null)}>
            <option value="">不关联正式问题</option>
            {value && !questions.some(q => q.id === value.id) && <option value={value.id}>{value.question}（既有快照）</option>}
            {questions.map(q => <option key={q.id} value={q.id}>#{q.id} {q.question}</option>)}
        </select>}
        {loaded && more && <button disabled={busy || disabled} className="research-text-button mt-2" onClick={() => void load(true)}>载入更多问题</button>}
        {value && <button className="research-text-button mt-2" disabled={disabled} onClick={() => onChange(null)}>解除关联，保留阅读焦点</button>}
        {!value && !loaded && <p className="text-xs leading-5 text-content-muted mt-2">{isLinkedMode() ? '从主站选择已有问题；本次阅读焦点可在下面单独填写。' : '本地阅读与证据比较可直接使用。连接 PaperDaily 后可关联正式问题。'}</p>}
        {error && <p role="alert" className="text-xs text-amber-800 mt-2">{error} <a className="underline" href={researchLogin(location.pathname + location.search)}>连接研究权限</a></p>}
        {loaded && questions.length === 0 && <p className="text-xs mt-2">主站暂无研究问题，请在 PaperDaily 研究工作台创建后刷新。</p>}
        {showComparison && <Link className="research-text-button mt-3" to="/research">跨论文证据比较 →</Link>}
    </div>;
}
