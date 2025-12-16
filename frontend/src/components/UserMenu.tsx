/**
 * Read it DEEP - 用户菜单组件
 * 
 * 显示当前用户信息、退出登录、管理员入口
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
    User,
    LogOut,
    Settings,
    ChevronDown,
    Shield,
} from 'lucide-react';

export default function UserMenu() {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!user) return null;

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
                <div className="w-7 h-7 bg-brand-600 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-medium text-slate-700 max-w-[100px] truncate">
                    {user.username || user.email.split('@')[0]}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
                    {/* 用户信息 */}
                    <div className="px-4 py-2 border-b border-slate-100">
                        <div className="text-sm font-medium text-slate-900">
                            {user.username || user.email.split('@')[0]}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{user.email}</div>
                        {user.role === 'admin' && (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-brand-100 text-brand-700 text-xs rounded-full">
                                <Shield className="w-3 h-3" />
                                管理员
                            </span>
                        )}
                    </div>

                    {/* 菜单项 */}
                    <div className="py-1">
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/settings');
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <Settings className="w-4 h-4 text-slate-400" />
                            个人设置
                        </button>

                        {user.role === 'admin' && (
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    navigate('/admin');
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <Settings className="w-4 h-4 text-slate-400" />
                                管理员设置
                            </button>
                        )}
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            退出登录
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
