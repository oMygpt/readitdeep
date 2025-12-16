import React, { useRef, useEffect, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import { SelectionState } from '../types';

interface ZenReaderProps {
  content: string; // HTML/Markdown content
  isZen: boolean;
  onSelection: (sel: SelectionState) => void;
  references?: string[];
}

const ZenReader: React.FC<ZenReaderProps> = ({ content, isZen, onSelection, references = [] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCitation, setHoveredCitation] = useState<{ id: string, x: number, y: number } | null>(null);

  // Extract references from Markdown content if metadata is missing
  const parsedReferences = useMemo(() => {
      if (references && references.length > 0) return references;

      const extractedRefs: string[] = [];
      // 1. Try to find the References section
      // Match Header: # References, **References**, References:, etc.
      const refSectionMatch = content.match(/(?:^|\n)(?:#+\s*|\*\*)?(?:References|Bibliography|参考文献|参考资料)(?:\*\*|:)?\s*[\r\n]+([\s\S]*)$/i);
      
      if (refSectionMatch) {
          const refText = refSectionMatch[1];
          // 2. Parse lines starting with [n]
          // Normalize text to handle wrapping
          const lines = refText.split('\n');
          let currentId: string | null = null;
          
          for (const line of lines) {
              // Match [n] at start of line, optionally preceded by list markers (1. or -)
              const match = line.match(/^\s*(?:(?:\d+\.|-)\s*)?\[(\d+)\]\s+(.*)/);
              if (match) {
                  currentId = match[1];
                  // Ensure array has space
                  extractedRefs[parseInt(currentId) - 1] = match[2].trim();
              } else if (currentId && line.trim()) {
                  // Append continuation lines (simple heuristic)
                  // If line is not a new reference and not empty, append to previous
                  const index = parseInt(currentId) - 1;
                  if (extractedRefs[index]) {
                      extractedRefs[index] += " " + line.trim();
                  }
              }
          }
      }
      return extractedRefs;
  }, [content, references]);

  const processedContent = useMemo(() => {
      let tempContent = content;

      // 1. Inject anchors into the References list (lines starting with [n])
      // We look for patterns like: newline + [1] + space
      tempContent = tempContent.replace(/(\n\s*)\[(\d+)\]/g, (match, prefix, id) => {
          return `${prefix}<span id="ref-${id}" class="reference-anchor text-slate-500 font-mono">[${id}]</span>`;
      });

      // 2. Replace inline citations [n] with superscript links
      // We look for [n] that are NOT preceded by the specific anchor formatting we just added.
      // Or simply, we assume any remaining [n] are citations if they are not part of the anchor tag.
      // Since we replaced the reference list [n] with <span ...>[n]</span>, the regex /\[(\d+)\]/ DOES match inside the span.
      // We need to be careful.
      
      // Let's iterate and replace only if NOT inside a tag. This is hard with regex.
      // Alternative: Use a temporary placeholder for the reference list anchors.
      
      // Reset content
      tempContent = content;
      
      // Replace Reference List items with a unique token
      const placeholders: string[] = [];
      tempContent = tempContent.replace(/(\n\s*)\[(\d+)\]/g, (match, prefix, id) => {
          const token = `__REF_ANCHOR_${id}__`;
          placeholders.push({ token, replacement: `${prefix}<span id="ref-${id}" class="reference-anchor text-slate-500 font-mono">[${id}]</span>` } as any);
          return token;
      });

      // Now replace all other [n] with superscripts
      tempContent = tempContent.replace(/\[(\d+)\]/g, (match, id) => {
          return `<sup class="citation-sup"><a href="#ref-${id}" class="citation-ref text-brand-600 hover:underline cursor-pointer decoration-dotted" data-ref-id="${id}">[${id}]</a></sup>`;
      });

      // Restore reference list items
      placeholders.forEach((p: any) => {
          tempContent = tempContent.replace(p.token, p.replacement);
      });

      return tempContent;
  }, [content]);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      onSelection({
        text: selection.toString(),
        rect: rect
      });
    }
  };

  const handleMouseOver = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('citation-ref')) {
          const id = target.getAttribute('data-ref-id');
          if (id) {
              const rect = target.getBoundingClientRect();
              setHoveredCitation({ id, x: rect.left + rect.width / 2, y: rect.bottom });
          }
      }
  };

  const handleMouseOut = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('citation-ref')) {
          setHoveredCitation(null);
      }
  };

  const getReferenceText = (id: string) => {
      const index = parseInt(id, 10) - 1;
      if (index >= 0 && index < parsedReferences.length && parsedReferences[index]) {
          return parsedReferences[index];
      }
      return `Reference [${id}] not found.`;
  };

  return (
    <div 
      className={`h-full overflow-y-auto no-scrollbar transition-all duration-500 bg-white ${isZen ? 'px-[20%] pt-16' : 'px-0 pt-0'}`}
      onMouseUp={handleMouseUp}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
        {hoveredCitation && (
            <div 
                className="fixed z-50 bg-slate-800 text-white text-xs p-3 rounded shadow-lg max-w-sm pointer-events-none transform -translate-x-1/2 mt-2 animate-fade-in"
                style={{ top: hoveredCitation.y, left: hoveredCitation.x }}
            >
                {getReferenceText(hoveredCitation.id)}
            </div>
        )}
        <style>{`
          .team-highlight {
            background-color: rgba(253, 224, 71, 0.3);
            border-bottom: 2px solid #eab308;
            cursor: pointer;
            position: relative;
            transition: all 0.2s;
          }
          .team-highlight:hover {
            background-color: rgba(253, 224, 71, 0.6);
          }
          .team-highlight::after {
            content: attr(data-author) ": " attr(data-comment);
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%) translateY(-8px);
            background: #1e293b;
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            z-index: 50;
          }
          .team-highlight:hover::after {
            opacity: 1;
          }
          /* Custom Markdown Styles */
          .markdown-content h1 { font-size: 2.25rem; font-weight: 700; margin-bottom: 1.5rem; margin-top: 2rem; color: #1e293b; }
          .markdown-content h2 { font-size: 1.75rem; font-weight: 600; margin-bottom: 1rem; margin-top: 1.5rem; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
          .markdown-content h3 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; margin-top: 1.25rem; color: #475569; }
          .markdown-content p { margin-bottom: 1rem; line-height: 1.75; color: #334155; }
          .markdown-content ul, .markdown-content ol { margin-bottom: 1rem; padding-left: 1.5rem; }
          .markdown-content li { margin-bottom: 0.5rem; }
          .markdown-content code { background-color: #f1f5f9; padding: 0.2rem 0.4rem; rounded: 0.25rem; font-family: monospace; font-size: 0.875em; color: #ef4444; }
          .markdown-content pre { background-color: #1e293b; padding: 1rem; rounded: 0.5rem; overflow-x: auto; margin-bottom: 1.5rem; }
          .markdown-content pre code { background-color: transparent; color: #e2e8f0; padding: 0; }
          .markdown-content blockquote { border-left: 4px solid #cbd5e1; padding-left: 1rem; font-style: italic; color: #64748b; margin-bottom: 1.5rem; }
          .markdown-content table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
          .markdown-content th, .markdown-content td { border: 1px solid #e2e8f0; padding: 0.75rem; text-align: left; }
          .markdown-content th { background-color: #f8fafc; font-weight: 600; }
          .katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.5rem 0; }
        `}</style>
      <article className={`prose prose-slate prose-headings:font-serif lg:prose-lg max-w-none pb-32 markdown-content ${isZen ? '' : 'px-12 py-8'}`}>
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, rehypeRaw]}
            components={{
                img: ({node, ...props}) => <img {...props} className="rounded-lg shadow-md max-w-full mx-auto my-4" loading="lazy" />
            }}
        >
            {processedContent}
        </ReactMarkdown>
      </article>
    </div>
  );
};

export default ZenReader;
