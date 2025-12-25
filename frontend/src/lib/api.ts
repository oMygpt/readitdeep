/**
 * Read it DEEP - API 客户端
 */

import axios from 'axios';

const TOKEN_KEY = 'readitdeep_token';

export const api = axios.create({
    baseURL: '/api/v1',
    timeout: 120000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// 请求拦截器：添加认证 token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem(TOKEN_KEY);
        console.log('[DEBUG] Interceptor URL:', config.url, 'Token:', token ? 'Found' : 'Missing');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// 响应拦截器：处理 401 未授权
api.interceptors.response.use(
    (response) => response,
    (error) => {
        console.log('[DEBUG] API Error Status:', error.response?.status, 'URL:', error.config?.url);
        if (error.response?.status === 401) {
            // Token 无效，清除并跳转登录
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem('readitdeep_refresh_token');
            // 如果不在登录页，跳转
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

// API 类型定义

// 分享团队信息
export interface SharedTeamInfo {
    id: string;
    name: string;
    shared_at?: string;
}

export interface Paper {
    id: string;
    filename: string;
    title?: string;
    category?: string;
    status: 'uploading' | 'parsing' | 'indexing' | 'completed' | 'failed' | 'analyzed';
    created_at: string;
    updated_at?: string;
    markdown_content?: string;
    translated_content?: string;
    summary?: string;
    // Classification fields
    tags?: string[];
    suggested_tags?: string[];
    tags_confirmed?: boolean;
    doi?: string;
    arxiv_id?: string;
    // Team sharing info
    shared_teams?: SharedTeamInfo[];
}

export interface TaskStatus {
    id: string;
    status: string;
    progress: number;
    message: string;
    updated_at: string;
}

export interface LibraryResponse {
    total: number;
    items: Paper[];
}

// API 方法
export const papersApi = {
    upload: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const { data } = await api.post('/papers/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
    },

    get: async (id: string): Promise<Paper> => {
        const { data } = await api.get(`/papers/${id}`);
        return data;
    },

    getContent: async (id: string) => {
        const { data } = await api.get(`/papers/${id}/content`);
        return data;
    },

    updateTags: async (id: string, tags: string[]): Promise<{ message: string; tags: string[] }> => {
        const { data } = await api.put(`/papers/${id}/tags`, { tags });
        return data;
    },
};

export const libraryApi = {
    list: async (params?: {
        page?: number;
        page_size?: number;
        search?: string;
        category?: string;
        status?: string;
    }): Promise<LibraryResponse> => {
        const { data } = await api.get('/library/', { params });
        return data;
    },

    delete: async (id: string) => {
        const { data } = await api.delete(`/library/${id}`);
        return data;
    },

    getCategories: async () => {
        const { data } = await api.get('/library/categories');
        return data;
    },

    renameCategory: async (oldName: string, newName: string): Promise<{ success: boolean; papers_updated: number }> => {
        const { data } = await api.put('/library/categories/rename', { old_name: oldName, new_name: newName });
        return data;
    },

    deleteCategory: async (categoryName: string): Promise<{ success: boolean; papers_updated: number }> => {
        const { data } = await api.delete(`/library/categories/${encodeURIComponent(categoryName)}`);
        return data;
    },
};

export const monitorApi = {
    getStatus: async (id: string): Promise<TaskStatus> => {
        const { data } = await api.get(`/monitor/${id}`);
        return data;
    },

    getActiveTasks: async () => {
        const { data } = await api.get('/monitor');
        return data;
    },

    /**
     * SSE 实时进度流
     * 
     * 用法:
     * ```typescript
     * const cleanup = monitorApi.streamStatus(paperId, {
     *   onProgress: (data) => console.log(data.status, data.progress),
     *   onDone: () => console.log('Completed'),
     *   onError: (err) => console.error(err),
     * });
     * // 清理时调用
     * cleanup();
     * ```
     */
    streamStatus: (
        paperId: string,
        callbacks: {
            onProgress?: (data: { status: string; progress: number; message: string }) => void;
            onDone?: (finalStatus: string) => void;
            onError?: (error: string) => void;
        }
    ): (() => void) => {
        const eventSource = new EventSource(`/api/v1/monitor/${paperId}/stream`);

        eventSource.addEventListener('progress', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                callbacks.onProgress?.(data);
            } catch (err) {
                console.error('Failed to parse progress event:', err);
            }
        });

        eventSource.addEventListener('done', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                callbacks.onDone?.(data.final_status);
            } catch {
                callbacks.onDone?.('completed');
            }
            eventSource.close();
        });

        eventSource.addEventListener('error', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                callbacks.onError?.(data.error);
            } catch {
                callbacks.onError?.('Connection error');
            }
            eventSource.close();
        });

        eventSource.addEventListener('timeout', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                callbacks.onError?.(data.error);
            } catch {
                callbacks.onError?.('Timeout');
            }
            eventSource.close();
        });

        // EventSource 连接错误处理
        eventSource.onerror = () => {
            callbacks.onError?.('SSE connection failed');
            eventSource.close();
        };

        // 返回清理函数
        return () => {
            eventSource.close();
        };
    },
};

// Analysis API Types
export interface TextLocation {
    start_line: number;
    end_line: number;
    text_snippet: string;
}

export interface MethodItem {
    name: string;
    category?: string;  // core/model_setup/baseline/evaluation/preprocessing
    description: string;
    location?: TextLocation;
}

export interface DatasetItem {
    name: string;
    url?: string;
    description: string;
    usage?: string;  // How the dataset is used in this paper
    location?: TextLocation;
}

export interface CodeRefItem {
    repo_url?: string;
    description: string;
    location?: TextLocation;
}

export interface StructureSection {
    title: string;
    level: number;
    start_line: number;
}

export interface StructureInfo {
    sections: StructureSection[];
}

export interface AnalysisResult {
    paper_id: string;
    status: 'pending' | 'analyzing' | 'completed' | 'failed';
    summary?: string;
    methods: MethodItem[];
    datasets: DatasetItem[];
    code_refs: CodeRefItem[];
    structure?: StructureInfo;
    error_message?: string;
}

export const analysisApi = {
    trigger: async (paperId: string) => {
        const { data } = await api.post(`/papers/${paperId}/analyze`);
        return data;
    },

    get: async (paperId: string): Promise<AnalysisResult> => {
        const { data } = await api.get(`/papers/${paperId}/analysis`);
        return data;
    },
};

// Graph API Types
export interface PaperNode {
    id: string;
    title: string;
    authors: string[];
    year?: number;
    venue?: string;
    citation_count?: number;
    is_local: boolean;
    external_id?: string;
    s2_url?: string;  // Semantic Scholar URL
}

export interface PaperEdge {
    source: string;
    target: string;
    relation: 'cites' | 'cited_by' | 'similar' | 'recommended';
    weight?: number;
}

export interface CurrentPaper {
    id: string;
    title: string;
    external_id?: string;
}

export interface PaperGraphData {
    current_paper: CurrentPaper;
    nodes: PaperNode[];
    edges: PaperEdge[];
}

export const graphApi = {
    get: async (paperId: string, options?: {
        include_citations?: boolean;
        include_references?: boolean;
        include_recommendations?: boolean;
        limit?: number;
        force_refresh?: boolean;
    }): Promise<PaperGraphData> => {
        const { data } = await api.get(`/papers/${paperId}/graph`, { params: options });
        return data;
    },

    expand: async (paperId: string, nodeExternalId: string, limit?: number): Promise<PaperGraphData> => {
        const { data } = await api.get(`/papers/${paperId}/graph/expand/${encodeURIComponent(nodeExternalId)}`, {
            params: { limit: limit || 5 }
        });
        return data;
    },
};

// Author API Types
export interface AuthorWork {
    title: string;
    year?: number;
    venue?: string;
    citation_count?: number;
    doi?: string;
    openalex_url: string;
}

export interface AuthorWithWorks {
    openalex_id: string;
    display_name: string;
    affiliation?: string;
    works_count: number;
    cited_by_count: number;
    orcid?: string;
    top_works: AuthorWork[];
}

export interface AuthorsWorksResponse {
    paper_id: string;
    authors: AuthorWithWorks[];
    from_cache?: boolean;
}

export const authorsApi = {
    getAuthorsWorks: async (paperId: string, worksLimit?: number, refresh?: boolean): Promise<AuthorsWorksResponse> => {
        const { data } = await api.get(`/papers/${paperId}/authors-works`, {
            params: { works_limit: worksLimit, refresh }
        });
        return data;
    },
};

// Classification API Types
export interface TagSuggestion {
    name: string;
    confidence: number;
    reason: string;
}

export interface TagsResponse {
    paper_id: string;
    tags: string[];
    suggested_tags?: string[];
    tags_confirmed: boolean;
}

export interface ClassifyResponse {
    paper_id: string;
    suggested_tags: TagSuggestion[];
}

export const classificationApi = {
    classify: async (paperId: string): Promise<ClassifyResponse> => {
        const { data } = await api.post(`/papers/${paperId}/classify`);
        return data;
    },

    getTags: async (paperId: string): Promise<TagsResponse> => {
        const { data } = await api.get(`/papers/${paperId}/tags`);
        return data;
    },

    updateTags: async (paperId: string, tags: string[]): Promise<TagsResponse> => {
        const { data } = await api.put(`/papers/${paperId}/tags`, { tags });
        return data;
    },

    addTag: async (paperId: string, tag: string): Promise<TagsResponse> => {
        const { data } = await api.post(`/papers/${paperId}/tags`, { tag });
        return data;
    },

    removeTag: async (paperId: string, tag: string): Promise<void> => {
        await api.delete(`/papers/${paperId}/tags/${encodeURIComponent(tag)}`);
    },

    updateCategory: async (paperId: string, category: string): Promise<void> => {
        await api.put(`/papers/${paperId}/category`, { category });
    },
};

// Translation API Types
export interface TranslationResponse {
    paper_id: string;
    translated_content?: string;
    is_translated: boolean;
}

export const translationApi = {
    /**
     * 开始流式翻译 (返回 EventSource URL)
     */
    getStreamUrl: (paperId: string): string => {
        return `/api/v1/papers/${paperId}/translate/stream`;
    },

    /**
     * 获取已保存的翻译结果
     */
    getTranslation: async (paperId: string): Promise<TranslationResponse> => {
        const { data } = await api.get(`/papers/${paperId}/translation`);
        return data;
    },
};

// ==================== Auth API ====================

export interface User {
    id: string;
    email: string;
    username?: string;
    role: 'admin' | 'user';
    is_active: boolean;
    created_at?: string;
    last_login?: string;
}

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    user: User;
}

export interface UserConfigResponse {
    // 系统模式
    llm_mode: string;
    translation_mode: string;
    mineru_mode: string;
    smart_analysis_mode: string;

    // 系统共享 Key 状态
    system_has_llm_key: boolean;
    system_has_translation_key: boolean;
    system_has_mineru_key: boolean;

    // 主 LLM (用户配置)
    llm_base_url: string;
    llm_model: string;
    llm_api_key_set: boolean;

    // 翻译 LLM
    translation_base_url: string;
    translation_model: string;
    translation_api_key_set: boolean;

    // MinerU
    mineru_api_url: string;
    mineru_api_key_set: boolean;

    // 智能分析 - 每功能独立
    smart_math_base_url: string;
    smart_math_model: string;
    smart_math_api_key_set: boolean;

    smart_feynman_base_url: string;
    smart_feynman_model: string;
    smart_feynman_api_key_set: boolean;

    smart_deep_base_url: string;
    smart_deep_model: string;
    smart_deep_api_key_set: boolean;

    smart_chat_base_url: string;
    smart_chat_model: string;
    smart_chat_api_key_set: boolean;
}

export interface UserConfigUpdate {
    // 主 LLM
    llm_base_url?: string;
    llm_model?: string;
    llm_api_key?: string;

    // 翻译 LLM
    translation_base_url?: string;
    translation_model?: string;
    translation_api_key?: string;

    // MinerU
    mineru_api_url?: string;
    mineru_api_key?: string;

    // 智能分析模式
    smart_analysis_mode?: string;

    // 智能分析 - 每功能独立配置
    smart_math_base_url?: string;
    smart_math_model?: string;
    smart_math_api_key?: string;

    smart_feynman_base_url?: string;
    smart_feynman_model?: string;
    smart_feynman_api_key?: string;

    smart_deep_base_url?: string;
    smart_deep_model?: string;
    smart_deep_api_key?: string;

    smart_chat_base_url?: string;
    smart_chat_model?: string;
    smart_chat_api_key?: string;
}

export const authApi = {
    login: async (email: string, password: string): Promise<TokenResponse> => {
        const { data } = await api.post('/auth/login', { email, password });
        return data;
    },

    register: async (email: string, password: string, username?: string): Promise<TokenResponse> => {
        const { data } = await api.post('/auth/register', { email, password, username });
        return data;
    },

    refresh: async (refreshToken: string): Promise<TokenResponse> => {
        const { data } = await api.post('/auth/refresh', {}, {
            headers: { Authorization: `Bearer ${refreshToken}` }
        });
        return data;
    },

    me: async (): Promise<User> => {
        const { data } = await api.get('/auth/me');
        return data;
    },

    changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
        await api.post('/auth/change-password', {
            old_password: oldPassword,
            new_password: newPassword
        });
    },

    getUserConfig: async (): Promise<UserConfigResponse> => {
        const { data } = await api.get('/auth/config');
        return data;
    },

    updateUserConfig: async (config: UserConfigUpdate): Promise<UserConfigResponse> => {
        const { data } = await api.put('/auth/config', config);
        return data;
    },
};

// ==================== Admin API ====================

export interface SystemConfig {
    // 主 LLM
    llm_mode: string;
    llm_base_url: string;
    llm_model: string;
    llm_api_key_set: boolean;

    // 翻译 LLM
    translation_mode: string;
    translation_base_url: string;
    translation_model: string;
    translation_api_key_set: boolean;

    // MinerU
    mineru_mode: string;
    mineru_api_url: string;
    mineru_api_key_set: boolean;
    mineru_self_hosted_url?: string;

    // Embedding
    embedding_base_url: string;
    embedding_model: string;
    embedding_api_key_set: boolean;

    // 智能分析
    smart_analysis_mode: string;

    // Math 解析
    smart_math_base_url: string;
    smart_math_model: string;
    smart_math_api_key_set: boolean;

    // 费曼教学
    smart_feynman_base_url: string;
    smart_feynman_model: string;
    smart_feynman_api_key_set: boolean;

    // 深度研究
    smart_deep_base_url: string;
    smart_deep_model: string;
    smart_deep_api_key_set: boolean;

    // Chat with PDF
    smart_chat_base_url: string;
    smart_chat_model: string;
    smart_chat_api_key_set: boolean;

    // 订阅系统
    subscription_enabled: boolean;
}

export interface UserListResponse {
    items: User[];
    total: number;
}

export const adminApi = {
    // 系统配置
    getConfig: async (): Promise<SystemConfig> => {
        const { data } = await api.get('/admin/config');
        return data;
    },

    updateConfig: async (config: Record<string, unknown>): Promise<void> => {
        await api.put('/admin/config', config);
    },

    // 用户管理
    listUsers: async (skip = 0, limit = 50): Promise<UserListResponse> => {
        const { data } = await api.get('/admin/users', { params: { skip, limit } });
        return data;
    },

    createUser: async (userData: { email: string; password: string; username?: string; role?: string }): Promise<User> => {
        const { data } = await api.post('/admin/users', userData);
        return data;
    },

    getUser: async (userId: string): Promise<User> => {
        const { data } = await api.get(`/admin/users/${userId}`);
        return data;
    },

    updateUser: async (userId: string, userData: { username?: string; role?: string; is_active?: boolean }): Promise<User> => {
        const { data } = await api.put(`/admin/users/${userId}`, userData);
        return data;
    },

    deleteUser: async (userId: string): Promise<void> => {
        await api.delete(`/admin/users/${userId}`);
    },

    resetPassword: async (userId: string, newPassword: string): Promise<void> => {
        await api.post(`/admin/users/${userId}/reset-password`, null, {
            params: { new_password: newPassword }
        });
    },

    // Token 用量统计
    getTokenStats: async (): Promise<TokenStats> => {
        const { data } = await api.get('/admin/token-stats');
        return data;
    },

    resetTokenStats: async (): Promise<void> => {
        await api.post('/admin/token-stats/reset');
    },

    // 邀请码管理
    getInvitationCodes: async (params?: {
        skip?: number;
        limit?: number;
        grant_plan?: string;
        is_used?: boolean;
    }): Promise<AdminInvitationCodeListResponse> => {
        const { data } = await api.get('/admin/invitation-codes', { params });
        return data;
    },

    batchCreateInvitationCodes: async (options: {
        count: number;
        grant_plan: string;
        grant_days: number;
        expires_days: number;
    }): Promise<{ success: boolean; count: number; codes: string[] }> => {
        const { data } = await api.post('/admin/invitation-codes/batch', options);
        return data;
    },

    deleteInvitationCode: async (code: string): Promise<void> => {
        await api.delete(`/admin/invitation-codes/${code}`);
    },
};

// 管理员邀请码类型
export interface AdminInvitationCodeItem {
    id: string;
    code: string;
    created_by: string;
    creator_email?: string;
    creator_plan: string;
    grant_plan: string;
    grant_days: number;
    is_used: boolean;
    used_by?: string;
    used_by_email?: string;
    used_at?: string;
    is_expired: boolean;
    expires_at?: string;
    is_active: boolean;
    created_at: string;
}

export interface AdminInvitationCodeListResponse {
    items: AdminInvitationCodeItem[];
    total: number;
    stats: {
        total: number;
        used: number;
        active: number;
        expired: number;
        by_plan: Record<string, { total: number; used: number }>;
    };
}

// Token 统计类型
export interface TokenStats {
    total_tokens: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    calls_count: number;
    by_function: Record<string, {
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        calls_count: number;
    }>;
    by_date: Record<string, {
        total_tokens: number;
        calls_count: number;
    }>;
}

// ==================== Quota API ====================

export interface QuotaStatus {
    plan: string;
    plan_display: string;
    expires_at: string | null;
    papers: {
        daily_used: number;
        daily_limit: number;
        monthly_used: number;
        monthly_limit: number;
    };
    ai: {
        daily_used: number;
        daily_limit: number;
    };
    can_parse: boolean;
    can_use_ai: boolean;
    subscription_enabled: boolean;
}

export interface PlanInfo {
    name: string;
    display: string;
    price: number;
    papers_daily: number;
    papers_monthly: number;
    ai_daily: number;
}

export interface RedeemResponse {
    success: boolean;
    message: string;
    new_plan: string;
    expires_at: string | null;
}

export interface InvitationCode {
    code: string;
    grant_plan: string;
    grant_days: number;
    is_used: boolean;
    used_at: string | null;
    is_expired: boolean;
    expires_at: string | null;
    created_at: string;
}

export const quotaApi = {
    /**
     * 获取当前用户配额状态
     */
    getStatus: async (): Promise<QuotaStatus> => {
        const { data } = await api.get('/quota/status');
        return data;
    },

    /**
     * 获取所有可用计划
     */
    getPlans: async (): Promise<PlanInfo[]> => {
        const { data } = await api.get('/quota/plans');
        return data;
    },

    /**
     * 兑换邀请码
     */
    redeemCode: async (code: string): Promise<RedeemResponse> => {
        const { data } = await api.post('/quota/redeem', { code });
        return data;
    },

    /**
     * 生成邀请码
     */
    generateCode: async (options?: {
        grant_plan?: string;
        grant_days?: number;
        expires_days?: number;
    }): Promise<{ code: string; grant_plan: string; grant_days: number; expires_at: string | null; created_at: string }> => {
        const { data } = await api.post('/quota/invitation-codes', options || {});
        return data;
    },

    /**
     * 获取我生成的邀请码列表
     */
    getMyCodes: async (): Promise<InvitationCode[]> => {
        const { data } = await api.get('/quota/invitation-codes');
        return data;
    },

    /**
     * 删除邀请码
     */
    deleteCode: async (code: string): Promise<void> => {
        await api.delete(`/quota/invitation-codes/${code}`);
    },
};

// ==================== Prompts API ====================

export interface PromptTypeItem {
    name: string;
    version_count: number;
    active_version: string | null;
}

export interface PromptVersionItem {
    version: string;
    description: string | null;
    is_active: boolean;
    created_at: string | null;
    updated_at: string | null;
}

export interface PromptDetail {
    id: string;
    prompt_type: string;
    version: string;
    description: string | null;
    system_prompt: string;
    user_prompt_template: string;
    file_path: string | null;
    created_at: string | null;
    updated_at: string | null;
    is_active: boolean;
}

export interface PromptHistoryItem {
    id: string;
    changed_at: string | null;
    changed_by: string | null;
    change_note: string | null;
    description: string | null;
}

export interface PromptHistoryDetail {
    id: string;
    prompt_type: string;
    version: string;
    description: string | null;
    system_prompt: string;
    user_prompt_template: string;
    changed_at: string | null;
    change_note: string | null;
}

export interface PreviewPaper {
    id: string;
    title: string | null;
    filename: string;
}

export interface PreviewResult {
    result: string;
    tokens_used: number | null;
}

export const promptsApi = {
    /**
     * 获取所有提示词类型
     */
    getTypes: async (): Promise<{ types: PromptTypeItem[] }> => {
        const { data } = await api.get('/admin/prompts/types');
        return data;
    },

    /**
     * 获取指定类型的所有版本
     */
    getVersions: async (promptType: string): Promise<{
        prompt_type: string;
        versions: PromptVersionItem[];
        active_version: string | null;
    }> => {
        const { data } = await api.get(`/admin/prompts/${promptType}/versions`);
        return data;
    },

    /**
     * 获取指定版本的完整内容
     */
    getDetail: async (promptType: string, version: string): Promise<PromptDetail> => {
        const { data } = await api.get(`/admin/prompts/${promptType}/${version}`);
        return data;
    },

    /**
     * 更新提示词内容
     */
    updatePrompt: async (promptType: string, version: string, updateData: {
        description?: string;
        system_prompt: string;
        user_prompt_template: string;
        change_note?: string;
    }): Promise<PromptDetail> => {
        const { data } = await api.put(`/admin/prompts/${promptType}/${version}`, updateData);
        return data;
    },

    /**
     * 创建新版本
     */
    createVersion: async (promptType: string, createData: {
        version: string;
        description?: string;
        system_prompt: string;
        user_prompt_template: string;
        base_version?: string;
    }): Promise<PromptDetail> => {
        const { data } = await api.post(`/admin/prompts/${promptType}`, createData);
        return data;
    },

    /**
     * 设置活跃版本
     */
    setActiveVersion: async (promptType: string, version: string): Promise<{
        success: boolean;
        prompt_type: string;
        active_version: string;
    }> => {
        const { data } = await api.put(`/admin/prompts/${promptType}/active`, { version });
        return data;
    },

    /**
     * 获取版本编辑历史
     */
    getHistory: async (promptType: string, version: string): Promise<{
        prompt_type: string;
        version: string;
        history: PromptHistoryItem[];
    }> => {
        const { data } = await api.get(`/admin/prompts/${promptType}/${version}/history`);
        return data;
    },

    /**
     * 获取历史记录详情
     */
    getHistoryDetail: async (promptType: string, version: string, historyId: string): Promise<PromptHistoryDetail> => {
        const { data } = await api.get(`/admin/prompts/${promptType}/${version}/history/${historyId}`);
        return data;
    },

    /**
     * 回滚到指定历史版本
     */
    rollback: async (promptType: string, version: string, historyId: string): Promise<PromptDetail> => {
        const { data } = await api.post(`/admin/prompts/${promptType}/${version}/rollback/${historyId}`);
        return data;
    },

    /**
     * 热重载所有提示词
     */
    reload: async (): Promise<{ success: boolean; message: string }> => {
        const { data } = await api.post('/admin/prompts/reload');
        return data;
    },

    /**
     * 获取可预览的论文列表
     */
    getPreviewPapers: async (): Promise<{ papers: PreviewPaper[] }> => {
        const { data } = await api.get('/admin/prompts/preview/papers');
        return data;
    },

    /**
     * 执行实时预览
     */
    preview: async (previewData: {
        prompt_type: string;
        system_prompt: string;
        user_prompt_template: string;
        paper_id: string;
    }): Promise<PreviewResult> => {
        const { data } = await api.post('/admin/prompts/preview', previewData);
        return data;
    },
};

// ==================== Teams API ====================

export interface Team {
    id: string;
    name: string;
    description?: string;
    avatar_url?: string;
    created_by?: string;
    created_at?: string;
    member_count: number;
    my_role?: string;
}

export interface TeamMember {
    id: string;
    user_id: string;
    email: string;
    username?: string;
    role: string;
    joined_at?: string;
}

export interface TeamInvitation {
    id: string;
    invite_code: string;
    max_uses: number;
    used_count: number;
    expires_at?: string;
    is_valid: boolean;
    created_at?: string;
}

export interface TeamPaper {
    id: string;
    title?: string;
    filename: string;
    status: string;
    category?: string;
    created_at?: string;
    shared_by?: {
        id?: string;
        email?: string;
        username?: string;
    };
    shared_at?: string;
}

export interface TeamPapersResponse {
    papers: TeamPaper[];
    total: number;
}

export const teamsApi = {
    // ========== Team CRUD ==========

    /**
     * 创建团队
     */
    create: async (data: { name: string; description?: string }): Promise<Team> => {
        const { data: result } = await api.post('/teams', data);
        return result;
    },

    /**
     * 获取我的团队列表
     */
    list: async (): Promise<Team[]> => {
        const { data } = await api.get('/teams');
        return data;
    },

    /**
     * 获取团队详情
     */
    get: async (teamId: string): Promise<Team> => {
        const { data } = await api.get(`/teams/${teamId}`);
        return data;
    },

    /**
     * 更新团队信息
     */
    update: async (teamId: string, data: { name?: string; description?: string; avatar_url?: string }): Promise<Team> => {
        const { data: result } = await api.put(`/teams/${teamId}`, data);
        return result;
    },

    /**
     * 删除团队 (仅 Owner)
     */
    delete: async (teamId: string): Promise<void> => {
        await api.delete(`/teams/${teamId}`);
    },

    // ========== Member Management ==========

    /**
     * 获取团队成员列表
     */
    getMembers: async (teamId: string): Promise<TeamMember[]> => {
        const { data } = await api.get(`/teams/${teamId}/members`);
        return data;
    },

    /**
     * 更新成员角色
     */
    updateMemberRole: async (teamId: string, userId: string, role: string): Promise<void> => {
        await api.put(`/teams/${teamId}/members/${userId}`, null, { params: { role } });
    },

    /**
     * 移除成员
     */
    removeMember: async (teamId: string, userId: string): Promise<void> => {
        await api.delete(`/teams/${teamId}/members/${userId}`);
    },

    // ========== Invitation ==========

    /**
     * 生成邀请链接
     */
    createInvitation: async (teamId: string, options?: { max_uses?: number; expires_days?: number }): Promise<TeamInvitation> => {
        const { data } = await api.post(`/teams/${teamId}/invite`, options || {});
        return data;
    },

    /**
     * 通过邀请码加入团队
     */
    joinByCode: async (inviteCode: string): Promise<{ message: string; team_id: string; team_name: string }> => {
        const { data } = await api.post(`/teams/join/${inviteCode}`);
        return data;
    },

    // ========== Paper Sharing ==========

    /**
     * 分享论文到团队
     */
    sharePaper: async (paperId: string, teamId: string): Promise<{ id: string; paper_id: string; team_id: string }> => {
        const { data } = await api.post(`/teams/papers/${paperId}/share`, { team_id: teamId });
        return data;
    },

    /**
     * 获取团队论文列表
     */
    getTeamPapers: async (teamId: string): Promise<TeamPapersResponse> => {
        const { data } = await api.get(`/teams/${teamId}/papers`);
        return data;
    },

    /**
     * 取消论文分享
     */
    unsharePaper: async (paperId: string, teamId: string): Promise<void> => {
        await api.delete(`/teams/papers/${paperId}/share/${teamId}`);
    },
};

// ==================== Annotations API ====================

export type AnnotationType = 'highlight' | 'note' | 'comment';
export type AnnotationVisibility = 'private' | 'team';

export interface AnnotationUser {
    id: string;
    email?: string;
    username?: string;
}

export interface Annotation {
    id: string;
    paper_id: string;
    team_id?: string;
    user_id: string;
    user?: AnnotationUser;
    type: AnnotationType;
    visibility: AnnotationVisibility;
    start_offset?: number;
    end_offset?: number;
    line_number?: number;
    selected_text?: string;
    content?: string;
    color?: string;
    parent_id?: string;
    replies_count: number;
    created_at?: string;
    updated_at?: string;
}

export interface CreateAnnotationData {
    type?: AnnotationType;
    visibility?: AnnotationVisibility;
    team_id?: string;
    start_offset?: number;
    end_offset?: number;
    line_number?: number;
    selected_text?: string;
    content?: string;
    color?: string;
}

export interface UpdateAnnotationData {
    content?: string;
    color?: string;
    visibility?: AnnotationVisibility;
}

export interface ReplyAnnotationData {
    content: string;
    visibility?: AnnotationVisibility;
}

export const annotationsApi = {
    /**
     * 获取论文标注列表
     */
    list: async (paperId: string, params?: { team_id?: string; type?: AnnotationType }): Promise<Annotation[]> => {
        const { data } = await api.get(`/papers/${paperId}/annotations`, { params });
        return data;
    },

    /**
     * 创建标注
     */
    create: async (paperId: string, data: CreateAnnotationData): Promise<Annotation> => {
        const { data: result } = await api.post(`/papers/${paperId}/annotations`, data);
        return result;
    },

    /**
     * 更新标注
     */
    update: async (annotationId: string, data: UpdateAnnotationData): Promise<Annotation> => {
        const { data: result } = await api.put(`/annotations/${annotationId}`, data);
        return result;
    },

    /**
     * 删除标注
     */
    delete: async (annotationId: string): Promise<void> => {
        await api.delete(`/annotations/${annotationId}`);
    },

    /**
     * 回复标注
     */
    reply: async (annotationId: string, data: ReplyAnnotationData): Promise<Annotation> => {
        const { data: result } = await api.post(`/annotations/${annotationId}/reply`, data);
        return result;
    },

    /**
     * 获取标注的回复列表
     */
    getReplies: async (annotationId: string): Promise<Annotation[]> => {
        const { data } = await api.get(`/annotations/${annotationId}/replies`);
        return data;
    },
};

// ================== Tasks API ==================

export type ReadingTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type AssigneeStatus = 'assigned' | 'reading' | 'submitted' | 'approved';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskAssignee {
    id: string;
    task_id: string;
    user_id: string;
    assigned_by: string;
    status: AssigneeStatus;
    summary?: string;
    assigned_at?: string;
    started_at?: string;
    submitted_at?: string;
    approved_at?: string;
    user?: {
        id: string;
        username?: string;
        email?: string;
    };
}

export interface ReadingTask {
    id: string;
    team_id: string;
    paper_id?: string;
    created_by: string;
    title: string;
    description?: string;
    status: ReadingTaskStatus;
    priority: TaskPriority;
    due_date?: string;
    created_at?: string;
    updated_at?: string;
    completed_at?: string;
    assignees: TaskAssignee[];
    assignee_count: number;
}

export interface CreateTaskData {
    paper_id?: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
    due_date?: string;
    assignee_ids?: string[];
}

export interface UpdateTaskData {
    title?: string;
    description?: string;
    status?: ReadingTaskStatus;
    priority?: TaskPriority;
    due_date?: string;
}

export interface SubmitSummaryData {
    summary: string;
    summary_structure?: Record<string, unknown>;
}

export const tasksApi = {
    /**
     * 获取团队任务列表
     */
    listByTeam: async (
        teamId: string,
        filters?: {
            status?: TaskStatus;
            priority?: TaskPriority;
            assignee_id?: string;
        }
    ): Promise<ReadingTask[]> => {
        const { data } = await api.get(`/tasks/teams/${teamId}/tasks`, { params: filters });
        return data;
    },

    /**
     * 创建任务
     */
    create: async (teamId: string, data: CreateTaskData): Promise<ReadingTask> => {
        const { data: result } = await api.post(`/tasks/teams/${teamId}/tasks`, data);
        return result;
    },

    /**
     * 获取任务详情
     */
    get: async (taskId: string): Promise<ReadingTask> => {
        const { data } = await api.get(`/tasks/${taskId}`);
        return data;
    },

    /**
     * 更新任务
     */
    update: async (taskId: string, data: UpdateTaskData): Promise<ReadingTask> => {
        const { data: result } = await api.put(`/tasks/${taskId}`, data);
        return result;
    },

    /**
     * 删除任务
     */
    delete: async (taskId: string): Promise<void> => {
        await api.delete(`/tasks/${taskId}`);
    },

    /**
     * 分配任务
     */
    assign: async (taskId: string, userIds: string[]): Promise<{ assigned: string[] }> => {
        const { data } = await api.post(`/tasks/${taskId}/assign`, { user_ids: userIds });
        return data;
    },

    /**
     * 取消分配
     */
    unassign: async (taskId: string, userId: string): Promise<void> => {
        await api.delete(`/tasks/${taskId}/assignees/${userId}`);
    },

    /**
     * 开始阅读
     */
    startReading: async (taskId: string, userId: string): Promise<void> => {
        await api.put(`/tasks/${taskId}/assignees/${userId}/start`);
    },

    /**
     * 提交总结
     */
    submitSummary: async (taskId: string, userId: string, data: SubmitSummaryData): Promise<void> => {
        await api.put(`/tasks/${taskId}/assignees/${userId}/submit`, data);
    },

    /**
     * 批准总结
     */
    approveSummary: async (taskId: string, userId: string): Promise<void> => {
        await api.put(`/tasks/${taskId}/assignees/${userId}/approve`);
    },
};

// ================== AI API ==================

export type AICommand = 'explain' | 'summarize' | 'search' | 'compare' | 'expand';

export interface AIRequest {
    command: AICommand;
    content: string;
    paper_id?: string;
    team_id?: string;
    annotation_id?: string;
}

export interface AIResponse {
    success: boolean;
    command: string;
    response: string;
    sources?: Array<{ title: string; url?: string }>;
    created_at: string;
}

export interface DiscussionSummaryResponse {
    success: boolean;
    summary: string;
    discussion_count: number;
    created_at: string;
}

export const aiApi = {
    /**
     * 发送 AI 请求
     */
    assist: async (request: AIRequest): Promise<AIResponse> => {
        const { data } = await api.post('/ai/assist', request);
        return data;
    },

    /**
     * 总结讨论
     */
    summarizeDiscussion: async (annotationId: string): Promise<DiscussionSummaryResponse> => {
        const { data } = await api.post('/ai/summarize-discussion', null, {
            params: { annotation_id: annotationId }
        });
        return data;
    },
};

// ==================== Share API ====================

export interface ShareLink {
    id: string;
    paper_id: string;
    share_token: string;
    share_url: string;
    expires_at: string | null;
    access_count: number;
    created_at: string;
}

export interface ShareLinkListResponse {
    links: ShareLink[];
}

export interface GuestPaper {
    paper_id: string;
    title: string | null;
    filename: string;
    status: string;
    owner_name: string | null;
    authors: string | null;
}

export interface GuestPaperContent {
    markdown: string;
}

export interface GuestAnalysis {
    paper_id: string;
    status: string;
    summary: string | null;
    methods: MethodItem[];
    datasets: DatasetItem[];
    code_refs: CodeRefItem[];
    structure: StructureInfo | null;
}

export const shareApi = {
    // ============= 需要认证的端点 =============

    /**
     * 为论文生成分享链接
     */
    createLink: async (paperId: string, expiresInDays?: number): Promise<ShareLink> => {
        const { data } = await api.post(`/share/papers/${paperId}/link`, {
            expires_in_days: expiresInDays
        });
        return data;
    },

    /**
     * 获取当前用户的所有分享链接
     */
    getMyLinks: async (): Promise<ShareLinkListResponse> => {
        const { data } = await api.get('/share/links');
        return data;
    },

    /**
     * 获取指定论文的分享链接
     */
    getPaperLinks: async (paperId: string): Promise<ShareLinkListResponse> => {
        const { data } = await api.get(`/share/papers/${paperId}/links`);
        return data;
    },

    /**
     * 撤销分享链接
     */
    revokeLink: async (shareToken: string): Promise<{ success: boolean; message: string }> => {
        const { data } = await api.delete(`/share/link/${shareToken}`);
        return data;
    },

    // ============= 访客端点（无需认证） =============

    /**
     * 访客获取论文基本信息
     */
    getGuestPaper: async (shareToken: string): Promise<GuestPaper> => {
        const { data } = await api.get(`/share/paper/${shareToken}`);
        return data;
    },

    /**
     * 访客获取论文内容
     */
    getGuestContent: async (shareToken: string): Promise<GuestPaperContent> => {
        const { data } = await api.get(`/share/paper/${shareToken}/content`);
        return data;
    },

    /**
     * 访客获取论文分析结果
     */
    getGuestAnalysis: async (shareToken: string): Promise<GuestAnalysis> => {
        const { data } = await api.get(`/share/paper/${shareToken}/analysis`);
        return data;
    },
};
