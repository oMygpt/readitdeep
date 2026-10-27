/**
 * Read it DEEP - 用户偏好（设计 2026-10-27 v0.2 §5 用户层）：
 * 翻译目标语言、译文风格、术语表、解析质量、解析后自动翻译。两种部署模式都可用。
 */

import { useEffect, useState } from 'react';
import { Languages, Plus, Save, Trash2 } from 'lucide-react';
import { seriesApi, errorMessage, type Preferences } from '../lib/series';

export default function PreferencesPanel({ managedHint }: { managedHint?: boolean }) {
    const [prefs, setPrefs] = useState<Preferences | null>(null);
    const [languages, setLanguages] = useState<Record<string, string>>({});
    const [managed, setManaged] = useState(false);
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        seriesApi.getPreferences().then((d) => {
            setPrefs(d.preferences);
            setLanguages(d.languages);
            setManaged(d.managed_by_site);
        }).catch((e) => setStatus({ ok: false, text: errorMessage(e) }));
    }, []);

    if (!prefs) return status ? <p className="text-sm text-red-600">{status.text}</p> : null;

    const set = (patch: Partial<Preferences>) => setPrefs({ ...prefs, ...patch });
    const setTerm = (i: number, key: 'source' | 'target', value: string) =>
        set({ glossary: prefs.glossary.map((t, j) => (j === i ? { ...t, [key]: value } : t)) });

    const save = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const glossary = prefs.glossary.filter((t) => t.source.trim() && t.target.trim());
            const d = await seriesApi.updatePreferences({ ...prefs, glossary });
            setPrefs(d.preferences);
            setStatus({ ok: true, text: '偏好已保存，之后的翻译与解析会使用' });
        } catch (e) {
            setStatus({ ok: false, text: errorMessage(e) });
        } finally {
            setSaving(false);
        }
    };

    const label = 'block text-sm font-medium text-slate-700 mb-1';
    const input = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500';

    return (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
                    <Languages className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                    <h3 className="font-semibold text-slate-900">阅读与翻译偏好</h3>
                    <p className="text-sm text-slate-500">
                        {(managed || managedHint) ? '模型与服务由站点统一配置（校内模型），这里只设置你的偏好' : '翻译语言、风格、术语表与解析质量'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className={label}>翻译目标语言</label>
                    <select className={input} value={prefs.translate_target_lang} onChange={(e) => set({ translate_target_lang: e.target.value })}>
                        {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                </div>
                <div>
                    <label className={label}>译文风格</label>
                    <select className={input} value={prefs.translate_style} onChange={(e) => set({ translate_style: e.target.value as Preferences['translate_style'] })}>
                        <option value="fluent">通顺（意译为主）</option>
                        <option value="literal">忠实（逐句直译）</option>
                    </select>
                </div>
                <div>
                    <label className={label}>PDF 解析质量</label>
                    <select className={input} value={prefs.parse_quality} onChange={(e) => set({ parse_quality: e.target.value as Preferences['parse_quality'] })}>
                        <option value="vlm">高质量（视觉模型逐页识别公式、表格与图）</option>
                        <option value="fast">快速（文本提取，适合纯文字论文）</option>
                    </select>
                </div>
                <label className="flex items-center gap-2 mt-6 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={prefs.auto_translate} onChange={(e) => set({ auto_translate: e.target.checked })} />
                    解析完成后自动全文翻译
                </label>
            </div>

            <div>
                <label className={label}>术语表（翻译时强制使用，最多 200 条）</label>
                <div className="space-y-2">
                    {prefs.glossary.map((t, i) => (
                        <div key={i} className="flex gap-2">
                            <input className={input} placeholder="原文术语" value={t.source} maxLength={100} onChange={(e) => setTerm(i, 'source', e.target.value)} />
                            <input className={input} placeholder="指定译法" value={t.target} maxLength={100} onChange={(e) => setTerm(i, 'target', e.target.value)} />
                            <button type="button" className="p-2 text-slate-400 hover:text-red-600" onClick={() => set({ glossary: prefs.glossary.filter((_, j) => j !== i) })}>
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {prefs.glossary.length < 200 && (
                        <button type="button" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                            onClick={() => set({ glossary: [...prefs.glossary, { source: '', target: '' }] })}>
                            <Plus className="w-4 h-4" />添加术语
                        </button>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-4">
                <button type="button" onClick={save} disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    <Save className="w-4 h-4" />{saving ? '保存中...' : '保存偏好'}
                </button>
                {status && <span className={`text-sm ${status.ok ? 'text-green-600' : 'text-red-600'}`}>{status.text}</span>}
            </div>
        </div>
    );
}
