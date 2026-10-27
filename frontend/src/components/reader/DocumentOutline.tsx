import { useMemo } from 'react';
import { ListTree } from 'lucide-react';

export default function DocumentOutline({ markdown, onJump }: {
    markdown: string; onJump: (title: string, occurrence: number) => void;
}) {
    const headings = useMemo(() => {
        let fence = '';
        const counts = new Map<string, number>();
        return markdown.split('\n').flatMap(line => {
            const marker = line.trim().match(/^(`{3,}|~{3,})/);
            if (marker) { fence = fence ? '' : marker[1][0]; return []; }
            if (fence) return [];
            const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
            if (!match) return [];
            const title = match[2].replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            const occurrence = counts.get(title) || 0;
            counts.set(title, occurrence + 1);
            return [{ level: match[1].length, title, occurrence }];
        });
    }, [markdown]);
    return <nav aria-label="正文目录" className="px-4 py-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-content-muted mb-5"><ListTree className="w-4 h-4" />正文目录</div>
        {headings.length === 0 && <p className="text-xs text-content-muted leading-6">正文没有分节标题，可以直接阅读和批注。</p>}
        {headings.map((heading, index) => <button key={index} className="block w-full text-left text-xs leading-5 rounded-md py-2.5 pr-2 hover:bg-emerald-50 hover:text-emerald-800 text-content-muted"
            style={{ paddingLeft: Math.max(0, heading.level - 2) * 12 + 4 }}
            onClick={() => onJump(heading.title, heading.occurrence)}>{heading.title}</button>)}
    </nav>;
}
