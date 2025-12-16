/**
 * Read it DEEP - 用户设置页面
 * 
 * 完整细粒度 API 配置
 */

import { useEffect, useState } from 'react';
import { authApi, type UserConfigUpdate, type UserConfigResponse } from '../lib/api';
import {
    Key, Save, AlertCircle, CheckCircle, ArrowLeft, Brain,
    Languages, FileText, Sparkles, ChevronDown, ChevronRight,
    Eye, EyeOff, Info
} from 'lucide-react';
import { Link } from 'react-router-dom';

// 配置卡片组件
interface ConfigCardProps {
    title: string;
    icon: React.ReactNode;
    iconBg: string;
    description: string;
    mode: string;
    modeLabel: string;
    systemHasKey: boolean;
    children: React.ReactNode;
}

function ConfigCard({ title, icon, iconBg, description, mode, modeLabel, systemHasKey, children }: ConfigCardProps) {
    const showUserForm = mode === 'user_defined';

    return (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}>
                        {icon}
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">{title}</h3>
                        <p className="text-sm text-slate-500">{description}</p>
                    </div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${mode === 'shared' ? 'bg-green-100 text-green-700' :
                        mode === 'user_defined' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                    }`}>
                    {modeLabel}
                </span>
            </div>

            {mode === 'shared' && (
                <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                    <Info className="w-4 h-4" />
                    {systemHasKey ? '使用系统共享配置（管理员已配置）' : '系统共享模式但管理员未配置'}
                </div>
            )}

            {mode === 'disabled' && (
                <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4" />
                    此功能已被管理员禁用
                </div>
            )}

            {showUserForm && (
                <div className="space-y-4 mt-4 pt-4 border-t border-slate-200">
                    {systemHasKey && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            系统已提供共享配置，您可以选择覆盖
                        </p>
                    )}
                    {children}
                </div>
            )}
        </div>
    );
}

// API Key 输入组件
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
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
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

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
    const [expandSmartAnalysis, setExpandSmartAnalysis] = useState(false);

    const [serverConfig, setServerConfig] = useState<UserConfigResponse | null>(null);
    const [configForm, setConfigForm] = useState<UserConfigUpdate>({
        llm_base_url: '',
        llm_model: '',
        llm_api_key: '',
        translation_base_url: '',
        translation_model: '',
        translation_api_key: '',
        mineru_api_url: '',
        mineru_api_key: '',
        smart_analysis_mode: 'inherit',
        smart_math_base_url: '',
        smart_math_model: '',
        smart_math_api_key: '',
        smart_feynman_base_url: '',
        smart_feynman_model: '',
        smart_feynman_api_key: '',
        smart_deep_base_url: '',
        smart_deep_model: '',
        smart_deep_api_key: '',
        smart_chat_base_url: '',
        smart_chat_model: '',
        smart_chat_api_key: '',
    });

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            setLoading(true);
            const data = await authApi.getUserConfig();
            setServerConfig(data);
            setConfigForm({
                llm_base_url: data.llm_base_url || '',
                llm_model: data.llm_model || '',
                llm_api_key: '',
                translation_base_url: data.translation_base_url || '',
                translation_model: data.translation_model || '',
                translation_api_key: '',
                mineru_api_url: data.mineru_api_url || '',
                mineru_api_key: '',
                smart_analysis_mode: data.smart_analysis_mode || 'inherit',
                smart_math_base_url: data.smart_math_base_url || '',
                smart_math_model: data.smart_math_model || '',
                smart_math_api_key: '',
                smart_feynman_base_url: data.smart_feynman_base_url || '',
                smart_feynman_model: data.smart_feynman_model || '',
                smart_feynman_api_key: '',
                smart_deep_base_url: data.smart_deep_base_url || '',
                smart_deep_model: data.smart_deep_model || '',
                smart_deep_api_key: '',
                smart_chat_base_url: data.smart_chat_base_url || '',
                smart_chat_model: data.smart_chat_model || '',
                smart_chat_api_key: '',
            });
        } catch (error) {
            console.error('Failed to load config', error);
            setMessage({ type: 'error', text: '加载配置失败' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSaving(true);
            setMessage(null);
            // 只发送有值的字段
            const updates: Record<string, string> = {};
            Object.entries(configForm).forEach(([key, value]) => {
                if (value !== '' && value !== undefined) {
                    updates[key] = value;
                }
            });
            await authApi.updateUserConfig(updates as UserConfigUpdate);
            await loadConfig();
            setMessage({ type: 'success', text: '配置已保存' });
        } catch (error) {
            console.error('Failed to save config', error);
            setMessage({ type: 'error', text: '保存失败' });
        } finally {
            setSaving(false);
        }
    };

    const toggleShowKey = (key: string) => {
        setShowApiKeys({ ...showApiKeys, [key]: !showApiKeys[key] });
    };

    const getModeLabel = (mode: string) => {
        switch (mode) {
            case 'shared': return '系统共享';
            case 'user_defined': return '用户自定义';
            case 'disabled': return '已禁用';
            default: return mode;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
                    <Link to="/library" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                            <Key className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">个人设置</h1>
                            <p className="text-sm text-slate-500">管理您的 API 配置</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-6">
                {message && (
                    <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                        {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        {message.text}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                    </div>
                ) : serverConfig && (
                    <form onSubmit={handleSave} className="space-y-6">
                        {/* 主 LLM */}
                        <ConfigCard
                            title="主 LLM 配置"
                            icon={<Brain className="w-5 h-5 text-blue-600" />}
                            iconBg="bg-blue-100"
                            description="核心 AI 分析功能"
                            mode={serverConfig.llm_mode}
                            modeLabel={getModeLabel(serverConfig.llm_mode)}
                            systemHasKey={serverConfig.system_has_llm_key}
                        >
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                                    <input
                                        type="text"
                                        value={configForm.llm_base_url}
                                        onChange={(e) => setConfigForm({ ...configForm, llm_base_url: e.target.value })}
                                        placeholder="http://localhost:8000/v1"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">模型</label>
                                    <input
                                        type="text"
                                        value={configForm.llm_model}
                                        onChange={(e) => setConfigForm({ ...configForm, llm_model: e.target.value })}
                                        placeholder="qwen2.5-72b"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <ApiKeyInput
                                label="API Key"
                                value={configForm.llm_api_key || ''}
                                isSet={serverConfig.llm_api_key_set}
                                onChange={(v) => setConfigForm({ ...configForm, llm_api_key: v })}
                                showKey={showApiKeys.llm || false}
                                onToggleShow={() => toggleShowKey('llm')}
                            />
                        </ConfigCard>

                        {/* 翻译 LLM */}
                        <ConfigCard
                            title="翻译服务配置"
                            icon={<Languages className="w-5 h-5 text-green-600" />}
                            iconBg="bg-green-100"
                            description="论文翻译功能"
                            mode={serverConfig.translation_mode}
                            modeLabel={getModeLabel(serverConfig.translation_mode)}
                            systemHasKey={serverConfig.system_has_translation_key}
                        >
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                                    <input
                                        type="text"
                                        value={configForm.translation_base_url}
                                        onChange={(e) => setConfigForm({ ...configForm, translation_base_url: e.target.value })}
                                        placeholder="留空使用主 LLM"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">模型</label>
                                    <input
                                        type="text"
                                        value={configForm.translation_model}
                                        onChange={(e) => setConfigForm({ ...configForm, translation_model: e.target.value })}
                                        placeholder="留空使用主 LLM"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <ApiKeyInput
                                label="API Key"
                                value={configForm.translation_api_key || ''}
                                isSet={serverConfig.translation_api_key_set}
                                onChange={(v) => setConfigForm({ ...configForm, translation_api_key: v })}
                                showKey={showApiKeys.translation || false}
                                onToggleShow={() => toggleShowKey('translation')}
                            />
                        </ConfigCard>

                        {/* MinerU */}
                        <ConfigCard
                            title="MinerU 配置"
                            icon={<FileText className="w-5 h-5 text-orange-600" />}
                            iconBg="bg-orange-100"
                            description="PDF 解析服务"
                            mode={serverConfig.mineru_mode}
                            modeLabel={getModeLabel(serverConfig.mineru_mode)}
                            systemHasKey={serverConfig.system_has_mineru_key}
                        >
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">API URL</label>
                                <input
                                    type="text"
                                    value={configForm.mineru_api_url}
                                    onChange={(e) => setConfigForm({ ...configForm, mineru_api_url: e.target.value })}
                                    placeholder="https://mineru.net/api/v4"
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <ApiKeyInput
                                label="API Key"
                                value={configForm.mineru_api_key || ''}
                                isSet={serverConfig.mineru_api_key_set}
                                onChange={(v) => setConfigForm({ ...configForm, mineru_api_key: v })}
                                showKey={showApiKeys.mineru || false}
                                onToggleShow={() => toggleShowKey('mineru')}
                            />
                        </ConfigCard>

                        {/* 智能分析 */}
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-indigo-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">智能分析配置</h3>
                                    <p className="text-sm text-slate-500">Math 解析、费曼教学、深度研究、Chat with PDF</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 mb-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="smart_mode"
                                        checked={configForm.smart_analysis_mode === 'inherit'}
                                        onChange={() => setConfigForm({ ...configForm, smart_analysis_mode: 'inherit' })}
                                        className="w-4 h-4 text-blue-600"
                                    />
                                    <span className="text-sm text-slate-700">继承主 LLM 配置</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="smart_mode"
                                        checked={configForm.smart_analysis_mode === 'custom'}
                                        onChange={() => setConfigForm({ ...configForm, smart_analysis_mode: 'custom' })}
                                        className="w-4 h-4 text-blue-600"
                                    />
                                    <span className="text-sm text-slate-700">独立配置每个功能</span>
                                </label>
                            </div>

                            {configForm.smart_analysis_mode === 'custom' && (
                                <div className="space-y-4 pt-4 border-t border-slate-200">
                                    <button
                                        type="button"
                                        onClick={() => setExpandSmartAnalysis(!expandSmartAnalysis)}
                                        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-blue-600"
                                    >
                                        {expandSmartAnalysis ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        展开独立配置
                                    </button>

                                    {expandSmartAnalysis && (
                                        <div className="space-y-4">
                                            {/* Math */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">📐 Math 解析</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input type="text" value={configForm.smart_math_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_base_url: e.target.value })}
                                                        placeholder="Base URL" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="text" value={configForm.smart_math_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_model: e.target.value })}
                                                        placeholder="Model" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="password" value={configForm.smart_math_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_math_api_key: e.target.value })}
                                                        placeholder="API Key" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                </div>
                                            </div>
                                            {/* Feynman */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">🎓 费曼教学</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input type="text" value={configForm.smart_feynman_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_base_url: e.target.value })}
                                                        placeholder="Base URL" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="text" value={configForm.smart_feynman_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_model: e.target.value })}
                                                        placeholder="Model" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="password" value={configForm.smart_feynman_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_feynman_api_key: e.target.value })}
                                                        placeholder="API Key" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                </div>
                                            </div>
                                            {/* Deep */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">🔬 深度研究</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input type="text" value={configForm.smart_deep_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_base_url: e.target.value })}
                                                        placeholder="Base URL" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="text" value={configForm.smart_deep_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_model: e.target.value })}
                                                        placeholder="Model" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="password" value={configForm.smart_deep_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_deep_api_key: e.target.value })}
                                                        placeholder="API Key" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                </div>
                                            </div>
                                            {/* Chat */}
                                            <div className="bg-slate-50 rounded-lg p-4">
                                                <h4 className="font-medium text-slate-800 mb-3">💬 Chat with PDF</h4>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input type="text" value={configForm.smart_chat_base_url}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_base_url: e.target.value })}
                                                        placeholder="Base URL" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="text" value={configForm.smart_chat_model}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_model: e.target.value })}
                                                        placeholder="Model" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                    <input type="password" value={configForm.smart_chat_api_key}
                                                        onChange={(e) => setConfigForm({ ...configForm, smart_chat_api_key: e.target.value })}
                                                        placeholder="API Key" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 保存按钮 */}
                        <div className="flex items-center gap-4">
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                <Save className="w-4 h-4" />
                                {saving ? '保存中...' : '保存配置'}
                            </button>
                        </div>
                    </form>
                )}
            </main>
        </div>
    );
}
