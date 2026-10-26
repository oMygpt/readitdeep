/**
 * Read it DEEP - /open?paper=<PaperDaily paper_id>&from=ask|daily|library
 *
 * ask / PaperDaily 的「深读」深链落地页。未登录时由 ProtectedRoute 送去登录（带回本页）。
 * 按论文 ID 直接导入要等主站资源桥接接口（E4b）上线；在此之前引导用户上传 PDF。
 */

import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Upload } from 'lucide-react';

export default function OpenPage() {
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const paperId = params.get('paper') || params.get('collection') || '';

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="w-full max-w-lg bg-surface rounded-2xl shadow-xl border border-border p-8 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-2xl mb-4">
                    <BookOpen className="w-7 h-7 text-primary" />
                </div>
                <h1 className="text-2xl font-serif font-bold text-content-main mb-2">{t('open.title')}</h1>
                {paperId && (
                    <p className="text-xs text-content-muted mb-4">
                        {t('open.paper')}: <code>{paperId}</code>
                    </p>
                )}
                <p className="text-content-muted mb-6">{t('open.pending')}</p>
                <Link
                    to="/library"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90"
                >
                    <Upload className="w-4 h-4" />
                    {t('open.toLibrary')}
                </Link>
            </div>
        </div>
    );
}
