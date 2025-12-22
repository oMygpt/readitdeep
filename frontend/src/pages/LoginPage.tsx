/**
 * Read it DEEP - Login/Register Page
 * 
 * Supports login and registration (first user becomes admin automatically)
 */

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../lib/api';
import { BookOpen, Loader2, AlertCircle, UserPlus, LogIn } from 'lucide-react';

export default function LoginPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { login, isLoading: authLoading } = useAuth();

    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const from = (location.state as { from?: string })?.from || '/library';

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            await login(email, password);
            navigate(from, { replace: true });
        } catch (err: unknown) {
            const error = err as { response?: { data?: { detail?: string } } };
            setError(error.response?.data?.detail || t('login.loginFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (password !== confirmPassword) {
            setError(t('login.passwordMismatch'));
            return;
        }

        if (password.length < 6) {
            setError(t('login.passwordTooShort'));
            return;
        }

        setIsLoading(true);

        try {
            const response = await authApi.register(email, password, username || undefined);
            // Auto login after registration
            localStorage.setItem('readitdeep_token', response.access_token);
            localStorage.setItem('readitdeep_refresh_token', response.refresh_token);
            setSuccess(t('login.registerSuccess'));
            setTimeout(() => {
                window.location.href = '/library';
            }, 1000);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { detail?: string } } };
            setError(error.response?.data?.detail || t('login.registerFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-border p-8 md:p-10">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-2xl mb-4 group hover:bg-primary/20 transition-colors">
                        <BookOpen className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-serif font-bold text-content-main mb-2">{t('login.title')}</h1>
                    <p className="text-content-muted">{t('login.subtitle')}</p>
                </div>

                {/* Mode Toggle */}
                <div className="flex bg-surface-elevated rounded-lg p-1 mb-6">
                    <button
                        onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all ${mode === 'login'
                            ? 'bg-surface text-content-main shadow-sm'
                            : 'text-content-muted hover:text-content-main'
                            }`}
                    >
                        <LogIn className="w-4 h-4" />
                        {t('login.login')}
                    </button>
                    <button
                        onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all ${mode === 'register'
                            ? 'bg-surface text-content-main shadow-sm'
                            : 'text-content-muted hover:text-content-main'
                            }`}
                    >
                        <UserPlus className="w-4 h-4" />
                        {t('login.register')}
                    </button>
                </div>

                {/* Error/Success Messages */}
                {error && (
                    <div className="flex items-center gap-2 p-3 mb-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
                {success && (
                    <div className="flex items-center gap-2 p-3 mb-4 bg-success/10 border border-success/20 rounded-lg text-success text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{success}</span>
                    </div>
                )}

                {/* Login Form */}
                {mode === 'login' && (
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.email')}
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.emailPlaceholder')}
                                required
                                autoComplete="email"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.password')}
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.passwordPlaceholder')}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 px-4 bg-primary text-primary-content font-medium rounded-lg hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    {t('login.loggingIn')}
                                </>
                            ) : (
                                t('login.loginButton')
                            )}
                        </button>
                    </form>
                )}

                {/* Register Form */}
                {mode === 'register' && (
                    <form onSubmit={handleRegister} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.email')} <span className="text-error">{t('login.required')}</span>
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.emailPlaceholder')}
                                required
                                autoComplete="email"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.username')} <span className="text-content-muted">{t('login.usernameOptional')}</span>
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.usernamePlaceholder')}
                                autoComplete="username"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.password')} <span className="text-error">{t('login.required')}</span>
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.passwordTooShort').replace('Password must be at least ', '').replace(' characters', '')}
                                required
                                autoComplete="new-password"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-content-main mb-1.5">
                                {t('login.confirmPassword')} <span className="text-error">{t('login.required')}</span>
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-lg text-content-main placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder={t('login.confirmPasswordPlaceholder')}
                                required
                                autoComplete="new-password"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 px-4 bg-primary text-primary-content font-medium rounded-lg hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    {t('login.registering')}
                                </>
                            ) : (
                                t('login.registerButton')
                            )}
                        </button>

                        <p className="text-xs text-center text-content-muted mt-2">
                            {t('login.firstUserAdmin')}
                        </p>
                    </form>
                )}
            </div>

            <div className="fixed bottom-6 text-center text-xs text-content-muted">
                {t('login.copyright')}
            </div>
        </div>
    );
}
