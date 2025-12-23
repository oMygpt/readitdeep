/**
 * Read it DEEP - 阅读器页面 (Refined UI)
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    Loader2,
    BookOpen,
    Languages,
    Type,
    Minimize2,
    Maximize2,
    ChevronLeft,
    PanelLeftClose,
    PanelLeft,
    PanelRightClose,
    PanelRight,
    Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { papersApi } from '../lib/api';
import type { TextLocation } from '../lib/api';
import AnalysisPanel from '../components/AnalysisPanel';
import StructurePanel from '../components/StructurePanel';
import PaperGraph from '../components/PaperGraph';
import Workbench from '../components/Workbench';
import ExploreOverview from '../components/ExploreOverview';
import SmartSelectionPopup from '../components/SmartSelectionPopup';

import 'katex/dist/katex.min.css';

export default function ReaderPage() {
    const { paperId } = useParams<{ paperId: string }>();
    const navigate = useNavigate();
    const [isZen, setIsZen] = useState(false);
    const [paperFormat, setPaperFormat] = useState<'standard' | 'acm' | 'lncs'>('standard');
    const [fontSize, setFontSize] = useState<number>(1.2); // Default larger size (approx 19.2px)
    const [isTranslated, setIsTranslated] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translatedContent, setTranslatedContent] = useState<string | null>(null);
    const [translationProgress, setTranslationProgress] = useState<string>('');
    const [showSettings, setShowSettings] = useState(false); // New State for Aa menu
    const [hoveredCitation, setHoveredCitation] = useState<{ id: string, x: number, y: number } | null>(null);
    const [showLeftSidebar, setShowLeftSidebar] = useState(true); // Left sidebar visibility
    const [showRightSidebar, setShowRightSidebar] = useState(true); // Right sidebar (Workbench) - auto open
    const [sidebarTab, setSidebarTab] = useState<'analysis' | 'graph' | 'structure'>('structure'); // Sidebar tab - 默认显示目录结构
    const [viewMode, setViewMode] = useState<'overview' | 'read'>('overview'); // Explore vs Read mode
    const mainContentRef = useRef<HTMLElement>(null);

    // Smart Selection State
    const [selectedText, setSelectedText] = useState<string>('');
    const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
    const [selectionLocation, setSelectionLocation] = useState<TextLocation | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0);

    const { data: paper, isLoading: isPaperLoading } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId!),
        enabled: !!paperId,
    });

    const { data: contentData, isLoading: isContentLoading, error } = useQuery({
        queryKey: ['paper-content', paperId],
        queryFn: () => papersApi.getContent(paperId!),
        enabled: !!paperId && (paper?.status === 'completed' || paper?.status === 'analyzed'),
    });

    // Check for existing translation on load
    useEffect(() => {
        if (paperId && paper?.translated_content && !translatedContent) {
            setTranslatedContent(paper.translated_content);
        }
    }, [paperId, paper?.translated_content, translatedContent]);

    // Handle translation - triggers background task, optionally connects SSE
    const handleTranslate = async () => {
        if (isTranslating) return;

        if (translatedContent) {
            // Toggle between original and translated
            setIsTranslated(prev => !prev);
            return;
        }

        // First trigger background translation task
        setIsTranslating(true);
        setTranslationProgress('启动翻译...');

        try {
            const triggerRes = await fetch(`/api/v1/papers/${paperId}/translate`, { method: 'POST' });
            const triggerData = await triggerRes.json();

            if (!triggerData.success && triggerData.status !== 'translating' && triggerData.status !== 'completed') {
                setIsTranslating(false);
                setTranslationProgress(triggerData.message || '启动失败');
                return;
            }

            // If already completed, just fetch the result
            if (triggerData.status === 'completed') {
                const res = await fetch(`/api/v1/papers/${paperId}/translation`);
                const data = await res.json();
                if (data.translated_content) {
                    setTranslatedContent(data.translated_content);
                    setIsTranslated(true);
                }
                setIsTranslating(false);
                setTranslationProgress('');
                return;
            }

            // Connect SSE for live progress (optional - task continues in background)
            setTranslationProgress('连接翻译流...');
            const eventSource = new EventSource(`/api/v1/papers/${paperId}/translate/stream`);
            let buffer = '';

            eventSource.onmessage = (event) => {
                const data = event.data;

                if (data.startsWith('[START]')) {
                    setTranslationProgress(data.replace('[START] ', ''));
                } else if (data.startsWith('[PROGRESS]')) {
                    setTranslationProgress(data.replace('[PROGRESS] ', ''));
                } else if (data === '[DONE]' || data === '[ALREADY_DONE]') {
                    eventSource.close();
                    // Fetch final result
                    fetch(`/api/v1/papers/${paperId}/translation`)
                        .then(res => res.json())
                        .then(result => {
                            if (result.translated_content) {
                                setTranslatedContent(result.translated_content);
                                setIsTranslated(true);
                            }
                        });
                    setIsTranslating(false);
                    setTranslationProgress('');
                } else if (data.startsWith('[ERROR]')) {
                    eventSource.close();
                    setIsTranslating(false);
                    setTranslationProgress('翻译失败');
                    console.error(data);
                } else {
                    // Unescape newlines and append
                    buffer += data.replace(/\\n/g, '\n');
                }
            };

            eventSource.onerror = () => {
                eventSource.close();
                // SSE disconnected but task continues in background
                // Start polling for status
                setTranslationProgress('翻译进行中 (后台)...');
                pollTranslationStatus();
            };
        } catch (error) {
            console.error('Translation trigger failed:', error);
            setIsTranslating(false);
            setTranslationProgress('启动失败');
        }
    };

    // Poll for translation status (when SSE disconnects)
    const pollTranslationStatus = async () => {
        const checkStatus = async () => {
            try {
                const res = await fetch(`/api/v1/papers/${paperId}/translation`);
                const data = await res.json();

                if (data.status === 'completed' && data.translated_content) {
                    setTranslatedContent(data.translated_content);
                    setIsTranslated(true);
                    setIsTranslating(false);
                    setTranslationProgress('');
                    return true; // Done
                } else if (data.status === 'failed') {
                    setIsTranslating(false);
                    setTranslationProgress(`翻译失败: ${data.error || '未知错误'}`);
                    return true; // Done (failed)
                } else if (data.status === 'translating') {
                    setTranslationProgress(`翻译中 ${data.progress}% (${data.chunks_done}/${data.chunks_total})`);
                    return false; // Continue polling
                }
                return false;
            } catch {
                return false;
            }
        };

        // Poll every 2 seconds
        const poll = async () => {
            const done = await checkStatus();
            if (!done) {
                setTimeout(poll, 2000);
            }
        };
        poll();
    };



    // Use translated content if available and toggled, otherwise original
    const content = (isTranslated && translatedContent) ? translatedContent : (contentData?.markdown || '');

    // Extract references logic - supports both numbered [1] and author-year format
    const { parsedReferences, authorYearIndex } = useMemo(() => {
        if (!content) return { parsedReferences: [] as string[], authorYearIndex: new Map<string, number>() };

        const extractedRefs: string[] = [];
        const ayIndex = new Map<string, number>(); // Maps "author_year" -> index

        // Support Chinese "参考文献" and various colon formats
        const refSectionMatch = content.match(/(?:^|\n)(?:#+\s*|\*\*)?(?:References|Bibliography|参考文献|参考资料)(?:\*\*|:|：)?\s*[\r\n]+([\s\S]*)$/i);

        if (refSectionMatch) {
            const refText = refSectionMatch[1];
            const lines = refText.split('\n');
            let currentId: string | null = null;
            let currentRefIndex = 0;
            let currentRefText = '';

            // Helper: extract author key from reference text for author-year format
            const extractAuthorKey = (text: string): string[] => {
                const keys: string[] = [];

                // Pattern 1: "Lastname, F." or "Lastname, Firstname" at start
                const match1 = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s/);
                if (match1) {
                    keys.push(match1[1].toLowerCase());
                }

                // Pattern 2: Multiple authors - extract first author for "et al." matching
                const etAlMatch = text.match(/^([A-Z][a-z]+)/);
                if (etAlMatch) {
                    keys.push(etAlMatch[1].toLowerCase());
                }

                // Pattern 3: Organization name like "OpenAI"
                const orgMatch = text.match(/^([A-Z][A-Za-z]+)\s*[\.,\(]/);
                if (orgMatch) {
                    keys.push(orgMatch[1].toLowerCase());
                }

                return keys;
            };

            // Helper: extract year from reference text
            const extractYear = (text: string): string | null => {
                // Common patterns: (2023), 2023., (2023a), 2023,
                const yearMatch = text.match(/[\(\s,]?((?:19|20)\d{2}[a-z]?)[\)\.,\s]/);
                return yearMatch ? yearMatch[1] : null;
            };

            // Helper: register author-year mapping
            const registerAuthorYear = (refIndex: number, text: string) => {
                const authors = extractAuthorKey(text);
                const year = extractYear(text);

                if (year) {
                    authors.forEach(author => {
                        const key = `${author}_${year}`.toLowerCase();
                        if (!ayIndex.has(key)) {
                            ayIndex.set(key, refIndex);
                        }
                    });
                }
            };

            for (const line of lines) {
                // Pattern 1: Numbered format - [1] Author...
                const numberedMatch = line.match(/^\s*(?:(?:\d+\.|-)\s*)?\[(\d+)\]\s+(.*)/);
                if (numberedMatch) {
                    // Save previous reference if exists
                    if (currentId && currentRefText) {
                        registerAuthorYear(parseInt(currentId) - 1, currentRefText);
                    }

                    currentId = numberedMatch[1];
                    currentRefText = numberedMatch[2].trim();
                    extractedRefs[parseInt(numberedMatch[1]) - 1] = currentRefText;
                    continue;
                }

                // Pattern 2: Author-year format - "Lastname, F., ... (2023). Title..."
                // Detect new reference entry (starts with author name)
                const authorStartMatch = line.match(/^([A-Z][a-z]+,?\s+[A-Z]\.?|[A-Z][A-Za-z]+\s+\()/);
                if (authorStartMatch && !line.match(/^\s+/)) {
                    // Save previous reference if exists
                    if (currentRefText) {
                        extractedRefs[currentRefIndex] = currentRefText;
                        registerAuthorYear(currentRefIndex, currentRefText);
                        currentRefIndex++;
                    }
                    currentId = null; // Not numbered
                    currentRefText = line.trim();
                    continue;
                }

                // Continuation line
                if (line.trim()) {
                    if (currentId) {
                        // Numbered format continuation
                        const index = parseInt(currentId) - 1;
                        if (extractedRefs[index]) {
                            extractedRefs[index] += " " + line.trim();
                            currentRefText = extractedRefs[index];
                        }
                    } else if (currentRefText) {
                        // Author-year format continuation
                        currentRefText += " " + line.trim();
                    }
                }
            }

            // Don't forget the last entry
            if (currentRefText) {
                if (currentId) {
                    registerAuthorYear(parseInt(currentId) - 1, currentRefText);
                } else {
                    extractedRefs[currentRefIndex] = currentRefText;
                    registerAuthorYear(currentRefIndex, currentRefText);
                }
            }
        }

        return { parsedReferences: extractedRefs, authorYearIndex: ayIndex };
    }, [content]);

    // Extract Paper Structure (Front Matter, Abstract, Body)
    const { extractedAbstract, extractedTitle, extractedAuthors, extractedAffiliations, cleanBodyContent } = useMemo(() => {
        if (!content) return { extractedAbstract: null, extractedTitle: null, extractedAuthors: [], extractedAffiliations: [], cleanBodyContent: '' };

        let remainingContent = content;
        let title: string | null = null;
        let authors: string[] = [];
        let affiliations: string[] = [];
        let abstract: string | null = null;

        // 1. Robust Abstract Extraction (Inline or Block)
        // Matches "Abstract", "Abstract:", "Abstract—", "Heading Abstract", etc.
        // Captures content until double newline or next heading.
        const abstractMatch = remainingContent.match(/(?:^|\n)(?:#+\s*|\*\*)?(?:Abstract|摘要)(?:\*\*|:|—|\.|：)?\s*(?:[\r\n]+)?([\s\S]*?)(?:(?:\r?\n){2,}|\n(?=#))/i);

        if (abstractMatch) {
            abstract = abstractMatch[1].trim();

            // Identify where the Body starts (after the abstract block)
            const abstractEndIndex = (abstractMatch.index || 0) + abstractMatch[0].length;

            // HEURISTIC SAFETY CHECK:
            // If the "Abstract" we found is more than 30% of the entire content, 
            // it's likely the regex matched the entire document. Abort extraction.
            if (abstractEndIndex > remainingContent.length * 0.3) {
                console.warn("Abstract extraction matched > 30% of content. Aborting to preserve body.");
                // Treat as failed extraction -> Fallback to raw content
                return {
                    extractedAbstract: null,
                    extractedTitle: null,
                    extractedAuthors: [],
                    extractedAffiliations: [],
                    cleanBodyContent: content
                };
            }

            // Front Matter is everything BEFORE the abstract
            const frontMatterBlob = remainingContent.substring(0, abstractMatch.index).trim();
            const lines = frontMatterBlob.split('\n').map((l: string) => l.trim()).filter((l: string) => l);

            // Parse Front Matter
            const titleLineIdx = lines.findIndex((l: string) => l.startsWith('#'));
            if (titleLineIdx !== -1) {
                title = lines[titleLineIdx].replace(/^#+\s*/, '').trim();
                const remainingLines = lines.slice(titleLineIdx + 1);
                if (remainingLines.length > 0) {
                    authors = [remainingLines[0]];
                    affiliations = remainingLines.slice(1);
                }
            } else if (lines.length > 0) {
                // Assume first line is title if no header syntax
                title = lines[0];
                const remainingLines = lines.slice(1);
                if (remainingLines.length > 0) {
                    authors = [remainingLines[0]];
                    affiliations = remainingLines.slice(1);
                }
            }

            // Clean Body: Remove Front Matter AND Abstract
            remainingContent = remainingContent.substring(abstractEndIndex).trim();

            console.log("DEBUG: Abstract Found");
            console.log("Match Index:", abstractMatch.index);
            console.log("Match Length:", abstractMatch[0].length);
            console.log("Abstract Content:", abstract);
            console.log("Remaining Length:", remainingContent.length);

        } else {
            console.log("DEBUG: Initial content length:", content.length);
            console.log("DEBUG: No Abstract Match Found - Proceeding to Title Strip");
            // 2. Fallback: No Abstract Found -> Manually Strip Title
            // If the content starts with a Header 1, treat it as Title and remove it
            const titleMatch = remainingContent.match(/^\s*(#+)\s+(.*?)(\r?\n|$)/);
            if (titleMatch) {
                title = titleMatch[2].trim();
                // Remove the title line from body
                remainingContent = remainingContent.replace(/^\s*(#+)\s+(.*?)(\r?\n|$)/, '').trim();
                console.log("DEBUG: Title Stripped, Remaining Length:", remainingContent.length);

                // Try to identify and remove Authors immediately following title
                // Heuristic: If next lines are short and don't look like headings/body, strip them
                // For now, let's minimally strip the title to solve the main duplication complaint.
            } else {
                console.log("DEBUG: No Title Match either.");
            }
        }

        // Safety Check: If body is suspiciously empty, fallback to raw content
        // UPDATED: Check if extraction resulted in empty body OR if we just want to be safe
        if (!remainingContent || remainingContent.length < 100) {
            console.warn("Body extraction failed or too short, falling back to full content.");
            // Try to just strip the title if possible
            const titleMatch = content.match(/^\s*(#+)\s+(.*?)(\r?\n|$)/);
            if (titleMatch) {
                return {
                    extractedAbstract: abstract || null, // Keep abstract if found
                    extractedTitle: title || titleMatch[2].trim(),
                    extractedAuthors: authors,
                    extractedAffiliations: affiliations,
                    cleanBodyContent: content.replace(/^\s*(#+)\s+(.*?)(\r?\n|$)/, '').trim()
                };
            }
            return {
                extractedAbstract: abstract || null,
                extractedTitle: title || null,
                extractedAuthors: authors,
                extractedAffiliations: affiliations,
                cleanBodyContent: content
            };
        }

        return {
            extractedAbstract: abstract,
            extractedTitle: title,
            extractedAuthors: authors,
            extractedAffiliations: affiliations,
            cleanBodyContent: remainingContent
        };
    }, [content]);

    // USE BACKEND SUMMARY IF EXTRACTION FAILS
    const finalAbstract = extractedAbstract || paper?.summary;


    // Process content for citations (applied to the CLEAN body content)
    const processedContent = useMemo(() => {
        // Safety: If cleanBodyContent is empty, return simple message or empty string
        if (!cleanBodyContent) return '*(No content to display)*';

        let tempContent = cleanBodyContent;

        // Helper function to create citation link
        const createCitationLink = (author: string, year: string, displayText: string): string => {
            const key = `${author.toLowerCase().replace(/\s+/g, '')}_${year}`;
            const refIndex = authorYearIndex.get(key);

            if (refIndex !== undefined) {
                // Found matching reference
                return `<span class="citation-ref author-year-citation text-indigo-600 hover:underline cursor-pointer" data-ref-id="${refIndex + 1}" data-author="${author}" data-year="${year}">${displayText}</span>`;
            }
            // No match found, return as-is but still styled
            return `<span class="citation-ref author-year-citation text-indigo-500/70" data-author="${author}" data-year="${year}">${displayText}</span>`;
        };

        try {
            // Replace anchors - Reference entries at start of line: [1] Author...
            tempContent = tempContent.replace(/(^|\n)\s*\[(\d+)\]/g, (_match: string, prefix: string, id: string) => {
                return `${prefix}<span id="ref-${id}" class="reference-anchor text-slate-400 font-mono text-sm">[${id}]</span>`;
            });

            // Also add anchors for author-year format references in References section
            // Match: "Author, F. ... (2023)" at start of line in References section
            const refSectionStart = tempContent.search(/(?:^|\n)(?:#+\s*|\*\*)?(?:References|Bibliography|参考文献|参考资料)/i);
            if (refSectionStart !== -1) {
                const beforeRefs = tempContent.substring(0, refSectionStart);
                let refsSection = tempContent.substring(refSectionStart);

                // Add anchors to author-year format entries
                let ayRefIndex = 0;
                refsSection = refsSection.replace(
                    /(\n)([A-Z][a-z]+(?:,\s*[A-Z]\.?|\s+[A-Z]\.?)[^(]*\((?:19|20)\d{2}[a-z]?\))/g,
                    (_match: string, prefix: string, entry: string) => {
                        ayRefIndex++;
                        return `${prefix}<span id="ref-ay-${ayRefIndex}" class="reference-entry-anchor">${entry}</span>`;
                    }
                );
                tempContent = beforeRefs + refsSection;
            }

            // Use placeholders to protect anchors
            const placeholders: { token: string; replacement: string }[] = [];
            tempContent = tempContent.replace(/<span id="ref-[^"]*"[^>]*>[^<]*<\/span>/g, (match: string) => {
                const token = `__REF_ANCHOR_PROTECTED_${placeholders.length}__`;
                placeholders.push({ token, replacement: match });
                return token;
            });

            // Replace LaTeX superscript citations: $^{1;2;3}$ or $^{1,2,3}$ or $^{1}$
            tempContent = tempContent.replace(/\$\^{([0-9;,\s]+)}\$/g, (_match: string, ids: string) => {
                const idList = ids.split(/[;,]/).map(s => s.trim()).filter(s => s);
                const links = idList.map(id =>
                    `<span class="citation-ref text-indigo-600 hover:underline cursor-pointer font-bold" data-ref-id="${id}">${id}</span>`
                ).join(';');
                return `<sup class="citation-sup">[${links}]</sup>`;
            });

            // Replace inline citations - Multiple citations format: [31, 30] or [27, 60, 64]
            tempContent = tempContent.replace(/\[(\d+(?:\s*[,;]\s*\d+)+)\]/g, (_match: string, ids: string) => {
                const idList = ids.split(/[,;]/).map(s => s.trim()).filter(s => s);
                const links = idList.map(id =>
                    `<span class="citation-ref text-indigo-600 hover:underline cursor-pointer font-bold" data-ref-id="${id}">${id}</span>`
                ).join(', ');
                return `<sup class="citation-sup">[${links}]</sup>`;
            });

            // Replace inline citations - Standard [1] format (single number)
            tempContent = tempContent.replace(/\[(\d+)\]/g, (_match: string, id: string) => {
                return `<sup class="citation-sup"><span class="citation-ref text-indigo-600 hover:underline cursor-pointer font-bold" data-ref-id="${id}">[${id}]</span></sup>`;
            });

            // === AUTHOR-YEAR CITATION FORMAT SUPPORT ===

            // Pattern 1: Parenthetical with multiple citations separated by semicolons
            // e.g., (Chowdhery et al., 2023; OpenAI, 2023)
            tempContent = tempContent.replace(
                /\(([A-Z][a-z]+(?:\s+et\s+al\.?)?(?:,\s*|\s+)\d{4}[a-z]?(?:\s*;\s*[A-Z][a-z]+(?:\s+et\s+al\.?)?(?:,\s*|\s+)\d{4}[a-z]?)*)\)/g,
                (_match: string, content: string) => {
                    // Split by semicolon
                    const citations = content.split(/\s*;\s*/);
                    const links = citations.map((citation: string) => {
                        // Extract author and year
                        const citMatch = citation.match(/([A-Z][a-z]+(?:\s+et\s+al\.?)?)\s*,?\s*(\d{4}[a-z]?)/);
                        if (citMatch) {
                            const [, author, year] = citMatch;
                            const authorKey = author.replace(/\s+et\s+al\.?/i, '').trim();
                            return createCitationLink(authorKey, year, citation.trim());
                        }
                        return citation;
                    }).join('; ');
                    return `(${links})`;
                }
            );

            // Pattern 2: In-text citation: "Author et al. (2023)" or "Author (2023)"
            // e.g., "Wei et al. (2022)" or "OpenAI (2023)"
            tempContent = tempContent.replace(
                /([A-Z][a-z]+(?:\s+et\s+al\.)?\s*)\((\d{4}[a-z]?)\)/g,
                (match: string, author: string, year: string) => {
                    const authorKey = author.replace(/\s+et\s+al\.?/i, '').trim();
                    return createCitationLink(authorKey, year, match);
                }
            );

            // Pattern 3: Product/Model name followed by citation in parentheses
            // e.g., "Qwen3 (Yang et al., 2025a)" or "Llama3 (Dubey et al., 2024)"
            // This matches: Word/Number + space + (Author et al., Year)
            tempContent = tempContent.replace(
                /([A-Z][A-Za-z0-9-]+)\s+\(([A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*\d{4}[a-z]?)\)/g,
                (match: string, productName: string, citationContent: string) => {
                    // Don't process if already processed (check for span tag)
                    if (match.includes('<span')) return match;

                    // Extract author and year from citation
                    const citMatch = citationContent.match(/([A-Z][a-z]+(?:\s+et\s+al\.?)?)\s*,?\s*(\d{4}[a-z]?)/);
                    if (citMatch) {
                        const [, author, year] = citMatch;
                        const authorKey = author.replace(/\s+et\s+al\.?/i, '').trim();
                        const citationLink = createCitationLink(authorKey, year, `(${citationContent})`);
                        return `${productName} ${citationLink}`;
                    }
                    return match;
                }
            );

            // Restore anchors
            placeholders.forEach((p) => {
                tempContent = tempContent.replace(p.token, p.replacement);
            });
        } catch (e) {
            console.error("Content processing failed", e);
            return cleanBodyContent; // Fallback to raw content
        }

        return tempContent || cleanBodyContent;
    }, [cleanBodyContent, authorYearIndex]);

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

    const handleCitationClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('citation-ref')) {
            const id = target.getAttribute('data-ref-id');
            const author = target.getAttribute('data-author');
            const year = target.getAttribute('data-year');

            let refElement: HTMLElement | null = null;

            // First try: direct ref-id lookup
            if (id) {
                refElement = document.getElementById(`ref-${id}`);
            }

            // Second try: search for author-year anchor
            if (!refElement && author && year) {
                // Try author-year format anchors
                const ayAnchors = document.querySelectorAll('[id^="ref-ay-"]');
                for (const anchor of ayAnchors) {
                    const text = anchor.textContent?.toLowerCase() || '';
                    if (text.includes(author.toLowerCase()) && text.includes(year)) {
                        refElement = anchor as HTMLElement;
                        break;
                    }
                }

                // Third try: search in references section text
                if (!refElement && mainContentRef.current) {
                    const refSection = mainContentRef.current.querySelector('.reference-section, [id*="reference"], h2:has(+ p)');
                    if (refSection) {
                        const paragraphs = refSection.parentElement?.querySelectorAll('p') || [];
                        for (const p of paragraphs) {
                            const text = p.textContent?.toLowerCase() || '';
                            if (text.includes(author.toLowerCase()) && text.includes(year)) {
                                refElement = p as HTMLElement;
                                break;
                            }
                        }
                    }
                }
            }

            if (refElement) {
                refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Highlight effect
                const parent = refElement.closest('p') || refElement.parentElement || refElement;
                parent.classList.add('highlight-ref');
                setTimeout(() => {
                    parent.classList.remove('highlight-ref');
                }, 2000);
            }
        }
    };

    const getReferenceText = (id: string) => {
        const index = parseInt(id, 10) - 1;
        return parsedReferences[index] || `Reference [${id}] not found.`;
    };

    // Handle jump to line from AnalysisPanel
    const handleJumpToLine = (location: TextLocation) => {
        if (!mainContentRef.current) return;

        let targetElement: Element | null = null;

        // Strategy 1: Try to find by text snippet (most reliable)
        if (location.text_snippet) {
            const allElements = mainContentRef.current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, span');
            const snippet = location.text_snippet.trim();

            // Try exact match first
            for (const el of allElements) {
                const text = el.textContent || '';
                if (text.includes(snippet)) {
                    targetElement = el;
                    break;
                }
            }

            // Try partial match (first 50 chars)
            if (!targetElement && snippet.length > 50) {
                const partialSnippet = snippet.substring(0, 50);
                for (const el of allElements) {
                    const text = el.textContent || '';
                    if (text.includes(partialSnippet)) {
                        targetElement = el;
                        break;
                    }
                }
            }

            // Try normalized match (remove extra whitespace)
            if (!targetElement) {
                const normalizedSnippet = snippet.replace(/\s+/g, ' ').toLowerCase().substring(0, 40);
                for (const el of allElements) {
                    const normalizedText = (el.textContent || '').replace(/\s+/g, ' ').toLowerCase();
                    if (normalizedText.includes(normalizedSnippet)) {
                        targetElement = el;
                        break;
                    }
                }
            }
        }

        // Strategy 2: Try to find by line number (if data-line exists)
        if (!targetElement) {
            const lines = mainContentRef.current.querySelectorAll('[data-line]');
            for (const el of lines) {
                const lineNum = parseInt(el.getAttribute('data-line') || '0', 10);
                if (lineNum >= location.start_line && lineNum <= location.end_line) {
                    targetElement = el;
                    break;
                }
            }
        }

        // Strategy 3: Try to find heading by title keywords
        if (!targetElement && location.text_snippet) {
            const headings = mainContentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
            const keywords = location.text_snippet.split(/\s+/).slice(0, 3).join('');
            for (const el of headings) {
                const text = (el.textContent || '').toLowerCase();
                if (text.includes(keywords.toLowerCase())) {
                    targetElement = el;
                    break;
                }
            }
        }

        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('highlight-ref');
            setTimeout(() => {
                targetElement?.classList.remove('highlight-ref');
            }, 2000);
        } else {
            console.warn('Could not find location:', location);
        }
    };

    // Keyboard Shortcut 'P' for Zen Mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'p' || e.key === 'P') {
                setIsZen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Text Selection Detection for Smart Popup
    useEffect(() => {
        const computeTextLocation = (selection: Selection): TextLocation | null => {
            if (selection.rangeCount === 0) return null;
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;

            // Try to find context
            let node: Node | null = container;
            let startLine = 0;
            // Traverse up to find context
            while (node && node !== mainContentRef.current) {
                if (node instanceof HTMLElement) {
                    // Check for data-line (if lines are marked)
                    if (node.hasAttribute('data-line')) {
                        startLine = parseInt(node.getAttribute('data-line') || '0', 10);
                    }
                }
                node = node.parentNode;
            }

            // If we didn't find specific line, maybe we can default to something
            // For now, just return what we found plus the text snippet
            return {
                start_line: startLine,
                end_line: startLine, // Single line for now unless we iterate range
                text_snippet: selection.toString().substring(0, 100),
                // We might want to extend TextLocation interface if needed, but for now strict to API types or just pass as snippet
            };
        };

        const handleMouseUp = (e: MouseEvent) => {
            // Don't trigger if clicking inside the popup
            if ((e.target as HTMLElement).closest('.smart-selection-popup')) return;

            // Don't show popup if user is dragging
            if (isDragging) return;

            // Only trigger for selections within the main content area (not sidebars)
            if (!mainContentRef.current?.contains(e.target as Node)) return;

            const selection = window.getSelection();
            const text = selection?.toString().trim();

            if (text && text.length > 10) {
                const range = selection?.getRangeAt(0);
                const rect = range?.getBoundingClientRect();
                const location = selection ? computeTextLocation(selection) : null;

                if (rect) {
                    setSelectedText(text);
                    setSelectionPosition({
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                    });
                    setSelectionLocation(location);
                }
            } else {
                // Delay clearing to allow clicking popup buttons
                setTimeout(() => {
                    const popupExists = document.querySelector('.smart-selection-popup');
                    if (!popupExists) {
                        setSelectedText('');
                        setSelectionPosition(null);
                        setSelectionLocation(null);
                    }
                }, 100);
            }
        };

        const handleDragStart = () => {
            // Hide popup when dragging starts
            setIsDragging(true);
            setSelectedText('');
            setSelectionPosition(null);
            setSelectionLocation(null);
        };

        const handleDragEnd = () => {
            // Re-enable popup after drag ends
            setIsDragging(false);
        };

        // Auto-close popup when clicking to start a new selection
        const handleMouseDown = (e: MouseEvent) => {
            // Don't close if clicking inside the popup
            if ((e.target as HTMLElement).closest('.smart-selection-popup')) return;

            // If popup is showing and clicking in content area, close it
            if (selectionPosition && mainContentRef.current?.contains(e.target as Node)) {
                setSelectedText('');
                setSelectionPosition(null);
                setSelectionLocation(null);
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('dragend', handleDragEnd);

        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('dragstart', handleDragStart);
            document.removeEventListener('dragend', handleDragEnd);
        };
    }, [isDragging, selectionPosition]);

    const isLoading = isPaperLoading || isContentLoading;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-50">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex justify-center h-screen items-center bg-slate-50">
                <div className="text-red-500 bg-white p-4 rounded shadow">Error: {(error as Error).message}</div>
            </div>
        );
    }

    if (!paper) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
                <BookOpen className="w-12 h-12 text-slate-300" />
                <h2 className="text-xl font-medium text-slate-600">Paper not found</h2>
                <button onClick={() => navigate('/library')} className="text-indigo-600 hover:underline">Return to Library</button>
            </div>
        );
    }

    if (paper.status === 'uploading' || paper.status === 'parsing' || paper.status === 'indexing') {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                <div className="text-center">
                    <h2 className="text-xl font-medium text-slate-800">Processing Paper...</h2>
                    <p className="text-slate-500 mt-2">This may take a minute. Please wait.</p>
                </div>
                <button onClick={() => navigate('/library')} className="text-slate-400 hover:text-indigo-600 text-sm mt-4">Go back to Library</button>
            </div>
        );
    }

    if (paper.status === 'failed') {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
                <div className="w-12 h-12 text-red-400 font-bold text-3xl flex items-center justify-center border-2 border-red-200 rounded-full">!</div>
                <h2 className="text-xl font-medium text-slate-800">Parsing Failed</h2>
                <p className="text-slate-500">We couldn't process this paper.</p>
                <button onClick={() => navigate('/library')} className="text-indigo-600 hover:underline">Return to Library</button>
            </div>
        );
    }

    // Dynamic Style Generation based on Format AND Font Size
    const getStyles = () => {
        const commonStyles = `
            .citation-sup { vertical-align: super; font-size: 0.75em; }
            .markdown-content code { font-family: 'Courier New', Courier, monospace; background-color: #f1f5f9; color: #334155; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.85em; }
            .markdown-content pre { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 1.25rem; border-radius: 6px; margin-bottom: 1.5rem; overflow-x: auto; }
            .markdown-content blockquote { border-left: 4px solid #e2e8f0; padding-left: 1rem; font-style: italic; color: #4b5563; margin-bottom: 1.5rem; }
            
            /* Table Styling */
            .markdown-content table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-size: 0.9em; border: 1px solid #e2e8f0; }
            .markdown-content th { background-color: #f8fafc; font-weight: bold; border: 1px solid #cbd5e1; padding: 0.75rem; text-align: left; }
            .markdown-content td { border: 1px solid #e2e8f0; padding: 0.75rem; vertical-align: top; }
            .markdown-content tr:nth-child(even) { background-color: #fcfcfc; }

            /* Highlight Animation */
            @keyframes highlight-fade {
                0% { background-color: rgba(253, 224, 71, 0.5); }
                100% { background-color: transparent; }
            }
            .highlight-ref {
                animation: highlight-fade 2s ease-out forwards;
                border-radius: 4px;
                padding: 2px 4px;
            }
        `;

        if (paperFormat === 'acm') {
            return `
                ${commonStyles}
                .markdown-content { font-family: 'Times New Roman', 'Songti SC', 'SimSun', 'PingFang SC', 'Microsoft YaHei', serif; color: #111827; font-style: normal; }
                .markdown-content h1, .markdown-content h2, .markdown-content h3 { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-weight: bold; color: #000; }
                .markdown-content h1 { font-size: 2.5rem; margin-bottom: 1rem; text-align: left; }
                .markdown-content h2 { font-size: 1.5rem; margin-top: 2rem; margin-bottom: 1rem; text-transform: uppercase; border-bottom: 1px solid #111827; padding-bottom: 0.5rem; }
                .markdown-content h3 { font-size: 1.25rem; margin-top: 1.5rem; margin-bottom: 0.75rem; }
                .markdown-content p { font-size: ${fontSize}rem; line-height: 1.8; text-align: justify; text-justify: inter-ideograph; word-break: break-word; margin-bottom: 1rem; }
                .markdown-content li { font-size: ${fontSize}rem; line-height: 1.8; }
                .markdown-content ul, .markdown-content ol { font-size: ${fontSize}rem; line-height: 1.8; }
                .paper-header { text-align: left; } /* ACM Title Left Aligned usually? Or centered. Let's stick to left for distinction */
                .paper-header h1 { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-weight: bold; font-size: 2.25rem; text-align: left !important; }
                .author-line { font-family: 'Times New Roman', 'Songti SC', 'SimSun', serif; font-size: 1.1rem; text-align: left; }
                .affil-line { font-family: 'Times New Roman', 'Songti SC', 'SimSun', serif; font-style: normal; font-size: 0.9rem; text-align: left; }
                .abstract-box { font-family: 'Times New Roman', 'Songti SC', 'SimSun', serif; font-style: normal; border: none !important; background: transparent !important; padding: 0 !important; margin-bottom: 2rem; }
                .abstract-label { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-weight: bold; font-style: normal; text-transform: uppercase; font-size: 0.9rem; }
            `;
        } else if (paperFormat === 'lncs') {
            return `
                ${commonStyles}
                .markdown-content { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', 'PingFang SC', 'Microsoft YaHei', serif; color: #111827; font-style: normal; }
                 /* LNCS uses bold headings, numbered usually (handled by content or CSS counters if we wanted to go deep) */
                .markdown-content h1, .markdown-content h2, .markdown-content h3 { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', serif; font-weight: bold; }
                .markdown-content h1 { font-size: 2rem; text-align: center; margin-bottom: 2rem; }
                .markdown-content h2 { font-size: 1.4rem; margin-top: 2.5rem; margin-bottom: 1.2rem; }
                .markdown-content h3 { font-size: 1.2rem; margin-top: 2rem; margin-bottom: 1rem; }
                .markdown-content p { font-size: ${fontSize}rem; line-height: 1.8; text-align: justify; text-justify: inter-ideograph; word-break: break-word; margin-bottom: 1.2rem; text-indent: 2em; } /* LNCS Indent */
                .markdown-content li { font-size: ${fontSize}rem; line-height: 1.8; }
                .markdown-content ul, .markdown-content ol { font-size: ${fontSize}rem; line-height: 1.8; }
                .markdown-content p:first-of-type { text-indent: 0; }
                .paper-header { text-align: center; }
                .paper-header h1 { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', serif; font-weight: bold; font-size: 2rem; }
                .author-line { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', serif; font-size: 1.1rem; margin-bottom: 0.5rem; }
                .affil-line { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', serif; font-size: 0.9rem; margin-bottom: 1rem; }
                .abstract-box { font-family: 'Computer Modern', 'Times New Roman', 'Songti SC', 'SimSun', serif; font-size: 0.95rem; font-style: normal; margin: 0 2rem 2rem 2rem; text-align: justify; }
                .abstract-label { font-weight: bold; font-style: normal; }
            `;
        } else {
            // Standard ReaditDeep (Zen) Style
            return `
                ${commonStyles}
                .markdown-content { font-family: 'Merriweather', 'Source Serif 4', 'Times New Roman', serif; color: var(--color-text-dim); font-style: normal; }
                .markdown-content h1 { font-family: 'Merriweather', 'Source Serif 4', serif; font-size: 2.25rem; font-weight: 700; text-align: center; margin-bottom: 2.5rem; line-height: 1.3; color: var(--color-text-main); }
                .markdown-content h2 { font-family: 'Inter', sans-serif; font-size: 1.5rem; font-weight: 600; margin-top: 3rem; margin-bottom: 1.5rem; color: var(--color-text-main); letter-spacing: -0.025em; }
                .markdown-content h3 { font-family: 'Inter', sans-serif; font-size: 1.25rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; color: var(--color-text-dim); }
                .markdown-content p { font-size: ${fontSize}rem; line-height: 1.8; text-align: justify; margin-bottom: 1.5rem; color: var(--color-text-dim); }
                .markdown-content li { font-size: ${fontSize}rem; line-height: 1.8; margin-bottom: 0.5rem; }
                .paper-header h1 { font-family: 'Merriweather', 'Source Serif 4', serif; font-weight: 700; letter-spacing: -0.025em; }
                .abstract-box { position: relative; padding: 2rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 3rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
                .abstract-label { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 0.875rem; color: var(--color-text-muted); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1rem; display: block; }
            `;
        }
    };



    // Explore Overview Mode (show first before reading)
    if (viewMode === 'overview' && paper) {
        return (
            <ExploreOverview
                paperId={paperId!}
                paperTitle={paper.title || paper.filename}
                onStartReading={() => setViewMode('read')}
                onBack={() => navigate('/')}
            />
        );
    }

    return (
        <div className="flex flex-col h-screen bg-background text-content-main font-sans transition-colors duration-500 overflow-hidden relative">
            {/* Dynamic CSS Injection */}
            <style>{getStyles()}</style>

            {/* Top Navigation Toolbar */}
            <header className={`h-16 border-b border-border bg-surface flex items-center justify-between px-6 z-50 transition-all duration-300 shadow-sm ${isZen ? '-translate-y-full mb-[-64px]' : ''}`}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/library')} className="p-2 -ml-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-brand rounded-lg text-primary-content shadow-sm shadow-brand/20">
                            <BookOpen className="w-5 h-5" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-content-main hidden sm:block">Read it Deep</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Translate Toggle (Secondary) */}
                    <button
                        onClick={handleTranslate}
                        disabled={isTranslating}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isTranslated ? 'bg-indigo-50 text-indigo-700' : isTranslating ? 'bg-amber-50 text-amber-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                    >
                        {isTranslating ? (
                            <>
                                <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                                <span className="hidden sm:inline text-xs">{translationProgress || '翻译中...'}</span>
                            </>
                        ) : (
                            <>
                                <Languages className="w-4 h-4" />
                                <span className="hidden sm:inline">{isTranslated ? '原文' : translatedContent ? '中文' : '翻译'}</span>
                            </>
                        )}
                    </button>

                    {/* Appearance Settings "Aa" */}
                    <div className="flex items-center gap-2">
                        {/* Settings Group */}
                        <div className="flex items-center p-1 bg-slate-100/50 rounded-lg border border-slate-200/50">
                            {/* Font Settings */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${showSettings ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'}`}
                                    title="阅读设置"
                                >
                                    <Type className="w-4 h-4" />
                                </button>

                                {/* Settings Popover */}
                                {showSettings && (
                                    <div className="absolute top-full right-0 mt-3 w-72 bg-white rounded-xl shadow-xl border border-slate-100 p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
                                        {/* Format Selector */}
                                        <div className="mb-4">
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Paper Format</label>
                                            <div className="flex bg-slate-100 p-1 rounded-lg">
                                                {['standard', 'acm', 'lncs'].map((fmt) => (
                                                    <button
                                                        key={fmt}
                                                        onClick={() => setPaperFormat(fmt as any)}
                                                        className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${paperFormat === fmt ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        {fmt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Font Size Controls */}
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Font Size</label>
                                            <div className="flex items-center justify-between bg-slate-50 rounded-lg p-2 border border-slate-100">
                                                <button
                                                    onClick={() => setFontSize(prev => Math.max(0.8, prev - 0.1))}
                                                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
                                                >
                                                    <span className="text-xs font-serif font-bold">A-</span>
                                                </button>
                                                <span className="text-xs font-medium text-slate-600">{Math.round(fontSize * 16)}px</span>
                                                <button
                                                    onClick={() => setFontSize(prev => Math.min(2.0, prev + 0.1))}
                                                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
                                                >
                                                    <span className="text-lg font-serif font-bold">A+</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="w-px h-4 bg-slate-300 mx-1"></div>

                            {/* Zen Mode Toggle */}
                            <button
                                onClick={() => setIsZen(!isZen)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${isZen ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'}`}
                                title={isZen ? "退出禅模式" : "进入禅模式"}
                            >
                                {isZen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* Workbench Toggle (Primary) */}
                        <button
                            onClick={() => setShowRightSidebar(!showRightSidebar)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm ml-2 ${showRightSidebar
                                ? 'bg-purple-600 text-white shadow-purple-200 hover:bg-purple-700'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                            title="智能工作台"
                        >
                            <Sparkles className={`w-4 h-4 ${showRightSidebar ? 'text-purple-100' : 'text-purple-600'}`} />
                            <span className="hidden sm:inline">工作台</span>
                            {showRightSidebar ? <PanelRightClose className="w-4 h-4 opacity-70" /> : <PanelRight className="w-4 h-4 opacity-70" />}
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden relative">
                {/* Left Sidebar - Analysis Panel */}
                {!isZen && (
                    <aside className={`${showLeftSidebar ? 'w-80' : 'w-0'} border-r border-border bg-surface overflow-y-auto transition-all duration-300 flex-shrink-0`}>
                        {showLeftSidebar && paperId && (
                            <div className="flex flex-col h-full">
                                {/* Tab Switcher */}
                                <div className="flex border-b border-slate-200 px-2 pt-2">
                                    <button
                                        onClick={() => setSidebarTab('analysis')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'analysis' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        📝 内容分析
                                    </button>
                                    <button
                                        onClick={() => setSidebarTab('structure')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'structure' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        📑 目录结构
                                    </button>
                                    <button
                                        onClick={() => setSidebarTab('graph')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'graph' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        🔗 关系图
                                    </button>
                                </div>

                                {/* Tab Content */}
                                <div className="flex-1 overflow-y-auto">
                                    {sidebarTab === 'analysis' && (
                                        <AnalysisPanel
                                            paperId={paperId}
                                            onJumpToLine={handleJumpToLine}
                                        />
                                    )}
                                    {sidebarTab === 'structure' && (
                                        <StructurePanel
                                            paperId={paperId}
                                            onJumpToLine={handleJumpToLine}
                                        />
                                    )}
                                    {sidebarTab === 'graph' && (
                                        <div className="p-2">
                                            <PaperGraph paperId={paperId} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </aside>
                )}

                {/* Sidebar Toggle Button */}
                {!isZen && (
                    <button
                        onClick={() => setShowLeftSidebar(prev => !prev)}
                        className="absolute left-0 top-4 z-40 p-1.5 bg-white border border-slate-200 rounded-r-lg shadow-sm text-slate-400 hover:text-slate-600 transition-colors"
                        style={{ left: showLeftSidebar ? '288px' : '0' }}
                        title={showLeftSidebar ? '隐藏分析面板' : '显示分析面板'}
                    >
                        {showLeftSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
                    </button>
                )}

                {/* Main Scrollable Area */}
                <main ref={mainContentRef} className={`flex-1 overflow-y-auto scroll-smooth ${isZen ? 'bg-background' : 'bg-background'}`}>
                    {/* Paper Card Container */}
                    <div className={`mx-auto transition-all duration-500 bg-surface shadow-sm border border-border ${isZen ? 'max-w-[900px] my-0 sm:my-8 min-h-screen sm:rounded-xl shadow-lg' : 'max-w-[850px] my-8 min-h-[calc(100vh-8rem)] rounded-xl'}`}
                        onMouseOver={handleMouseOver}
                        onMouseOut={handleMouseOut}
                    >

                        {/* Content Wrapper */}
                        <div className="px-12 py-16 sm:px-16 sm:py-20 md:px-20">
                            {/* Paper Metadata Header */}
                            <div className="mb-14 border-b border-slate-100 pb-10 text-center paper-header">
                                {/* Title */}
                                <h1 className="font-serif font-bold text-4xl text-content-main tracking-tight leading-[1.2] mb-6">
                                    {extractedTitle || paper?.title || paper?.filename || 'Untitled Document'}
                                </h1>

                                {/* Tags */}
                                {paper?.tags && paper.tags.length > 0 && (
                                    <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
                                        {paper.tags.map((tag: string, idx: number) => (
                                            <span
                                                key={idx}
                                                className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-medium tracking-wide rounded-full border border-indigo-100"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                        {!paper.tags_confirmed && paper.suggested_tags && (
                                            <span className="text-[10px] text-amber-600 italic ml-1">（待确认）</span>
                                        )}
                                    </div>
                                )}

                                {/* Extracted Metadata */}
                                {(extractedAuthors.length > 0 || extractedAffiliations.length > 0) ? (
                                    <>
                                        <div className="font-serif text-slate-700 text-xl leading-relaxed mb-6 author-line">
                                            {extractedAuthors.map((line, idx) => (
                                                <div key={idx}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkMath]}
                                                        rehypePlugins={[rehypeRaw, rehypeKatex]}
                                                        components={{ p: ({ children }) => <>{children}</> }}
                                                    >
                                                        {line}
                                                    </ReactMarkdown>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[0.95rem] text-slate-500 font-serif italic space-y-1 affil-line">
                                            {extractedAffiliations.map((line, idx) => (
                                                <div key={idx}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkMath]}
                                                        rehypePlugins={[rehypeRaw, rehypeKatex]}
                                                        components={{ p: ({ children }) => <>{children}</> }}
                                                    >
                                                        {line}
                                                    </ReactMarkdown>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* Mock Fallback */}
                                        <div className="font-serif text-slate-700 text-xl leading-relaxed mb-6 author-line">
                                            John Doe<sup className="text-xs font-sans text-slate-500 ml-0.5">1</sup>,
                                            Jane Smith<sup className="text-xs font-sans text-slate-500 ml-0.5">2</sup>
                                        </div>
                                        <div className="text-[0.95rem] text-slate-500 font-serif italic space-y-1 affil-line">
                                            <div>1. Department of Computer Science</div>
                                            <div>2. School of Engineering</div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Abstract */}
                            {finalAbstract && (
                                <div className="mb-14 px-4 sm:px-8 abstract-box">
                                    <span className="abstract-label text-indigo-900/80">Abstract — </span>
                                    <span className="font-serif text-[1rem] leading-8 text-slate-800 text-justify inline">
                                        {finalAbstract}
                                    </span>
                                </div>
                            )}

                            {/* Main Reference & Content */}
                            <article
                                className="prose prose-slate prose-lg max-w-none markdown-content font-serif"
                                onClick={handleCitationClick}
                            >
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkMath]}
                                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                                    components={{
                                        img: (props) => (
                                            <figure className="my-10">
                                                <img
                                                    {...props}
                                                    alt={props.alt || 'Paper Image'}
                                                    className="rounded-lg shadow-md mx-auto max-h-[600px] object-contain border border-slate-100"
                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                />
                                                {props.alt && <figcaption className="text-center text-sm text-slate-500 mt-3 italic font-serif">Fig: {props.alt}</figcaption>}
                                            </figure>
                                        ),
                                        a: (props) => (
                                            <a {...props} className="text-indigo-600 hover:text-indigo-800 underline decoration-indigo-200 underline-offset-2 transition-colors" target="_blank" />
                                        )
                                    }}
                                >
                                    {processedContent}
                                </ReactMarkdown>
                            </article>
                        </div>
                    </div>

                    {/* Footer Spacing */}
                    <div className="h-32"></div>
                </main>

                {/* Right Sidebar - Workbench */}
                {!isZen && (
                    <aside className={`${showRightSidebar ? 'w-80' : 'w-0'} border-l border-slate-200/60 bg-slate-50 overflow-hidden transition-all duration-300 flex-shrink-0`}>
                        {showRightSidebar && paperId && paper && (
                            <Workbench
                                paperId={paperId}
                                paperTitle={paper.title || '论文'}
                                onClose={() => setShowRightSidebar(false)}
                                onJumpToLocation={handleJumpToLine}
                                refreshKey={workbenchRefreshKey}
                            />
                        )}
                    </aside>
                )}
            </div>

            {/* Floating Exit Zen Mode Button (Visible when Zen is active) */}
            {isZen && (
                <button
                    onClick={() => setIsZen(false)}
                    className="fixed top-4 right-6 z-[60] p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-all duration-300 animate-in fade-in slide-in-from-top-4"
                    title="Exit Zen Mode (P)"
                >
                    <Minimize2 className="w-5 h-5" />
                </button>
            )}

            {/* Hovered Citation Tooltip */}
            {hoveredCitation && (
                <div
                    className="fixed z-50 bg-white p-4 rounded-lg shadow-xl border border-slate-200 max-w-sm text-sm text-slate-700 animate-in fade-in zoom-in-95 duration-200"
                    style={{
                        left: hoveredCitation.x,
                        top: hoveredCitation.y + 10,
                        transform: 'translateX(-50%)'
                    }}
                >
                    <div className="font-bold text-slate-900 mb-1 flex items-center gap-2">
                        <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-xs">Ref {hoveredCitation.id}</span>
                    </div>
                    <div className="leading-relaxed font-serif">
                        {getReferenceText(hoveredCitation.id)}
                    </div>
                </div>
            )}

            {/* Smart Selection Popup */}
            {selectionPosition && (
                <SmartSelectionPopup
                    text={selectedText}
                    position={selectionPosition}
                    paperId={paperId!}
                    paperTitle={paper?.title || paper?.filename || ''}
                    fullContent={contentData?.markdown || ''}
                    location={selectionLocation}
                    onClose={() => {
                        setSelectedText('');
                        setSelectionPosition(null);
                        setSelectionLocation(null);
                    }}
                    onNoteAdded={() => setWorkbenchRefreshKey(k => k + 1)}
                />
            )}
        </div>
    );
}
