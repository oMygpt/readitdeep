/**
 * Read it DEEP - 应用入口
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import LibraryPage from './pages/LibraryPage';
import ReaderPage from './pages/ReaderPage';
import WorkbenchPage from './pages/WorkbenchPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import TeamsPage from './pages/TeamsPage';
import TaskBoardPage from './pages/TaskBoardPage';
import TaskDetailsPage from './pages/TaskDetailsPage';
import GuestReaderPage from './pages/GuestReaderPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5分钟
      retry: 1,
    },
  },
});

// 受保护路由组件
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

// 已登录用户访问登录页时重定向
function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/library" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="login" element={<PublicRoute><LoginPage /></PublicRoute>} />

      {/* 访客分享路由 (无需登录) */}
      <Route path="share/:shareToken" element={<GuestReaderPage />} />

      {/* 受保护路由 */}
      <Route index element={<Navigate to="/library" replace />} />
      <Route path="library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
      <Route path="read/:paperId" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
      <Route path="workbench" element={<ProtectedRoute><WorkbenchPage /></ProtectedRoute>} />
      <Route path="teams" element={<ProtectedRoute><TeamsPage /></ProtectedRoute>} />
      <Route path="teams/:teamId/tasks" element={<ProtectedRoute><TaskBoardPage /></ProtectedRoute>} />
      <Route path="tasks/:taskId" element={<ProtectedRoute><TaskDetailsPage /></ProtectedRoute>} />
      <Route path="admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/library" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
