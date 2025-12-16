import React, { useEffect, useState, useRef } from 'react';
import { adminService } from '../services/adminService';
import { SystemTask, LLMStats, LLMHealthResult } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Activity, AlertCircle, CheckCircle, Clock, Database, Download, RefreshCw, Server, Terminal, XCircle, PlayCircle } from 'lucide-react';

interface AdminDashboardProps {
    onBack: () => void;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'llm'>('overview');
    const [tasks, setTasks] = useState<SystemTask[]>([]);
    const [stats, setStats] = useState<LLMStats | null>(null);
    const [healthResults, setHealthResults] = useState<LLMHealthResult[]>([]);
    const [isRunningHealth, setIsRunningHealth] = useState(false);
    const [connected, setConnected] = useState(false);
    const [logs, setLogs] = useState<string[]>([]); // Real-time log stream
    const wsRef = useRef<WebSocket | null>(null);

    // Initial Data Load
    useEffect(() => {
        loadData();
        connectWs();
        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    const loadData = async () => {
        try {
            const t = await adminService.getTasks();
            setTasks(t);
            const s = await adminService.getLLMStats();
            setStats(s);
        } catch (e) {
            console.error("Failed to load admin data", e);
        }
    };

    const connectWs = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}/api/admin/ws?token=admin-secret-123`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => setConnected(true);
        ws.onclose = () => setConnected(false);
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'task_created') {
                    setTasks(prev => [msg.task, ...prev]);
                } else if (msg.type === 'task_updated') {
                    setTasks(prev => prev.map(t => t.id === msg.task.id ? msg.task : t));
                } else if (msg.type === 'task_log') {
                    setLogs(prev => [`[Task ${msg.task_id.substring(0,4)}] ${msg.log}`, ...prev.slice(0, 99)]);
                }
            } catch (e) {
                console.error("WS Parse error", e);
            }
        };
        wsRef.current = ws;
    };

    // Derived Stats
    const taskStatusData = [
        { name: 'Completed', value: tasks.filter(t => t.status === 'completed').length, color: '#10b981' },
        { name: 'Failed', value: tasks.filter(t => t.status === 'failed').length, color: '#ef4444' },
        { name: 'Running', value: tasks.filter(t => t.status === 'running').length, color: '#3b82f6' },
        { name: 'Pending', value: tasks.filter(t => t.status === 'pending').length, color: '#94a3b8' },
    ];

    const llmModelData = stats?.by_model.map(m => ({
        name: m.model.split('/').pop() || m.model,
        calls: m.count,
        latency: Math.round(m.avg_latency * 1000)
    })) || [];

    const renderOverview = () => (
        <div className="space-y-6">
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500">Total Tasks</p>
                        <h3 className="text-2xl font-bold text-slate-800">{tasks.length}</h3>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-full text-blue-600"><Database size={20} /></div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500">Active Jobs</p>
                        <h3 className="text-2xl font-bold text-slate-800">{tasks.filter(t => t.status === 'running').length}</h3>
                    </div>
                    <div className="p-3 bg-green-50 rounded-full text-green-600"><Activity size={20} /></div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500">LLM Calls</p>
                        <h3 className="text-2xl font-bold text-slate-800">{stats?.total_calls || 0}</h3>
                    </div>
                    <div className="p-3 bg-purple-50 rounded-full text-purple-600"><Server size={20} /></div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500">Total Cost</p>
                        <h3 className="text-2xl font-bold text-slate-800">${(stats?.total_cost || 0).toFixed(4)}</h3>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-full text-yellow-600"><Download size={20} /></div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">Task Status Distribution</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                    {taskStatusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">LLM Usage by Model</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={llmModelData}>
                                <XAxis dataKey="name" fontSize={12} />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="calls" fill="#8884d8" name="Calls" />
                                <Bar dataKey="latency" fill="#82ca9d" name="Avg Latency (ms)" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Live Logs */}
            <div className="bg-slate-900 text-slate-300 p-4 rounded-lg shadow-sm overflow-hidden h-64 flex flex-col">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
                    <Terminal size={16} />
                    <span className="font-mono text-sm font-bold">System Live Logs</span>
                    {connected && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse ml-auto"></span>}
                </div>
                <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1">
                    {logs.length === 0 && <span className="text-slate-600">Waiting for events...</span>}
                    {logs.map((log, i) => (
                        <div key={i} className="break-all hover:bg-slate-800 p-0.5 rounded">{log}</div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderTaskList = () => (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <Database size={18} /> Task History
                </h3>
                <div className="flex gap-2">
                    <button onClick={loadData} className="p-2 hover:bg-slate-200 rounded text-slate-600"><RefreshCw size={16} /></button>
                    <a href={adminService.getExportUrl('system_tasks')} target="_blank" className="flex items-center gap-2 px-3 py-1.5 bg-brand-600 text-white text-xs rounded hover:bg-brand-700 transition-colors">
                        <Download size={14} /> Export CSV
                    </a>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-3">ID</th>
                            <th className="px-6 py-3">Type</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3">Created</th>
                            <th className="px-6 py-3">Duration</th>
                            <th className="px-6 py-3">Result/Error</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map(task => (
                            <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-6 py-4 font-mono text-xs text-slate-500">{task.id.slice(0, 8)}...</td>
                                <td className="px-6 py-4">
                                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs font-bold uppercase">{task.task_type}</span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit
                                        ${task.status === 'completed' ? 'bg-green-100 text-green-700' : 
                                          task.status === 'failed' ? 'bg-red-100 text-red-700' : 
                                          task.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}
                                    `}>
                                        {task.status === 'completed' && <CheckCircle size={12} />}
                                        {task.status === 'failed' && <XCircle size={12} />}
                                        {task.status === 'running' && <RefreshCw size={12} className="animate-spin" />}
                                        {task.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-slate-600">{new Date(task.created_at * 1000).toLocaleString()}</td>
                                <td className="px-6 py-4 text-slate-500">
                                    {task.updated_at ? ((task.updated_at - task.created_at).toFixed(2) + 's') : '-'}
                                </td>
                                <td className="px-6 py-4 max-w-xs truncate text-slate-500" title={task.error || JSON.stringify(task.result)}>
                                    {task.error ? <span className="text-red-600">{task.error}</span> : JSON.stringify(task.result)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const runHealthCheck = async () => {
        setIsRunningHealth(true);
        try {
            const results = await adminService.runLLMHealthCheck();
            setHealthResults(results);
        } catch (e) {
            console.error(e);
            alert("Health check failed to start");
        } finally {
            setIsRunningHealth(false);
        }
    };

    const renderLLMMonitor = () => (
        <div className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-red-100 rounded-full text-red-600"><AlertCircle size={24} /></div>
                    <div>
                        <h3 className="text-xl font-bold text-red-700">{stats?.failed_calls || 0}</h3>
                        <p className="text-sm text-red-500">Failed Calls</p>
                    </div>
                </div>
                <div className="bg-green-50 border border-green-100 p-4 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-green-100 rounded-full text-green-600"><CheckCircle size={24} /></div>
                    <div>
                        <h3 className="text-xl font-bold text-green-700">{(stats?.total_calls || 0) - (stats?.failed_calls || 0)}</h3>
                        <p className="text-sm text-green-500">Successful Calls</p>
                    </div>
                </div>
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-blue-100 rounded-full text-blue-600"><Clock size={24} /></div>
                    <div>
                        <h3 className="text-xl font-bold text-blue-700">
                            {stats?.by_model.reduce((acc, curr) => acc + curr.avg_latency, 0).toFixed(2)}s
                        </h3>
                        <p className="text-sm text-blue-500">Avg Latency</p>
                    </div>
                </div>
            </div>

            {/* Health Check Section */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Activity size={18} /> System Health Check
                    </h3>
                    <button 
                        onClick={runHealthCheck}
                        disabled={isRunningHealth}
                        className={`flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors ${isRunningHealth ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isRunningHealth ? <RefreshCw size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                        Run Diagnostics
                    </button>
                </div>
                
                {healthResults.length > 0 ? (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3">Task</th>
                                    <th className="px-4 py-3">Model Configured</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Latency</th>
                                    <th className="px-4 py-3">Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {healthResults.map((res, i) => (
                                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                        <td className="px-4 py-3 font-medium text-slate-700 capitalize">{res.task.replace('_', ' ')}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{res.model}</td>
                                        <td className="px-4 py-3">
                                            {res.status === 'success' ? (
                                                <span className="flex items-center gap-1 text-green-600 font-bold text-xs"><CheckCircle size={14} /> PASS</span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-red-600 font-bold text-xs"><XCircle size={14} /> FAIL</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{(res.latency * 1000).toFixed(0)}ms</td>
                                        <td className="px-4 py-3 text-red-500 text-xs max-w-xs truncate" title={res.error}>{res.error || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-8 text-slate-400 bg-slate-50 rounded border border-dashed border-slate-200">
                        Click "Run Diagnostics" to verify all configured LLM endpoints.
                    </div>
                )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Server size={18} /> Historical Performance
                </h3>
                <div className="space-y-4">
                    {stats?.by_model.map((m, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                            <div className="flex flex-col">
                                <span className="font-medium text-slate-700">{m.model}</span>
                                <span className="text-xs text-slate-500">{m.count} calls</span>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <div className="text-sm font-bold text-slate-700">{Math.round(m.avg_latency * 1000)}ms</div>
                                    <div className="text-xs text-slate-400">Latency</div>
                                </div>
                                <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (m.count / (stats?.total_calls || 1)) * 100)}%` }}></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-100 flex flex-col">
            <header className="bg-slate-900 text-white h-16 flex items-center justify-between px-6 shadow-md">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-brand-500 rounded flex items-center justify-center font-bold">A</div>
                    <h1 className="font-serif font-bold text-lg">Admin Dashboard</h1>
                </div>
                <div className="flex gap-4">
                    <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">Exit Admin</button>
                </div>
            </header>
            
            <div className="flex flex-1 overflow-hidden">
                <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                    <nav className="p-4 space-y-2">
                        <button 
                            onClick={() => setActiveTab('overview')}
                            className={`w-full text-left px-4 py-3 rounded-md flex items-center gap-3 transition-colors ${activeTab === 'overview' ? 'bg-slate-100 text-brand-600 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <Activity size={18} /> Overview
                        </button>
                        <button 
                            onClick={() => setActiveTab('tasks')}
                            className={`w-full text-left px-4 py-3 rounded-md flex items-center gap-3 transition-colors ${activeTab === 'tasks' ? 'bg-slate-100 text-brand-600 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <Database size={18} /> Task Monitor
                        </button>
                        <button 
                            onClick={() => setActiveTab('llm')}
                            className={`w-full text-left px-4 py-3 rounded-md flex items-center gap-3 transition-colors ${activeTab === 'llm' ? 'bg-slate-100 text-brand-600 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <Server size={18} /> LLM Health
                        </button>
                    </nav>
                    <div className="mt-auto p-4 border-t border-slate-200">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            {connected ? 'System Online' : 'Disconnected'}
                        </div>
                    </div>
                </aside>
                
                <main className="flex-1 overflow-y-auto p-8">
                    {activeTab === 'overview' && renderOverview()}
                    {activeTab === 'tasks' && renderTaskList()}
                    {activeTab === 'llm' && renderLLMMonitor()}
                </main>
            </div>
        </div>
    );
};

export default AdminDashboard;
