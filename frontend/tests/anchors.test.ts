import { afterEach, describe, expect, it } from 'vitest';
import { anchorFromRange, resolveAnchor } from '../src/lib/anchors';

afterEach(() => { document.body.innerHTML = ''; });

function content(html: string) {
    const container = document.createElement('article');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
}

describe('revision-scoped text anchors', () => {
    it('keeps the second repeated quote and never chooses a legacy first match', () => {
        const root = content('<h2>Problem</h2><p>相同的结论。</p><h2>Methods</h2><p>相同的结论。</p>');
        const second = root.querySelectorAll('p')[1];
        const range = document.createRange(); range.selectNodeContents(second);
        const anchor = anchorFromRange(root, range, 'revision-a', 'original')!;
        expect(anchor.exact).toBe('相同的结论。');
        expect(resolveAnchor(root, { anchor }, 'revision-a')?.startContainer.parentElement).toBe(second);
        expect(resolveAnchor(root, { selected_text: '相同的结论。' }, 'revision-a')).toBeNull();
        expect(resolveAnchor(root, { anchor }, 'revision-b')).toBeNull();
    });

    it('handles selections spanning formatting, links, CJK and surrogate pairs', () => {
        const root = content('<p>前文 😀<strong>识别假设</strong>与<a href="#">原文证据</a> 后文</p>');
        const paragraph = root.querySelector('p')!;
        const range = document.createRange(); range.selectNodeContents(paragraph);
        const anchor = anchorFromRange(root, range, 'revision-a', 'original')!;
        expect(anchor.exact).toBe('前文 😀识别假设与原文证据 后文');
        expect(anchor.end - anchor.start).toBe(anchor.exact.length);
        expect(resolveAnchor(root, { anchor }, 'revision-a')?.toString()).toBe(anchor.exact);
    });

    it('rejects a coincidental offset hit when surrounding context belongs elsewhere', () => {
        const root = content('<p>开头 共同结论。 左边</p><p>方法 共同结论。 右边</p>');
        const node = root.querySelectorAll('p')[1].firstChild!;
        const range = document.createRange(); range.setStart(node, 3); range.setEnd(node, 8);
        const anchor = anchorFromRange(root, range, 'revision-a', 'original')!;
        const firstOffset = root.textContent!.indexOf(anchor.exact);
        const stale = { ...anchor, start: firstOffset, end: firstOffset + anchor.exact.length };
        expect(resolveAnchor(root, { anchor: stale }, 'revision-a')?.startContainer).toBe(node);
    });

    it('excludes hidden KaTeX MathML from offsets and tolerates changed layout', () => {
        const root = content('<p>公式 <span class="katex-mathml">hidden-math</span><span>x+y</span> 后文</p>');
        const range = document.createRange(); range.selectNodeContents(root.querySelector('p')!);
        const anchor = anchorFromRange(root, range, 'revision-a', 'original')!;
        expect(anchor.exact).toBe('公式 x+y 后文');
        root.style.fontSize = '24px';
        expect(resolveAnchor(root, { anchor }, 'revision-a')).not.toBeNull();
    });
});
