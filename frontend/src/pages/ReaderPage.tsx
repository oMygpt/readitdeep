/**
 * Read it DEEP - 阅读器页面 (Refined UI)
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
    NotebookPen,
    FileText,
    RotateCcw,
    X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { papersApi, authApi, annotationsApi, authFetch, AuthEventSource } from '../lib/api';
import type { Annotation, TextLocation } from '../lib/api';
import { anchorFromRange, captureAnchor, resolveAnchor } from '../lib/anchors';
import ResearchPanel from '../components/reader/ResearchPanel';
import { useReadingWorkspace } from '../components/reader/useReadingWorkspace';
import { useAnnotationDrafts } from '../components/reader/useAnnotationDrafts';
import ReadingLeaveGuard from '../components/reader/ReadingLeaveGuard';
import '../components/reader/reader.css';
import AnalysisPanel from '../components/AnalysisPanel';
import DocumentOutline from '../components/reader/DocumentOutline';
import PaperGraph from '../components/PaperGraph';
import ExploreOverview from '../components/ExploreOverview';
import SmartSelectionPopup from '../components/SmartSelectionPopup';
import ShareToTeamModal from '../components/ShareToTeamModal';
import ShareLinkModal from '../components/ShareLinkModal';
import HighlightOverlay from '../components/HighlightOverlay';

import 'katex/dist/katex.min.css';

export default function ReaderPage() {
    const { paperId } = useParams();
    return <ReaderContent key={paperId} />;
}

function ReaderContent() {
    const { user: signedInUser } = useAuth();
    const { paperId } = useParams<{ paperId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const evidenceId = searchParams.get("annotation");
    const evidenceJumped = useRef(false);
    const [isZen, setIsZen] = useState(false);
    const [paperFormat, setPaperFormat] = useState<'standard' | 'acm' | 'lncs'>('standard');
    const [fontSize, setFontSize] = useState<number>(1.2); // Default larger size (approx 19.2px)
    const [isTranslated, setIsTranslated] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translatedContent, setTranslatedContent] = useState<string | null>(null);
    const [translationProgress, setTranslationProgress] = useState<string>('');
    const [showSettings, setShowSettings] = useState(false); // New State for Aa menu
    const [hoveredCitation, setHoveredCitation] = useState<{ id: string, x: number, y: number } | null>(null);
    const [showLeftSidebar, setShowLeftSidebar] = useState(() => window.innerWidth >= 1280); // Left sidebar visibility
    const [showRightSidebar, setShowRightSidebar] = useState(() => window.innerWidth >= 1024); // Research panel
    const [sidebarTab, setSidebarTab] = useState<'analysis' | 'graph' | 'structure'>('structure'); // Sidebar tab - 默认显示目录结构
    const [viewMode, setViewMode] = useState<'overview' | 'read'>('read'); // Explore vs Read mode
    const mainContentRef = useRef<HTMLElement>(null);
    const documentRef = useRef<HTMLDivElement>(null);
    const [notice, setNotice] = useState('');
    const notes = useAnnotationDrafts();
    const noteDrafts = notes.drafts;
    const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
    const restored = useRef(false);

    // Smart Selection State
    const [selectedText, setSelectedText] = useState<string>('');
    const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
    const [selectionLocation, setSelectionLocation] = useState<TextLocation | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showShareLinkModal, setShowShareLinkModal] = useState(false);
    const [annotationsRefreshKey, setAnnotationsRefreshKey] = useState(0);

    const { data: paper, isLoading: isPaperLoading } = useQuery({
        queryKey: ['paper', signedInUser?.id, paperId],
        queryFn: () => papersApi.get(paperId!),
        enabled: !!paperId,
        refetchInterval: query => query.state.data?.content_ready ? false : 3000,
    });

    const { data: contentData, isLoading: isContentLoading, error, refetch: refetchContent } = useQuery({
        queryKey: ['paper-content', signedInUser?.id, paperId],
        queryFn: () => papersApi.getContent(paperId!),
        enabled: !!paperId && !!(paper?.content_ready || paper?.markdown_content),
    });

    // Fetch current user for highlight color assignment
    const { data: currentUser } = useQuery({
        queryKey: ['current-user', signedInUser?.id],
        queryFn: () => authApi.me(),
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    });

    const reading = useReadingWorkspace(paperId!, currentUser?.id);
    const representation = isTranslated ? 'translation' : 'original';
    const currentRevision = contentData?.revisions?.[representation];

    useEffect(() => {
        if (isTranslated && translatedContent) void refetchContent();
    }, [isTranslated, translatedContent, refetchContent]);

    useEffect(() => {
        const checkpoint = reading.initial?.checkpoint;
        if (evidenceId) { restored.current = true; return; }
        if (restored.current || !checkpoint || !currentRevision || !mainContentRef.current) return;
        if (checkpoint.representation !== representation) {
            if (checkpoint.representation === 'translation' && paper?.translated_content) {
                setTranslatedContent(paper.translated_content);
                setIsTranslated(true);
            } else if (checkpoint.representation === 'translation') {
                restored.current = true;
                setNotice('上次阅读的是译文，当前译文不可用。已保留原文供核对。');
            }
            return;
        }
        restored.current = true;
        if (checkpoint.revision_id !== currentRevision.id) {
            setNotice('正文版本已变化，上次位置未自动套用。旧批注仍保留，请核对来源。');
            return;
        }
        setFontSize(checkpoint.font_size);
        let touched = false;
        const stop = () => { touched = true; };
        const el = mainContentRef.current;
        const align = () => {
            if (touched || !el) return;
            const range = checkpoint.anchor && documentRef.current
                ? resolveAnchor(documentRef.current, { anchor: checkpoint.anchor }, currentRevision.id) : null;
            el.style.scrollBehavior = 'auto';
            if (range) el.scrollTop += range.getBoundingClientRect().top - el.getBoundingClientRect().top - (checkpoint.block_offset || 0);
            else el.scrollTop = checkpoint.scroll_ratio * Math.max(0, el.scrollHeight - el.clientHeight);
            el.style.scrollBehavior = '';
        };
        el.addEventListener('wheel', stop, { passive: true });
        el.addEventListener('pointerdown', stop);
        el.addEventListener('keydown', stop);
        requestAnimationFrame(align);
        const observer = new ResizeObserver(align);
        if (documentRef.current) observer.observe(documentRef.current);
        const timer = setTimeout(() => observer.disconnect(), 2000);
        return () => {
            clearTimeout(timer); observer.disconnect();
            el.removeEventListener('wheel', stop); el.removeEventListener('pointerdown', stop); el.removeEventListener('keydown', stop);
        };
    }, [reading.initial, currentRevision, representation, paper?.translated_content, evidenceId]);

    useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

    const rememberPosition = () => {
        if (!reading.initial || !currentRevision || !mainContentRef.current) return;
        const el = mainContentRef.current;
        const top = el.getBoundingClientRect().top;
        const block = Array.from(documentRef.current?.querySelectorAll('p, h2, h3, blockquote') || [])
            .find(node => node.getBoundingClientRect().bottom > top + 24);
        let positionAnchor = null;
        if (block && documentRef.current) {
            const range = document.createRange(); range.selectNodeContents(block);
            positionAnchor = anchorFromRange(documentRef.current, range, currentRevision.id, representation);
        }
        reading.update({ checkpoint: {
            revision_id: currentRevision.id, representation, font_size: fontSize,
            anchor: positionAnchor, block_offset: block ? block.getBoundingClientRect().top - top : 0,
            scroll_ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
        } });
    };

    const jumpToAnnotation = (item: Annotation) => {
        if (item.anchor && item.anchor.representation !== representation) {
            setNotice(item.anchor.representation === 'translation' ? '这条材料摘自译文，请切换到对应译文核对。' : '这条批注来自原文，请切回原文核对。');
            return;
        }
        const range = documentRef.current && resolveAnchor(documentRef.current, item, currentRevision?.id);
        if (!range) {
            setNotice(item.anchor ? '当前正文与批注位置不一致，未自动跳转。请核对内容版本。' : '旧笔记的原文位置无法唯一确定，请用摘录核对，未自动跳转。');
            return;
        }
        const parent = range.startContainer.parentElement;
        parent?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        parent?.classList.add('highlight-ref');
        setTimeout(() => parent?.classList.remove('highlight-ref'), 2000);
        if (window.innerWidth < 1024) setShowRightSidebar(false);
    };

    const openOriginal = async () => {
        const target = window.open('about:blank', '_blank');
        if (target) target.opener = null;
        try {
            const response = await authFetch(`/api/v1/papers/${paperId}/original`);
            if (!response.ok) throw new Error('unavailable');
            const url = URL.createObjectURL(await response.blob());
            if (target) target.location.href = url;
            else { URL.revokeObjectURL(url); setNotice('浏览器拦截了新窗口，请允许后重新打开原 PDF。'); return; }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch { target?.close(); setNotice('原 PDF 暂时无法打开，请确认文件和登录状态后重试。'); }
    };

    useEffect(() => {
        if (Object.keys(noteDrafts).length === 0) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [noteDrafts]);

    const flushReading = async () => {
        rememberPosition();
        do {
            if (!await reading.save() || !await notes.saveAll()) return false;
        } while (reading.hasUnsaved() || notes.hasUnsaved());
        return true;
    };

    // Fetch annotations for this paper (used for highlight rendering)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { data: annotations = [] } = useQuery({
        queryKey: ['paper-annotations', currentUser?.id, paperId, annotationsRefreshKey],
        queryFn: () => annotationsApi.list(paperId!),
        enabled: !!paperId && !!currentUser,
    });

    useEffect(() => {
        if (!evidenceId || evidenceJumped.current || !currentRevision || !documentRef.current || !annotations.length) return;
        const item = annotations.find(value => value.id === evidenceId);
        if (!item) { evidenceJumped.current = true; setNotice('这条证据已不可用，请在证据库重新核对。'); return; }
        const frame = requestAnimationFrame(() => { evidenceJumped.current = true; jumpToAnnotation(item); });
        return () => cancelAnimationFrame(frame);
    // The explicit evidence jump runs once after its content revision is rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [evidenceId, currentRevision, annotations]);

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
            const triggerRes = await authFetch(`/api/v1/papers/${paperId}/translate`, { method: 'POST' });
            const triggerData = await triggerRes.json();

            if (!triggerData.success && triggerData.status !== 'translating' && triggerData.status !== 'completed') {
                setIsTranslating(false);
                setTranslationProgress(triggerData.message || '启动失败');
                return;
            }

            // If already completed, just fetch the result
            if (triggerData.status === 'completed') {
                const res = await authFetch(`/api/v1/papers/${paperId}/translation`);
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
            const eventSource = new AuthEventSource(`/api/v1/papers/${paperId}/translate/stream`);
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
                    authFetch(`/api/v1/papers/${paperId}/translation`)
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
                const res = await authFetch(`/api/v1/papers/${paperId}/translation`);
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
            const target = e.target as HTMLElement;
            if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || target.closest('input, textarea, [contenteditable=true]')) return;
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
            if (!documentRef.current || !currentRevision) return null;
            const anchor = captureAnchor(documentRef.current, selection, currentRevision.id, representation);
            return anchor ? { start_line: 0, end_line: 0, text_snippet: anchor.exact.slice(0, 100), anchor } : null;
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

            if (text && text.length >= 2) {
                const range = selection?.getRangeAt(0);
                const rect = range?.getBoundingClientRect();
                const location = selection ? computeTextLocation(selection) : null;

                if (rect) {
                    if (!location?.anchor) return;
                    setSelectedText(location.anchor.exact);
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
    }, [isDragging, selectionPosition, currentRevision, representation]);

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

    if (!paper.content_ready && !paper.markdown_content && ['uploading', 'parsing', 'indexing'].includes(paper.status)) {
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

    if (paper.status === 'failed' && !paper.content_ready && !paper.markdown_content) {
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
            <>
                <ReadingLeaveGuard hasUnsaved={() => reading.hasUnsaved() || notes.hasUnsaved()} flush={flushReading}
                    onFailure={() => { setViewMode('read'); setNotice('阅读现场或批注尚未保存，已留在本页。'); }} />
                <ExploreOverview
                    paperId={paperId!}
                    paperTitle={paper.title || paper.filename}
                    onStartReading={() => setViewMode('read')}
                    onBack={() => navigate('/')}
                    onShareToTeam={() => setShowShareModal(true)}
                    onShareLink={() => setShowShareLinkModal(true)}
                />
                {/* Share to Team Modal */}
                {showShareModal && (
                    <ShareToTeamModal
                        paperId={paperId!}
                        paperTitle={paper.title || paper.filename}
                        onClose={() => setShowShareModal(false)}
                        onSuccess={() => setShowShareModal(false)}
                    />
                )}
                {/* Share Link Modal */}
                <ShareLinkModal
                    paperId={paperId!}
                    paperTitle={paper.title || paper.filename}
                    isOpen={showShareLinkModal}
                    onClose={() => setShowShareLinkModal(false)}
                />
            </>
        );
    }

    return (
        <div className="research-reader flex flex-col h-screen bg-background text-content-main font-sans transition-colors duration-500 overflow-hidden relative">
            <ReadingLeaveGuard hasUnsaved={() => reading.hasUnsaved() || notes.hasUnsaved()} flush={flushReading}
                onFailure={() => setNotice('阅读现场或批注尚未保存，已留在本页。请重试或处理冲突后再离开。')} />
            {/* Dynamic CSS Injection */}
            <style>{getStyles()}</style>

            {/* Top Navigation Toolbar */}
            <header className={`research-toolbar h-16 border-b border-border bg-surface flex items-center justify-between px-6 z-50 transition-all duration-300 shadow-sm ${isZen ? '-translate-y-full mb-[-64px]' : ''}`}>
                <div className="flex items-center gap-3">
                    <button aria-label="返回论文库" onClick={() => { rememberPosition(); navigate('/library'); }} className="p-2 -ml-2 text-content-muted hover:text-content-main hover:bg-surface-elevated rounded-lg transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-brand rounded-lg text-primary-content shadow-sm shadow-brand/20">
                            <BookOpen className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 hidden sm:block"><span className="block text-[10px] uppercase tracking-widest text-content-muted">Read it DEEP · 精读工作区</span><span className="block text-sm font-medium truncate max-w-[240px]">{paper.title || paper.filename}</span></div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button className="research-text-button reader-overview-link" onClick={() => setViewMode('overview')}>论文速览</button>
                    {paper.has_original && <button className="research-text-button" onClick={() => void openOriginal()} title="核验原 PDF"><FileText className="w-4 h-4" /><span className="hidden sm:inline">原 PDF</span></button>}
                    {/* Translate Toggle (Secondary) */}
                    <button
                        aria-label={isTranslated ? '切回原文' : translatedContent ? '查看译文' : '翻译论文'}
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
                            onClick={() => { setShowRightSidebar(!showRightSidebar); if (window.innerWidth < 1024) setShowLeftSidebar(false); }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm ml-2 ${showRightSidebar
                                ? 'bg-emerald-800 text-white hover:bg-emerald-900'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                            title="研究笔记"
                        >
                            <NotebookPen className={`w-4 h-4 ${showRightSidebar ? 'text-purple-100' : 'text-purple-600'}`} />
                            <span className="hidden sm:inline">研究笔记</span>
                            {showRightSidebar ? <PanelRightClose className="w-4 h-4 opacity-70" /> : <PanelRight className="w-4 h-4 opacity-70" />}
                        </button>
                    </div>
                </div>
            </header>

            {notice && <div className="research-notice" role="status"><span className="flex-1">{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X className="w-4 h-4" /></button></div>}
            {reading.initial?.checkpoint && !notice && <div className="research-notice"><RotateCcw className="w-3.5 h-3.5" /><span className="flex-1">{reading.initial.next_action || '已恢复上次阅读现场，可以继续阅读。'}</span><span className="hidden sm:inline">阅读问题仅自己可见</span></div>}
            <div className="flex-1 flex overflow-hidden relative">
                {!isZen && (showLeftSidebar || showRightSidebar) && <button aria-label="收起侧面板" className="lg:hidden absolute inset-0 z-40 bg-black/10" onClick={() => { setShowLeftSidebar(false); setShowRightSidebar(false); }} />}
                {/* Left Sidebar - Analysis Panel */}
                {!isZen && (
                    <aside className={`reader-left-panel ${showLeftSidebar ? 'w-64' : 'w-0'} border-r border-border bg-surface overflow-y-auto transition-all duration-300 flex-shrink-0`}>
                        {showLeftSidebar && paperId && (
                            <div className="flex flex-col h-full">
                                {/* Tab Switcher */}
                                <div className="flex border-b border-slate-200 px-2 pt-2">
                                    <button
                                        onClick={() => setSidebarTab('analysis')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'analysis' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        内容分析
                                    </button>
                                    <button
                                        onClick={() => setSidebarTab('structure')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'structure' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        目录
                                    </button>
                                    <button
                                        onClick={() => setSidebarTab('graph')}
                                        className={`flex-1 py-2 text-xs font-medium rounded-t-lg transition-colors ${sidebarTab === 'graph' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        关联论文
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
                                        <DocumentOutline markdown={content} onJump={(title, occurrence) => {
                                            const heading = Array.from(documentRef.current?.querySelectorAll('h2,h3,h4,h5,h6') || [])
                                                .filter(node => node.textContent?.trim() === title)[occurrence];
                                            const target = heading || (/^(abstract|摘要)$/i.test(title) ? documentRef.current?.querySelector('.abstract-box') : null);
                                            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            if (window.innerWidth < 1024) setShowLeftSidebar(false);
                                        }} />
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
                        onClick={() => { setShowLeftSidebar(prev => !prev); if (window.innerWidth < 1024) setShowRightSidebar(false); }}
                        className="absolute left-0 top-4 z-40 p-1.5 bg-white border border-slate-200 rounded-r-lg shadow-sm text-slate-400 hover:text-slate-600 transition-colors"
                        style={{ left: showLeftSidebar ? '256px' : '0' }}
                        title={showLeftSidebar ? '隐藏分析面板' : '显示分析面板'}
                    >
                        {showLeftSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
                    </button>
                )}

                {/* Main Scrollable Area */}
                <main ref={mainContentRef} onScroll={() => { if (scrollTimer.current) clearTimeout(scrollTimer.current); scrollTimer.current = setTimeout(rememberPosition, 350); }} className={`flex-1 overflow-y-auto scroll-smooth ${isZen ? 'bg-background' : 'bg-background'}`}>
                    {/* Paper Card Container */}
                    <div className={`paper-sheet mx-auto transition-all duration-500 bg-surface shadow-sm border border-border ${isZen ? 'max-w-[900px] my-0 sm:my-8 min-h-screen sm:rounded-xl shadow-lg' : 'max-w-[850px] my-8 min-h-[calc(100vh-8rem)] rounded-xl'}`}
                        onMouseOver={handleMouseOver}
                        onMouseOut={handleMouseOut}
                    >

                        {/* Content Wrapper */}
                        <div className="paper-padding px-10 py-12 sm:px-12 sm:py-14">
                            {/* Paper Metadata Header */}
                            <div className="mb-14 border-b border-slate-100 pb-10 text-center paper-header">
                                {/* Title */}
                                <h1 className="font-serif font-bold text-4xl text-content-main tracking-tight leading-[1.2] mb-6">
                                    {extractedTitle || paper?.title || paper?.filename || 'Untitled Document'}
                                </h1>

                                {/* 解析来源：GROBID 只提取文字，不含图片与版面公式 */}
                                {paper?.parser === 'grobid' && (
                                    <p className="text-xs text-slate-400 mb-6">
                                        本文由 GROBID 解析：保留章节、公式文本、图表标题与参考文献，不含图片
                                    </p>
                                )}

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
                                                        rehypePlugins={paper?.resource_imported ? [rehypeKatex] : [rehypeRaw, rehypeKatex]}
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
                                                        rehypePlugins={paper?.resource_imported ? [rehypeKatex] : [rehypeRaw, rehypeKatex]}
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
                                    </>
                                )}
                            </div>

                            <div ref={documentRef}>
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
                                    rehypePlugins={paper?.resource_imported ? [rehypeKatex] : [rehypeRaw, rehypeKatex]}
                                    components={{
                                        img: (props) => paper?.resource_imported ? <span className="text-sm text-content-muted">[图片未转移：{props.alt || '图'}，请在原始文献核对]</span> : (
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
                    </div>

                    {/* Footer Spacing */}
                    <div className="h-32"></div>
                </main>

                {!isZen && (
                    <aside className={`reader-right-panel ${showRightSidebar ? 'w-[360px]' : 'w-0'} border-l border-border overflow-hidden flex-shrink-0`}>
                        {showRightSidebar && paperId && <ResearchPanel
                            paperId={paperId} ownerId={signedInUser?.id} paperTitle={paper.title || paper.filename} annotations={annotations}
                            reading={reading} noteDrafts={noteDrafts}
                            onDraftChange={notes.update} onSaveNote={notes.saveOne}
                            onDraftDrop={notes.drop} onDraftError={message => setNotice(message)}
                            onChange={() => setAnnotationsRefreshKey(k => k + 1)}
                            onJump={jumpToAnnotation} onJumpToLocation={handleJumpToLine}
                            onClose={() => setShowRightSidebar(false)} refreshKey={workbenchRefreshKey}
                        />}
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
                    researchQuestion={reading.workspace.focus}
                    onClose={() => {
                        setSelectedText('');
                        setSelectionPosition(null);
                        setSelectionLocation(null);
                    }}
                    onNoteAdded={() => setWorkbenchRefreshKey(k => k + 1)}
                    onHighlightCreated={() => { setAnnotationsRefreshKey(k => k + 1); setShowRightSidebar(true); }}
                    userId={currentUser?.id}
                />
            )}

            {/* Highlight Overlay */}
            <HighlightOverlay
                annotations={annotations}
                contentRef={documentRef}
                revisionId={currentRevision?.id}
                currentUserId={currentUser?.id}
                paperId={paperId}
                onDeleteAnnotation={async (id) => {
                    try {
                        await annotationsApi.delete(id);
                        setAnnotationsRefreshKey(k => k + 1);
                    } catch (e) {
                        console.error('Failed to delete annotation:', e);
                    }
                }}
                onAnnotationChanged={() => setAnnotationsRefreshKey(k => k + 1)}
            />
        </div>
    );
}
