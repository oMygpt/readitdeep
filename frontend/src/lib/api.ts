/**
 * Read it DEEP - API 客户端
 */

import axios from 'axios';

export const api = axios.create({
    baseURL: '/api/v1',
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// 请求拦截器
api.interceptors.request.use(
    (config) => {
        // TODO: 添加认证 token
        return config;
    },
    (error) => Promise.reject(error)
);

// 响应拦截器
api.interceptors.response.use(
    (response) => response,
    (error) => {
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
    status: 'uploading' | 'parsing' | 'indexing' | 'completed' | 'failed';
    created_at: string;
    updated_at?: string;
    markdown_content?: string;
    translated_content?: string;
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
