/**
 * Read it DEEP - Admin Settings Page
 * 
 * Fine-grained API Configuration:
 * - Main LLM
 * - Translation LLM
 * - Embedding (global read-only)
 * - MinerU
 * - Smart Analysis (inherit/independent config)
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { adminApi, isLinkedMode, type SystemConfig, type User as AdminUser, type TokenStats, type AdminInvitationCodeItem } from '../lib/api';
import {
    Settings,
    Users,
    Shield,
    Key,
    Server,
    Languages,
    Brain,
    ArrowLeft,
    Save,
    Plus,
    Trash2,
    UserCog,
    Loader2,
    CheckCircle,
    XCircle,
    Eye,
    EyeOff,
    Lock,
    Sparkles,
    FileText,
    ChevronDown,
    ChevronRight,
    BarChart3,
    RefreshCw,
    Gift,
    Copy,
    MessageSquare,
} from 'lucide-react';
import PromptManagement from '../components/PromptManagement';

type Tab = 'config' | 'users' | 'invitations' | 'prompts';

// 配置卡片组件
interface ConfigCardProps {
    title: string;
    icon: React.ReactNode;
    iconBg: string;
    description: string;
    children: React.ReactNode;
}

function ConfigCard({ title, icon, iconBg, description, children }: ConfigCardProps) {
    return (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}>
                    {icon}
                </div>
                <div>
                    <h3 className="font-semibold text-slate-900">{title}</h3>
                    <p className="text-sm text-slate-500">{description}</p>
                </div>
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

// API 密钥输入组件
interface ApiKeyInputProps {
    label: string;
    value: string;
    isSet?: boolean;
    onChange: (value: string) => void;
    showKey: boolean;
    onToggleShow: () => void;
}

function ApiKeyInput({ label, value, isSet, onChange, showKey, onToggleShow }: ApiKeyInputProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
                {label} {isSet && <span className="text-green-600">(已设置)</span>}
            </label>
            <div className="relative">
                <input
                    type={showKey ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="留空保持不变"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 pr-10"
                />
                <button
                    type="button"
                    onClick={onToggleShow}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </div>
        </div>
    );
}

// 模式选择组件
interface ModeSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
}

function ModeSelect({ value, onChange, options }: ModeSelectProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">配置模式</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );
}

export default function AdminPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('config');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    // 配置表单
    const [configForm, setConfigForm] = useState({
        // 主 LLM
        llm_mode: 'shared',
        llm_base_url: '',
        llm_model: '',
        llm_api_key: '',
        // 翻译 LLM
        translation_mode: 'shared',
        translation_base_url: '',
        translation_model: '',
        translation_api_key: '',
        // MinerU
        mineru_mode: 'shared',
        mineru_api_url: '',
        mineru_api_key: '',
        mineru_self_hosted_url: '',
        // Embedding
        embedding_base_url: '',
        embedding_model: '',
        embedding_api_key: '',
        // 智能分析
        smart_analysis_mode: 'inherit',
        // Math
        smart_math_base_url: '',
        smart_math_model: '',
        smart_math_api_key: '',
        // Feynman
        smart_feynman_base_url: '',
        smart_feynman_model: '',
        smart_feynman_api_key: '',
        // Deep
        smart_deep_base_url: '',
        smart_deep_model: '',
        smart_deep_api_key: '',
        // Chat
        smart_chat_base_url: '',
        smart_chat_model: '',
        smart_chat_api_key: '',
        // 订阅系统
        subscription_enabled: true,
    });

    const [config, setConfig] = useState<SystemConfig | null>(null);
    const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
    const [expandSmartAnalysis, setExpandSmartAnalysis] = useState(false);

    // 用户列表
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [showCreateUser, setShowCreateUser] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', password: '', username: '', role: 'user' });
    const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUser | null>(null);
    const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
    const [newPassword, setNewPassword] = useState('');

    // Token 统计
    const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
    const [isLoadingTokenStats, setIsLoadingTokenStats] = useState(false);

    // 邀请码管理
    const [invitationCodes, setInvitationCodes] = useState<AdminInvitationCodeItem[]>([]);
    const [invitationStats, setInvitationStats] = useState<any>(null);
    const [isLoadingInvitations, setIsLoadingInvitations] = useState(false);
    const [showBatchCreate, setShowBatchCreate] = useState(false);
    const [batchCreateForm, setBatchCreateForm] = useState({
        count: 10,
        grant_plan: 'pro',
        grant_days: 30,
        expires_days: 30,
    });
    const [createdCodes, setCreatedCodes] = useState<string[]>([]);

    // 权限检查
    useEffect(() => {
        if (user && user.role !== 'admin') {
            navigate('/library');
        }
    }, [user, navigate]);

    // 加载数据
    useEffect(() => {
        if (user?.role === 'admin') {
            loadData();
        }
    }, [user, activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'config') {
                const configData = await adminApi.getConfig();
                setConfig(configData);
                setConfigForm({
                    llm_mode: configData.llm_mode || 'shared',
                    llm_base_url: configData.llm_base_url || '',
                    llm_model: configData.llm_model || '',
                    llm_api_key: '',
                    translation_mode: configData.translation_mode || 'shared',
                    translation_base_url: configData.translation_base_url || '',
                    translation_model: configData.translation_model || '',
                    translation_api_key: '',
                    mineru_mode: configData.mineru_mode || 'shared',
                    mineru_api_url: configData.mineru_api_url || '',
                    mineru_api_key: '',
                    mineru_self_hosted_url: configData.mineru_self_hosted_url || '',
                    embedding_base_url: configData.embedding_base_url || '',
                    embedding_model: configData.embedding_model || '',
                    embedding_api_key: '',
                    smart_analysis_mode: configData.smart_analysis_mode || 'inherit',
                    smart_math_base_url: configData.smart_math_base_url || '',
                    smart_math_model: configData.smart_math_model || '',
                    smart_math_api_key: '',
                    smart_feynman_base_url: configData.smart_feynman_base_url || '',
                    smart_feynman_model: configData.smart_feynman_model || '',
                    smart_feynman_api_key: '',
                    smart_deep_base_url: configData.smart_deep_base_url || '',
                    smart_deep_model: configData.smart_deep_model || '',
                    smart_deep_api_key: '',
                    smart_chat_base_url: configData.smart_chat_base_url || '',
                    smart_chat_model: configData.smart_chat_model || '',
                    smart_chat_api_key: '',
                    subscription_enabled: configData.subscription_enabled ?? true,
                });
            } else if (activeTab === 'users') {
                const usersData = await adminApi.listUsers();
                setUsers(usersData.items);
                setTotalUsers(usersData.total);
            } else if (activeTab === 'invitations') {
                await loadInvitationCodes();
            }
        } catch (error) {
            console.error('Failed to load data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadTokenStats = async () => {
        setIsLoadingTokenStats(true);
        try {
            const stats = await adminApi.getTokenStats();
            setTokenStats(stats);
        } catch (error) {
            console.error('Failed to load token stats:', error);
        } finally {
            setIsLoadingTokenStats(false);
        }
    };

    const handleResetTokenStats = async () => {
        if (!confirm('确定要重置 Token 统计？此操作不可恢复。')) return;
        try {
            await adminApi.resetTokenStats();
            await loadTokenStats();
        } catch (error) {
            console.error('Failed to reset token stats:', error);
        }
    };

    const loadInvitationCodes = async () => {
        setIsLoadingInvitations(true);
        try {
            const data = await adminApi.getInvitationCodes({ limit: 100 });
            setInvitationCodes(data.items);
            setInvitationStats(data.stats);
        } catch (error) {
            console.error('Failed to load invitation codes:', error);
        } finally {
            setIsLoadingInvitations(false);
        }
    };

    const handleBatchCreateCodes = async () => {
        try {
            const result = await adminApi.batchCreateInvitationCodes(batchCreateForm);
            setCreatedCodes(result.codes);
            await loadInvitationCodes();
        } catch (error) {
            console.error('Failed to create codes:', error);
            alert('生成失败');
        }
    };

    const handleDeleteCode = async (code: string) => {
        if (!confirm('确定要删除此邀请码？')) return;
        try {
            await adminApi.deleteInvitationCode(code);
            await loadInvitationCodes();
        } catch (error) {
            console.error('Failed to delete code:', error);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    // 加载 token 统计
    useEffect(() => {
        if (user?.role === 'admin' && activeTab === 'config') {
            loadTokenStats();
        }
    }, [user, activeTab]);


    const handleSaveConfig = async () => {
        setIsSaving(true);
        setSaveMessage('');
        try {
            const updates: Record<string, unknown> = {};
            // 关联 PaperDaily 时地址、Key、模式与嵌入由部署层（保险库）管理，网页只能改模型选择与开关
            const deploymentOnly = (key: string) => key.endsWith('_api_key') || key.endsWith('_url')
                || ['llm_mode', 'translation_mode', 'mineru_mode', 'embedding_provider', 'embedding_model', 'llm_extra_body'].includes(key);
            Object.entries(configForm).forEach(([key, value]) => {
                if (value !== '' && value !== undefined && !(isLinkedMode() && deploymentOnly(key))) {
                    updates[key] = value;
                }
            });
            await adminApi.updateConfig(updates);
            setSaveMessage(t('admin.configSaved'));
            await loadData();
        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            setSaveMessage(typeof detail === 'string' ? detail : t('admin.saveFailed'));
            console.error('Failed to save config:', error);
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(''), 3000);
        }
    };

    const handleCreateUser = async () => {
        try {
            await adminApi.createUser(newUser);
            setShowCreateUser(false);
            setNewUser({ email: '', password: '', username: '', role: 'user' });
            await loadData();
        } catch (error) {
            console.error('Failed to create user:', error);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        try {
            await adminApi.deleteUser(userId);
            setDeleteConfirmUser(null);
            await loadData();
        } catch (error) {
            console.error('Failed to delete user:', error);
        }
    };

    const handleResetPassword = async () => {
        if (!resetPasswordUser || !newPassword) return;
        try {
            await adminApi.resetPassword(resetPasswordUser.id, newPassword);
            setResetPasswordUser(null);
            setNewPassword('');
            alert(t('admin.userList.passwordReset'));
        } catch (error) {
            console.error('Failed to reset password:', error);
        }
    };

    const handleToggleUserActive = async (userId: string, currentActive: boolean) => {
        try {
            await adminApi.updateUser(userId, { is_active: !currentActive });
            await loadData();
        } catch (error) {
            console.error('Failed to update user:', error);
        }
    };

    const toggleShowKey = (key: string) => {
        setShowApiKeys({ ...showApiKeys, [key]: !showApiKeys[key] });
    };

    if (!user || user.role !== 'admin') {
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => navigate('/library')}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center">
                                    <Settings className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-slate-900">{t('admin.title')}</h1>
                                    <p className="text-sm text-slate-500">{t('admin.subtitle')}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="max-w-6xl mx-auto px-4 py-6">
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('config')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'config'
                            ? 'bg-purple-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <Server className="w-4 h-4" />
                        {t('admin.systemConfig')}
                    </button>
                    <button
                        onClick={() => setActiveTab('users')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'users'
                            ? 'bg-purple-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <Users className="w-4 h-4" />
                        {t('admin.userManagement')} ({totalUsers})
                    </button>
                    <button
                        onClick={() => setActiveTab('invitations')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'invitations'
                            ? 'bg-purple-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <Gift className="w-4 h-4" />
                        邀请码管理 {invitationStats ? `(${invitationStats.total})` : ''}
                    </button>
                    <button
                        onClick={() => setActiveTab('prompts')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'prompts'
                            ? 'bg-purple-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <MessageSquare className="w-4 h-4" />
                        提示词管理
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                    </div>
                ) : activeTab === 'config' ? (
                    <div className="space-y-6">
                        {isLinkedMode() && (
                            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 text-sm text-blue-800">
                                本站已关联 PaperDaily：模型地址、API Key 与嵌入配置由部署层（运维保险库）统一管理，这里的地址与 Key 不会生效；
                                管理员只能从部署允许的模型列表中为各任务选择模型。计费按篇在主站结算。
                            </div>
                        )}
                        {/* Token 用量统计 */}
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                                        <BarChart3 className="w-5 h-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900">{t('admin.tokenStats.title')}</h3>
                                        <p className="text-sm text-slate-500">{t('admin.tokenStats.subtitle')}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={loadTokenStats}
                                        disabled={isLoadingTokenStats}
                                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                        title={t('admin.tokenStats.refresh')}
                                    >
                                        <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoadingTokenStats ? 'animate-spin' : ''}`} />
                                    </button>
                                    <button
                                        onClick={handleResetTokenStats}
                                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        {t('admin.tokenStats.reset')}
                                    </button>
                                </div>
                            </div>

                            {isLoadingTokenStats && !tokenStats ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                                </div>
                            ) : tokenStats ? (
                                <div className="space-y-4">
                                    {/* 总计 */}
                                    <div className="grid grid-cols-4 gap-4">
                                        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-4 border border-amber-100">
                                            <div className="text-2xl font-bold text-amber-700">
                                                {(tokenStats.total_tokens / 1000).toFixed(1)}K
                                            </div>
                                            <div className="text-sm text-amber-600">{t('admin.tokenStats.totalTokens')}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                            <div className="text-xl font-bold text-slate-700">
                                                {(tokenStats.total_prompt_tokens / 1000).toFixed(1)}K
                                            </div>
                                            <div className="text-sm text-slate-500">{t('admin.tokenStats.inputTokens')}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                            <div className="text-xl font-bold text-slate-700">
                                                {(tokenStats.total_completion_tokens / 1000).toFixed(1)}K
                                            </div>
                                            <div className="text-sm text-slate-500">{t('admin.tokenStats.outputTokens')}</div>
                                        </div>
                                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                            <div className="text-xl font-bold text-slate-700">
                                                {tokenStats.calls_count}
                                            </div>
                                            <div className="text-sm text-slate-500">{t('admin.tokenStats.callCount')}</div>
                                        </div>
                                    </div>

                                    {/* 按功能分类 */}
                                    {Object.keys(tokenStats.by_function).length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-medium text-slate-600 mb-2">{t('admin.tokenStats.byFunction')}</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(tokenStats.by_function).map(([func, stats]) => (
                                                    <div key={func} className="px-3 py-2 bg-slate-100 rounded-lg text-sm">
                                                        <span className="font-medium text-slate-700">{func}</span>
                                                        <span className="text-slate-500 ml-2">
                                                            {(stats.total_tokens / 1000).toFixed(1)}K ({stats.calls_count}次)
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-400">{t('admin.tokenStats.noData')}</div>
                            )}
                        </div>

                        {/* 订阅功能开关 */}
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                                        <Shield className="w-5 h-5 text-emerald-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900">{t('admin.subscription.title')}</h3>
                                        <p className="text-sm text-slate-500">{t('admin.subscription.subtitle')}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className={`text-sm font-medium ${configForm.subscription_enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {configForm.subscription_enabled ? t('admin.subscription.enabled') : t('admin.subscription.disabled')}
                                    </span>
                                    <button
                                        onClick={() => setConfigForm({ ...configForm, subscription_enabled: !configForm.subscription_enabled })}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${configForm.subscription_enabled ? 'bg-emerald-500' : 'bg-slate-200'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${configForm.subscription_enabled ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                        />
                                    </button>
                                </div>
                            </div>
                            <div className={`mt-4 p-3 rounded-lg text-sm ${configForm.subscription_enabled
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                    : 'bg-amber-50 text-amber-700 border border-amber-100'
                                }`}>
                                {configForm.subscription_enabled
                                    ? t('admin.subscription.enabledDescription')
                                    : t('admin.subscription.disabledDescription')
                                }
                            </div>
                        </div>

                        {/* 主 LLM 配置 */}
                        <ConfigCard
                            title="主 LLM 配置"
                            icon={<Brain className="w-5 h-5 text-blue-600" />}
                            iconBg="bg-blue-100"
                            description="核心大语言模型 API 设置"
                        >
                            <ModeSelect
                                value={configForm.llm_mode}
                                onChange={(v) => setConfigForm({ ...configForm, llm_mode: v })}
                                options={[
                                    { value: 'shared', label: '全局共享 - 所有用户使用系统配置' },
                                    { value: 'user_defined', label: '允许用户自定义 - 用户可提供自己的配置' },
                                ]}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                                    <input
                                        type="text"
                                        value={configForm.llm_base_url}
                                        onChange={(e) => setConfigForm({ ...configForm, llm_base_url: e.target.value })}
                                        placeholder="http://localhost:8000/v1"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">模型</label>
                                    <input
                                        type="text"
                                        value={configForm.llm_model}
                                        onChange={(e) => setConfigForm({ ...configForm, llm_model: e.target.value })}
                                        placeholder="qwen2.5-72b"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                            </div>
                            <ApiKeyInput
                                label="API Key"
                                value={configForm.llm_api_key}
                                isSet={config?.llm_api_key_set}
                                onChange={(v) => setConfigForm({ ...configForm, llm_api_key: v })}
                                showKey={showApiKeys.llm || false}
                                onToggleShow={() => toggleShowKey('llm')}
                            />
                        </ConfigCard>

                        {/* 翻译 LLM 配置 */}
                        <ConfigCard
                            title="翻译 LLM 配置"
                            icon={<Languages className="w-5 h-5 text-green-600" />}
                            iconBg="bg-green-100"
                            description="论文翻译服务（留空则使用主 LLM）"
                        >
                            <ModeSelect
                                value={configForm.translation_mode}
                                onChange={(v) => setConfigForm({ ...configForm, translation_mode: v })}
                                options={[
                                    { value: 'shared', label: '全局共享' },
                                    { value: 'user_defined', label: '允许用户自定义' },
                                    { value: 'disabled', label: '禁用翻译功能' },
                                ]}
                            />
                            {configForm.translation_mode !== 'disabled' && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                                            <input
                                                type="text"
                                                value={configForm.translation_base_url}
                                                onChange={(e) => setConfigForm({ ...configForm, translation_base_url: e.target.value })}
                                                placeholder="留空使用主 LLM"
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">模型</label>
                                            <input
                                                type="text"
                                                value={configForm.translation_model}
                                                onChange={(e) => setConfigForm({ ...configForm, translation_model: e.target.value })}
                                                placeholder="留空使用主 LLM"
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                    </div>
                                    <ApiKeyInput
                                        label="API Key"
                                        value={configForm.translation_api_key}
                                        isSet={config?.translation_api_key_set}
                                        onChange={(v) => setConfigForm({ ...configForm, translation_api_key: v })}
                                        showKey={showApiKeys.translation || false}
                                        onToggleShow={() => toggleShowKey('translation')}
                                    />
                                </>
                            )}
                        </ConfigCard>

                        {/* MinerU 配置 */}
                        <ConfigCard
                            title="MinerU 配置"
                            icon={<FileText className="w-5 h-5 text-orange-600" />}
                            iconBg="bg-orange-100"
                            description="PDF 解析服务"
                        >
                            <ModeSelect
                                value={configForm.mineru_mode}
                                onChange={(v) => setConfigForm({ ...configForm, mineru_mode: v })}
                                options={[
                                    { value: 'shared', label: '全局共享' },
                                    { value: 'user_defined', label: '允许用户自定义' },
                                    { value: 'self_hosted', label: '使用自部署服务' },
                                ]}
                            />
                            {configForm.mineru_mode === 'self_hosted' ? (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">自部署 URL</label>
                                    <input
                                        type="text"
                                        value={configForm.mineru_self_hosted_url}
                                        onChange={(e) => setConfigForm({ ...configForm, mineru_self_hosted_url: e.target.value })}
                                        placeholder="http://your-mineru-service:8080"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">API URL</label>
                                        <input
                                            type="text"
                                            value={configForm.mineru_api_url}
                                            onChange={(e) => setConfigForm({ ...configForm, mineru_api_url: e.target.value })}
                                            placeholder="https://mineru.net/api/v4"
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                    </div>
                                    <ApiKeyInput
                                        label="API Key"
                                        value={configForm.mineru_api_key}
                                        isSet={config?.mineru_api_key_set}
                                        onChange={(v) => setConfigForm({ ...configForm, mineru_api_key: v })}
                                        showKey={showApiKeys.mineru || false}
                                        onToggleShow={() => toggleShowKey('mineru')}
                                    />
                                </>
                            )}
                        </ConfigCard>

                        {/* Embedding 配置 (全局只读) */}
                        <ConfigCard
                            title="Embedding 配置"
                            icon={<Key className="w-5 h-5 text-purple-600" />}
                            iconBg="bg-purple-100"
                            description="向量嵌入服务（全局固定，用户不可修改）"
                        >
                            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
                                ⚠️ Embedding 配置为全局固定，所有用户共享，不支持用户自定义
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                                    <input
                                        type="text"
                                        value={configForm.embedding_base_url}
                                        onChange={(e) => setConfigForm({ ...configForm, embedding_base_url: e.target.value })}
                                        placeholder="http://localhost:8000/v1"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">模型</label>
                                    <input
                                        type="text"
                                        value={configForm.embedding_model}
                                        onChange={(e) => setConfigForm({ ...configForm, embedding_model: e.target.value })}
                                        placeholder="bge-m3"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                            </div>
                        </ConfigCard>

                        {/* 智能分析配置 */}
                        <ConfigCard
                            title="智能分析配置"
                            icon={<Sparkles className="w-5 h-5 text-indigo-600" />}
                            iconBg="bg-indigo-100"
                            description="Math 解析、费曼教学、深度研究、Chat with PDF"
                        >
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="smart_mode"
                                        checked={configForm.smart_analysis_mode === 'inherit'}
                                        onChange={() => setConfigForm({ ...configForm, smart_analysis_mode: 'inherit' })}
                                        className="w-4 h-4 text-purple-600"
                                    />
                                    <span className="text-sm text-slate-700">继承主 LLM 配置</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="smart_mode"
                                        checked={configForm.smart_analysis_mode === 'custom'}
                                        onChange={() => setConfigForm({ ...configForm, smart_analysis_mode: 'custom' })}
                                        className="w-4 h-4 text-purple-600"
                                    />
                                    <span className="text-sm text-slate-700">独立配置每个功能</span>
                                </label>
                            </div>

                            {configForm.smart_analysis_mode === 'custom' && (
                                <div className="space-y-4 mt-4 pt-4 border-t border-slate-200">
                                    <button
                                        onClick={() => setExpandSmartAnalysis(!expandSmartAnalysis)}
                                        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-purple-600"
                                    >
                                        {expandSmartAnalysis ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        展开独立配置
                                    </button>

                                    {expandSmartAnalysis && (
                                        <div className="space-y-6">
                                            {/* Math 解析 */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">📐 Math 解析</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_math_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_base_url: e.target.value })}
                                                        placeholder="Base URL"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_math_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_model: e.target.value })}
                                                        placeholder="Model"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="password"
                                                        value={configForm.smart_math_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_api_key: e.target.value })}
                                                        placeholder="API Key"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                </div>
                                            </div>

                                            {/* 费曼教学 */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">🎓 费曼教学</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_feynman_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_base_url: e.target.value })}
                                                        placeholder="Base URL"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_feynman_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_model: e.target.value })}
                                                        placeholder="Model"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="password"
                                                        value={configForm.smart_feynman_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_api_key: e.target.value })}
                                                        placeholder="API Key"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                </div>
                                            </div>

                                            {/* 深度研究 */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">🔬 深度研究</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_deep_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_base_url: e.target.value })}
                                                        placeholder="Base URL"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_deep_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_model: e.target.value })}
                                                        placeholder="Model"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="password"
                                                        value={configForm.smart_deep_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_api_key: e.target.value })}
                                                        placeholder="API Key"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                </div>
                                            </div>

                                            {/* Chat with PDF */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">💬 Chat with PDF</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_chat_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_base_url: e.target.value })}
                                                        placeholder="Base URL"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={configForm.smart_chat_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_model: e.target.value })}
                                                        placeholder="Model"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                    <input
                                                        type="password"
                                                        value={configForm.smart_chat_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_api_key: e.target.value })}
                                                        placeholder="API Key"
                                                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </ConfigCard>

                        {/* 保存按钮 */}
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleSaveConfig}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                保存配置
                            </button>
                            {saveMessage && (
                                <span className={`text-sm ${saveMessage.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>
                                    {saveMessage}
                                </span>
                            )}
                        </div>
                    </div>
                ) : activeTab === 'users' ? (
                    /* 用户管理 */
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-semibold text-slate-900">用户列表</h3>
                            <button
                                onClick={() => setShowCreateUser(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                创建用户
                            </button>
                        </div>

                        {showCreateUser && (
                            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                                <h4 className="font-medium text-slate-900 mb-4">创建新用户</h4>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <input type="email" placeholder="邮箱" value={newUser.email}
                                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                        className="px-3 py-2 border border-slate-200 rounded-lg" />
                                    <input type="password" placeholder="密码" value={newUser.password}
                                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                        className="px-3 py-2 border border-slate-200 rounded-lg" />
                                    <input type="text" placeholder="用户名 (可选)" value={newUser.username}
                                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                        className="px-3 py-2 border border-slate-200 rounded-lg" />
                                    <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                                        className="px-3 py-2 border border-slate-200 rounded-lg">
                                        <option value="user">普通用户</option>
                                        <option value="admin">管理员</option>
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleCreateUser} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">创建</button>
                                    <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300">取消</button>
                                </div>
                            </div>
                        )}

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">用户</th>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">角色</th>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">状态</th>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">创建时间</th>
                                        <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((u) => (
                                        <tr key={u.id} className="border-b border-slate-100 last:border-0">
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-slate-900">{u.username || u.email.split('@')[0]}</div>
                                                <div className="text-sm text-slate-500">{u.email}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {u.role === 'admin' ? <Shield className="w-3 h-3" /> : <UserCog className="w-3 h-3" />}
                                                    {u.role === 'admin' ? '管理员' : '用户'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <button onClick={() => handleToggleUserActive(u.id, u.is_active)} disabled={u.id === user?.id}
                                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} ${u.id === user?.id ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-80'}`}>
                                                    {u.is_active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                                    {u.is_active ? '正常' : '已禁用'}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-500">
                                                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {u.id !== user?.id && (
                                                        <>
                                                            <button onClick={() => setResetPasswordUser(u)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="重置密码">
                                                                <Lock className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => setDeleteConfirmUser(u)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="删除用户">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : activeTab === 'invitations' ? (
                    <div className="space-y-6">
                        {/* 邀请码统计 */}
                        {invitationStats && (
                            <div className="grid grid-cols-4 gap-4">
                                <div className="bg-white rounded-xl p-4 border border-slate-200">
                                    <div className="text-2xl font-bold text-slate-700">{invitationStats.total}</div>
                                    <div className="text-sm text-slate-500">总邀请码</div>
                                </div>
                                <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                                    <div className="text-2xl font-bold text-green-700">{invitationStats.active}</div>
                                    <div className="text-sm text-green-600">可用</div>
                                </div>
                                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                                    <div className="text-2xl font-bold text-blue-700">{invitationStats.used}</div>
                                    <div className="text-sm text-blue-600">已使用</div>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                    <div className="text-2xl font-bold text-slate-500">{invitationStats.expired}</div>
                                    <div className="text-sm text-slate-500">已过期</div>
                                </div>
                            </div>
                        )}

                        {/* 批量生成 */}
                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <Gift className="w-5 h-5 text-purple-600" />
                                    批量生成邀请码
                                </h3>
                                <button
                                    onClick={() => setShowBatchCreate(!showBatchCreate)}
                                    className="text-sm text-purple-600 hover:text-purple-700"
                                >
                                    {showBatchCreate ? '收起' : '展开'}
                                </button>
                            </div>

                            {showBatchCreate && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-4 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">生成数量</label>
                                            <input
                                                type="number"
                                                value={batchCreateForm.count}
                                                onChange={(e) => setBatchCreateForm({ ...batchCreateForm, count: parseInt(e.target.value) || 1 })}
                                                min={1}
                                                max={100}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">授予计划</label>
                                            <select
                                                value={batchCreateForm.grant_plan}
                                                onChange={(e) => setBatchCreateForm({ ...batchCreateForm, grant_plan: e.target.value })}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                                            >
                                                <option value="pro">Pro</option>
                                                <option value="ultra">Ultra</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">授予天数</label>
                                            <input
                                                type="number"
                                                value={batchCreateForm.grant_days}
                                                onChange={(e) => setBatchCreateForm({ ...batchCreateForm, grant_days: parseInt(e.target.value) || 30 })}
                                                min={1}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">邀请码有效期(天)</label>
                                            <input
                                                type="number"
                                                value={batchCreateForm.expires_days}
                                                onChange={(e) => setBatchCreateForm({ ...batchCreateForm, expires_days: parseInt(e.target.value) || 30 })}
                                                min={1}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleBatchCreateCodes}
                                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                                    >
                                        生成邀请码
                                    </button>

                                    {/* 显示生成的邀请码 */}
                                    {createdCodes.length > 0 && (
                                        <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-green-700">已生成 {createdCodes.length} 个邀请码</span>
                                                <button
                                                    onClick={() => copyToClipboard(createdCodes.join('\n'))}
                                                    className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
                                                >
                                                    <Copy className="w-4 h-4" /> 复制全部
                                                </button>
                                            </div>
                                            <div className="max-h-40 overflow-y-auto font-mono text-sm text-green-800">
                                                {createdCodes.map((code, i) => (
                                                    <div key={i} className="py-1">{code}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 邀请码列表 */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">邀请码</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">计划</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">天数</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">状态</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">创建者</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">使用者</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">创建时间</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {isLoadingInvitations ? (
                                            <tr>
                                                <td colSpan={8} className="px-4 py-8 text-center">
                                                    <Loader2 className="w-6 h-6 animate-spin text-purple-600 mx-auto" />
                                                </td>
                                            </tr>
                                        ) : invitationCodes.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                                                    暂无邀请码
                                                </td>
                                            </tr>
                                        ) : invitationCodes.map((code) => (
                                            <tr key={code.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-mono text-sm text-slate-900">
                                                    <div className="flex items-center gap-2">
                                                        {code.code}
                                                        <button
                                                            onClick={() => copyToClipboard(code.code)}
                                                            className="text-slate-400 hover:text-slate-600"
                                                            title="复制"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${code.grant_plan === 'ultra'
                                                        ? 'bg-purple-100 text-purple-700'
                                                        : 'bg-blue-100 text-blue-700'
                                                        }`}>
                                                        {code.grant_plan.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600">{code.grant_days}天</td>
                                                <td className="px-4 py-3">
                                                    {code.is_used ? (
                                                        <span className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-600">已使用</span>
                                                    ) : code.is_expired ? (
                                                        <span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-600">已过期</span>
                                                    ) : !code.is_active ? (
                                                        <span className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-500">已禁用</span>
                                                    ) : (
                                                        <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">可用</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600">{code.creator_email || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-slate-600">{code.used_by_email || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-slate-500">
                                                    {new Date(code.created_at).toLocaleDateString()}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {!code.is_used && code.is_active && (
                                                        <button
                                                            onClick={() => handleDeleteCode(code.code)}
                                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                                            title="删除"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : activeTab === 'prompts' ? (
                    <PromptManagement
                        onMessage={(msg) => {
                            setSaveMessage(msg);
                            setTimeout(() => setSaveMessage(''), 3000);
                        }}
                    />
                ) : null}
            </div>

            {/* 删除确认弹窗 */}
            {deleteConfirmUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-xl p-6 shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">确认删除</h3>
                        <p className="text-slate-600 mb-4">确定要删除用户 <strong>{deleteConfirmUser.email}</strong> 吗？</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setDeleteConfirmUser(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={() => handleDeleteUser(deleteConfirmUser.id)} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">确认删除</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 密码重置弹窗 */}
            {resetPasswordUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-xl p-6 shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">重置密码</h3>
                        <p className="text-slate-600 mb-4">为用户 <strong>{resetPasswordUser.email}</strong> 设置新密码</p>
                        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="输入新密码" className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-4" />
                        <div className="flex justify-end gap-3">
                            <button onClick={() => { setResetPasswordUser(null); setNewPassword(''); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={handleResetPassword} disabled={!newPassword} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">确认重置</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
