/**
 * Read it DEEP - 布局组件
 */

import { Outlet, Link, useLocation } from 'react-router-dom';
import { BookOpen, Library, Settings, Upload } from 'lucide-react';
import { useState } from 'react';
import UploadModal from './UploadModal';

export default function Layout() {
    const location = useLocation();
    const [showUpload, setShowUpload] = useState(false);

    const navItems = [
        { path: '/library', label: '知识库', icon: Library },
    ];

    return (
        <div className="min-h-screen bg-slate-900 flex">
            {/* 侧边栏 */}
            <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
                {/* Logo */}
                <div className="p-4 border-b border-slate-700">
                    <Link to="/" className="flex items-center gap-2 text-xl font-bold">
                        <BookOpen className="w-6 h-6 text-indigo-500" />
                        <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            Read it DEEP
                        </span>
                    </Link>
                </div>

                {/* 导航 */}
                <nav className="flex-1 p-4">
                    <ul className="space-y-2">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname.startsWith(item.path);
                            return (
                                <li key={item.path}>
                                    <Link
                                        to={item.path}
                                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${isActive
                                                ? 'bg-indigo-600 text-white'
                                                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                                            }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                        {item.label}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                {/* 上传按钮 */}
                <div className="p-4 border-t border-slate-700">
                    <button
                        onClick={() => setShowUpload(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
                    >
                        <Upload className="w-5 h-5" />
                        上传论文
                    </button>
                </div>

                {/* 设置 */}
                <div className="p-4 border-t border-slate-700">
                    <button className="flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-white transition-colors">
                        <Settings className="w-5 h-5" />
                        设置
                    </button>
                </div>
            </aside>

            {/* 主内容区 */}
            <main className="flex-1 overflow-auto">
                <Outlet />
            </main>

            {/* 上传弹窗 */}
            {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
        </div>
    );
}
