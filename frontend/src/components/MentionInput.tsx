/**
 * MentionInput - 带@提及自动补全的文本输入组件
 * 
 * 功能：
 * - 输入 @ 触发成员列表
 * - @AI 触发 AI 指令补全
 * - 键盘上下选择
 * - 回车或点击选择
 * - @提及高亮显示
 */

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Loader2, AtSign, Bot, Sparkles, BookOpen, Search, GitCompare, Lightbulb } from 'lucide-react';
import { teamsApi } from '../lib/api';
import type { TeamMember } from '../lib/api';

interface MentionInputProps {
    value: string;
    onChange: (value: string) => void;
    teamId?: string;
    placeholder?: string;
    className?: string;
    rows?: number;
    onSubmit?: () => void;
    disabled?: boolean;
    enableAI?: boolean; // 是否启用 @AI 功能
}

export interface MentionInputRef {
    focus: () => void;
    blur: () => void;
}

interface MentionUser {
    id: string;
    username: string;
    email: string;
    isAI?: boolean;
}

// AI 指令定义
export interface AICommand {
    id: string;
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    prompt: string;
}

export const AI_COMMANDS: AICommand[] = [
    {
        id: 'explain',
        name: '解释',
        description: '解释选中内容或概念',
        icon: Lightbulb,
        prompt: '请解释',
    },
    {
        id: 'summarize',
        name: '总结',
        description: '总结讨论/论文内容',
        icon: BookOpen,
        prompt: '请总结',
    },
    {
        id: 'search',
        name: '搜索',
        description: '在团队知识库中搜索',
        icon: Search,
        prompt: '请搜索',
    },
    {
        id: 'compare',
        name: '比较',
        description: '比较不同论文或方法',
        icon: GitCompare,
        prompt: '请比较',
    },
    {
        id: 'expand',
        name: '拓展',
        description: '拓展相关知识和建议',
        icon: Sparkles,
        prompt: '请拓展',
    },
];

// AI 用户占位符
const AI_USER: MentionUser = {
    id: 'ai-assistant',
    username: 'AI',
    email: 'AI 讨论助手',
    isAI: true,
};

// Parse mentions from text - returns array of user IDs mentioned
export function parseMentions(text: string): string[] {
    const mentionRegex = /@\[([^\]]+)\]\(user:([^)]+)\)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
        mentions.push(match[2]); // user ID
    }
    return mentions;
}

// Check if text contains @AI mention
export function hasAIMention(text: string): boolean {
    return /@\[AI\]\(user:ai-assistant\)/.test(text);
}

// Extract AI command from text (e.g., "@AI 解释 xxx" -> "explain")
export function extractAICommand(text: string): AICommand | null {
    if (!hasAIMention(text)) return null;

    // Find text after @AI mention
    const aiMentionEnd = text.indexOf('@[AI](user:ai-assistant)') + '@[AI](user:ai-assistant)'.length;
    const afterMention = text.slice(aiMentionEnd).trim();

    for (const cmd of AI_COMMANDS) {
        if (afterMention.startsWith(cmd.name) || afterMention.startsWith(cmd.prompt)) {
            return cmd;
        }
    }

    return null;
}

// Render text with highlighted mentions
export function renderMentionText(text: string): JSX.Element {
    // Handle both user mentions and AI mentions
    const mentionRegex = /@\[([^\]]+)\]\(user:([^)]+)\)/g;
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = mentionRegex.exec(text)) !== null) {
        // Add text before mention
        if (match.index > lastIndex) {
            parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
        }

        // Check if it's AI mention
        const isAI = match[2] === 'ai-assistant';

        // Add highlighted mention
        parts.push(
            <span
                key={key++}
                className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-medium ${isAI
                        ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-600'
                        : 'bg-primary/10 text-primary'
                    }`}
            >
                {isAI ? <Bot className="w-3 h-3" /> : <AtSign className="w-3 h-3" />}
                {match[1]}
            </span>
        );
        lastIndex = mentionRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
    }

    return <>{parts}</>;
}

const MentionInput = forwardRef<MentionInputRef, MentionInputProps>(({
    value,
    onChange,
    teamId,
    placeholder = "输入内容，@ 提及成员或 AI...",
    className = "",
    rows = 3,
    onSubmit,
    disabled = false,
    enableAI = true,
}, ref) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const [showAICommands, setShowAICommands] = useState(false);
    const [members, setMembers] = useState<MentionUser[]>([]);
    const [filteredMembers, setFilteredMembers] = useState<MentionUser[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionStartPos, setMentionStartPos] = useState(-1);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        blur: () => textareaRef.current?.blur(),
    }));

    // Load team members
    useEffect(() => {
        const loadMembers = async () => {
            if (!teamId) {
                setMembers(enableAI ? [AI_USER] : []);
                return;
            }

            setIsLoading(true);
            try {
                const data = await teamsApi.getMembers(teamId);
                const memberList: MentionUser[] = data.map((m: TeamMember) => ({
                    id: m.user_id,
                    username: m.username || m.email?.split('@')[0] || '未知用户',
                    email: m.email || '',
                }));

                // Add AI user at the beginning if enabled
                if (enableAI) {
                    memberList.unshift(AI_USER);
                }

                setMembers(memberList);
            } catch (error) {
                console.error('Failed to load team members:', error);
                if (enableAI) {
                    setMembers([AI_USER]);
                }
            } finally {
                setIsLoading(false);
            }
        };

        loadMembers();
    }, [teamId, enableAI]);

    // Filter members based on query
    useEffect(() => {
        if (!mentionQuery) {
            setFilteredMembers(members);
        } else {
            const query = mentionQuery.toLowerCase();
            setFilteredMembers(members.filter(m =>
                m.username.toLowerCase().includes(query) ||
                m.email.toLowerCase().includes(query)
            ));
        }
        setSelectedIndex(0);
    }, [mentionQuery, members]);

    // Handle input change
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursorPos = e.target.selectionStart;
        onChange(newValue);

        // Check if we just completed an @AI mention
        if (newValue.includes('@[AI](user:ai-assistant) ')) {
            const aiMentionEnd = newValue.indexOf('@[AI](user:ai-assistant) ') + '@[AI](user:ai-assistant) '.length;
            if (cursorPos === aiMentionEnd) {
                setShowAICommands(true);
                setShowDropdown(false);
                return;
            }
        }

        setShowAICommands(false);

        // Check if we're in a mention context
        const textBeforeCursor = newValue.slice(0, cursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtIndex !== -1) {
            const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
            // Check if there's a space or newline between @ and cursor
            if (!/[\s\n]/.test(textAfterAt)) {
                setMentionStartPos(lastAtIndex);
                setMentionQuery(textAfterAt);
                setShowDropdown(true);
                return;
            }
        }

        setShowDropdown(false);
        setMentionStartPos(-1);
        setMentionQuery('');
    }, [onChange]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Handle AI command selection
        if (showAICommands) {
            if (e.key === 'Escape') {
                setShowAICommands(false);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => prev < AI_COMMANDS.length - 1 ? prev + 1 : 0);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => prev > 0 ? prev - 1 : AI_COMMANDS.length - 1);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectAICommand(AI_COMMANDS[selectedIndex]);
                return;
            }
        }

        if (!showDropdown || filteredMembers.length === 0) {
            // Handle Cmd+Enter submit
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmit?.();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < filteredMembers.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev > 0 ? prev - 1 : filteredMembers.length - 1
                );
                break;
            case 'Enter':
            case 'Tab':
                e.preventDefault();
                selectMember(filteredMembers[selectedIndex]);
                break;
            case 'Escape':
                setShowDropdown(false);
                break;
        }
    }, [showDropdown, showAICommands, filteredMembers, selectedIndex, onSubmit]);

    // Select a member
    const selectMember = useCallback((member: MentionUser) => {
        if (mentionStartPos === -1) return;

        const beforeMention = value.slice(0, mentionStartPos);
        const afterCursor = value.slice(mentionStartPos + 1 + mentionQuery.length);

        // Format: @[username](user:id)
        const mentionText = `@[${member.username}](user:${member.id}) `;
        const newValue = beforeMention + mentionText + afterCursor;

        onChange(newValue);
        setShowDropdown(false);
        setMentionStartPos(-1);
        setMentionQuery('');

        // Show AI command menu if AI was selected
        if (member.isAI) {
            setShowAICommands(true);
            setSelectedIndex(0);
        }

        // Focus and set cursor position
        setTimeout(() => {
            if (textareaRef.current) {
                const newCursorPos = beforeMention.length + mentionText.length;
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    }, [value, mentionStartPos, mentionQuery, onChange]);

    // Select an AI command
    const selectAICommand = useCallback((command: AICommand) => {
        const aiMentionIndex = value.indexOf('@[AI](user:ai-assistant) ');
        if (aiMentionIndex === -1) return;

        const aiMentionEnd = aiMentionIndex + '@[AI](user:ai-assistant) '.length;
        const beforeCommand = value.slice(0, aiMentionEnd);
        const afterCommand = value.slice(aiMentionEnd);

        // Insert command name with space
        const newValue = beforeCommand + command.name + ' ' + afterCommand;
        onChange(newValue);
        setShowAICommands(false);

        // Focus and set cursor position after command
        setTimeout(() => {
            if (textareaRef.current) {
                const newCursorPos = aiMentionEnd + command.name.length + 1;
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    }, [value, onChange]);

    // Click outside to close dropdown
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
                setShowAICommands(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={rows}
                disabled={disabled}
                className={`w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-content-main resize-none ${className}`}
            />

            {/* Mention Dropdown */}
            {showDropdown && (
                <div
                    ref={dropdownRef}
                    className="absolute left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
                >
                    {isLoading ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-5 h-5 text-primary animate-spin" />
                        </div>
                    ) : filteredMembers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-content-muted">
                            没有找到匹配的成员
                        </div>
                    ) : (
                        filteredMembers.map((member, index) => (
                            <button
                                key={member.id}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-elevated transition-colors ${index === selectedIndex ? 'bg-primary/10' : ''
                                    }`}
                                onClick={() => selectMember(member)}
                            >
                                {member.isAI ? (
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs">
                                        <Bot className="w-4 h-4" />
                                    </div>
                                ) : (
                                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                        {member.username.charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-medium truncate ${member.isAI ? 'text-purple-600' : 'text-content-main'}`}>
                                        {member.username}
                                    </div>
                                    <div className="text-xs text-content-muted truncate">
                                        {member.email}
                                    </div>
                                </div>
                                {member.isAI && (
                                    <Sparkles className="w-4 h-4 text-purple-500" />
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}

            {/* AI Commands Dropdown */}
            {showAICommands && (
                <div
                    ref={dropdownRef}
                    className="absolute left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                >
                    <div className="px-3 py-2 text-xs text-content-muted bg-surface-elevated border-b border-border flex items-center gap-1">
                        <Bot className="w-3.5 h-3.5 text-purple-500" />
                        选择 AI 指令
                    </div>
                    {AI_COMMANDS.map((command, index) => {
                        const Icon = command.icon;
                        return (
                            <button
                                key={command.id}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-elevated transition-colors ${index === selectedIndex ? 'bg-primary/10' : ''
                                    }`}
                                onClick={() => selectAICommand(command)}
                            >
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                    <Icon className="w-4 h-4 text-purple-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-content-main">
                                        {command.name}
                                    </div>
                                    <div className="text-xs text-content-muted">
                                        {command.description}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Hint */}
            {!showDropdown && !showAICommands && (
                <div className="text-xs text-content-muted mt-1 flex items-center gap-2">
                    <span className="flex items-center gap-0.5">
                        <AtSign className="w-3 h-3" />
                        提及成员
                    </span>
                    {enableAI && (
                        <span className="flex items-center gap-0.5">
                            <Bot className="w-3 h-3 text-purple-500" />
                            @AI 获取帮助
                        </span>
                    )}
                </div>
            )}
        </div>
    );
});

MentionInput.displayName = 'MentionInput';

export default MentionInput;
