/**
 * Read it DEEP - 认证上下文
 * 
 * 管理用户登录状态、Token 存储和刷新
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, renewLinkedSession, setLinkedMode, type User } from '../lib/api';

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    /** standalone：本地账号；linked：只用 PaperDaily 账号登录 */
    authMode: 'standalone' | 'linked';
    registrationOpen: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'readitdeep_token';
const REFRESH_TOKEN_KEY = 'readitdeep_refresh_token';

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [authMode, setAuthMode] = useState<'standalone' | 'linked'>('standalone');
    const [registrationOpen, setRegistrationOpen] = useState(true);

    // 初始化：检查本地存储的 token
    useEffect(() => {
        const initAuth = async () => {
            try {
                const mode = await authApi.mode();
                setAuthMode(mode.mode);
                setRegistrationOpen(mode.registration_open);
                if (mode.mode === 'linked') {
                    setLinkedMode(true);
                    // 关联模式：凭 PaperDaily 会话 cookie 换本地短 token
                    const token = await renewLinkedSession();
                    if (token) {
                        setUser(await authApi.me());
                    } else {
                        localStorage.removeItem(TOKEN_KEY);
                    }
                    setIsLoading(false);
                    return;
                }
            } catch {
                // 旧后端没有 /auth/mode：按独立模式处理
            }
            const token = localStorage.getItem(TOKEN_KEY);
            if (token) {
                try {
                    const userData = await authApi.me();
                    setUser(userData);
                } catch (error) {
                    // Token 无效，清除
                    localStorage.removeItem(TOKEN_KEY);
                    localStorage.removeItem(REFRESH_TOKEN_KEY);
                }
            }
            setIsLoading(false);
        };
        initAuth();
    }, []);

    const login = async (email: string, password: string) => {
        const response = await authApi.login(email, password);
        localStorage.setItem(TOKEN_KEY, response.access_token);
        localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
        queryClient.clear();
        setUser(response.user);
    };

    // 关联模式：token 到期前一分钟自动续签
    useEffect(() => {
        if (authMode !== 'linked' || !user) return;
        const timer = setInterval(() => { renewLinkedSession(); }, 13 * 60 * 1000);
        return () => clearInterval(timer);
    }, [authMode, user]);

    const logout = () => {
        if (authMode === 'linked') {
            authApi.paperdailyLogout().catch(() => undefined);
        }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        queryClient.clear();
        setUser(null);
    };

    const refreshToken = async () => {
        const refreshTokenValue = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshTokenValue) {
            logout();
            return;
        }
        try {
            const response = await authApi.refresh(refreshTokenValue);
            localStorage.setItem(TOKEN_KEY, response.access_token);
            localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
            setUser(response.user);
        } catch {
            logout();
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                authMode,
                registrationOpen,
                login,
                logout,
                refreshToken,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// 获取存储的 Token
export function getStoredToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}
