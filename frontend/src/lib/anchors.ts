/** UTF-16 ranges over visible text nodes, scoped to an immutable revision. */
export interface TextAnchor {
    revision_id: string;
    representation: 'original' | 'translation';
    exact: string;
    prefix: string;
    suffix: string;
    start: number;
    end: number;
}

function textNodes(container: HTMLElement): Text[] {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement?.closest('script, style, .katex-mathml')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    return nodes;
}

export function captureAnchor(
    container: HTMLElement, selection: Selection, revisionId: string,
    representation: TextAnchor['representation'],
): TextAnchor | null {
    if (!selection.rangeCount || !revisionId) return null;
    return anchorFromRange(container, selection.getRangeAt(0), revisionId, representation);
}

export function anchorFromRange(container: HTMLElement, range: Range, revisionId: string,
    representation: TextAnchor['representation']): TextAnchor | null {
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
    const nodes = textNodes(container);
    const allText = nodes.map(node => node.data).join('');
    let offset = 0;
    let start = -1;
    let end = -1;
    for (const node of nodes) {
        if (range.intersectsNode(node) && range.comparePoint(node, node.length) >= 0 && range.comparePoint(node, 0) <= 0) {
            const localStart = range.startContainer === node ? range.startOffset : 0;
            const localEnd = range.endContainer === node ? range.endOffset : node.length;
            if (localEnd > localStart) {
                if (start < 0) start = offset + localStart;
                end = offset + localEnd;
            }
        }
        offset += node.length;
    }
    if (start < 0 || end <= start) return null;
    return {
        revision_id: revisionId, representation, start, end,
        exact: allText.slice(start, end), prefix: allText.slice(Math.max(0, start - 48), start),
        suffix: allText.slice(end, end + 48),
    };
}

export function resolveAnchor(
    container: HTMLElement, item: { anchor?: TextAnchor | null; selected_text?: string },
    revisionId?: string,
): Range | null {
    const nodes = textNodes(container);
    const text = nodes.map(node => node.data).join('');
    const anchor = item.anchor;
    const quote = anchor?.exact || item.selected_text || '';
    if (!quote || (anchor && anchor.revision_id !== revisionId)) return null;
    let start = -1;
    if (anchor && text.slice(anchor.start, anchor.end) === quote
        && text.slice(Math.max(0, anchor.start - anchor.prefix.length), anchor.start) === anchor.prefix
        && text.slice(anchor.end, anchor.end + anchor.suffix.length) === anchor.suffix) {
        start = anchor.start;
    } else {
        // A quote-only legacy item may resolve only when it has one exact match.
        const candidates: number[] = [];
        let index = text.indexOf(quote);
        while (index !== -1) {
            if (!anchor || (text.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix
                && text.slice(index + quote.length, index + quote.length + anchor.suffix.length) === anchor.suffix)) {
                candidates.push(index);
            }
            index = text.indexOf(quote, index + 1);
        }
        if (candidates.length !== 1) return null;
        start = candidates[0];
    }
    const range = document.createRange();
    let offset = 0;
    let started = false;
    for (const node of nodes) {
        if (!started && start < offset + node.length) {
            range.setStart(node, start - offset);
            started = true;
        }
        if (started && start + quote.length <= offset + node.length) {
            range.setEnd(node, start + quote.length - offset);
            return range;
        }
        offset += node.length;
    }
    return null;
}
