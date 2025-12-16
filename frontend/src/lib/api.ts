/**
 * Read it DEEP - API 客户端
 */

import axios from 'axios';

const TOKEN_KEY = 'readitdeep_token';

export const api = axios.create({
    baseURL: '/api/v1',
    timeout: 30000,
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
};

export const libraryApi = {
    list: async (params?: {
        page?: number;
        page_size?: number;
        search?: string;
        category?: string;
        status?: string;
    }): Promise<LibraryResponse> => {
        const { data } = await api.get('/library', { params });
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
};

// Analysis API Types
export interface TextLocation {
    start_line: number;
    end_line: number;
    text_snippet: string;
}

export interface MethodItem {
    name: string;
    description: string;
    location?: TextLocation;
}

export interface DatasetItem {
    name: string;
    url?: string;
    description: string;
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
};
