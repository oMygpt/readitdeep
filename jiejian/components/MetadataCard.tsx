import React from 'react';

interface MetadataCardProps {
    title: string;
    authors: string;
    onListen: () => void;
}

const MetadataCard: React.FC<MetadataCardProps> = ({ title, authors, onListen }) => {
  return (
    <div className="bg-white border-b border-slate-200 p-4 md:px-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 z-20 shadow-sm">
        <div className="max-w-3xl">
            <h1 className="text-xl md:text-2xl font-serif font-bold text-slate-900 leading-tight mb-1">
                {title}
            </h1>
            <div className="flex items-center text-sm text-slate-500 gap-2 flex-wrap">
                <span className="font-medium text-slate-700">{authors}</span>
                <span className="hidden md:inline">•</span>
                <span>ArXiv:2106.09685</span>
                <span className="hidden md:inline">•</span>
                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium">CS.CL</span>
            </div>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
            <button 
                onClick={onListen}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all shadow-md hover:shadow-lg text-sm font-medium"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Listen
            </button>
            <button className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                PDF
            </button>
        </div>
    </div>
  );
};

export default MetadataCard;