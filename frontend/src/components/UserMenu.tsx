/**
 * Read it DEEP - User Menu Component
 * 
 * Shows current user info, logout, admin access, and language switcher
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import {
    User,
    LogOut,
    Settings,
    ChevronDown,
    Shield,
    Globe,
} from 'lucide-react';

export default function UserMenu() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
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

    const toggleLanguage = () => {
        const newLang = i18n.language === 'zh' ? 'en' : 'zh';
        i18n.changeLanguage(newLang);
    };

    const currentLanguage = i18n.language === 'zh' ? '中文' : 'English';

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
                    {/* User Info */}
                    <div className="px-4 py-2 border-b border-slate-100">
                        <div className="text-sm font-medium text-slate-900">
                            {user.username || user.email.split('@')[0]}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{user.email}</div>
                        {user.role === 'admin' && (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-brand-100 text-brand-700 text-xs rounded-full">
                                <Shield className="w-3 h-3" />
                                {t('admin.userList.roleAdmin')}
                            </span>
                        )}
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                        {/* Language Switcher */}
                        <button
                            onClick={toggleLanguage}
                            className="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <span className="flex items-center gap-3">
                                <Globe className="w-4 h-4 text-slate-400" />
                                {t('common.language')}
                            </span>
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                {currentLanguage}
                            </span>
                        </button>

                        <button
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/settings');
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <Settings className="w-4 h-4 text-slate-400" />
                            {t('userMenu.settings')}
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
                                {t('userMenu.admin')}
                            </button>
                        )}
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            {t('userMenu.logout')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
