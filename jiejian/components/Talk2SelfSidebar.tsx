import React, { useState } from 'react';
import { JournalEntry } from '../types';

interface Talk2SelfSidebarProps {
  paperTitle: string;
  authors: string;
}

const Talk2SelfSidebar: React.FC<Talk2SelfSidebarProps> = ({ paperTitle, authors }) => {
  const [entries, setEntries] = useState<JournalEntry[]>([
    { 
        id: '1', 
        content: 'This methodology of decomposing matrices into low-rank equivalents feels very similar to what we see in image compression. I wonder if we can apply this to the new attention layer we are designing.', 
        timestamp: Date.now() - 10000000 
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const handleAddEntry = () => {
    if (!inputValue.trim()) return;
    
    const newEntry: JournalEntry = {
        id: Date.now().toString(),
        content: inputValue,
        timestamp: Date.now()
    };

    setEntries(prev => [newEntry, ...prev]);
    setInputValue('');
  };

  const handleExport = () => {
      setIsExporting(true);
      
      // Construct the document content
      const citation = `${paperTitle}, ${authors} (2022)`;
      const date = new Date().toLocaleDateString();
      
      let docContent = `Research Notes: ${paperTitle}\nDate: ${date}\n\n`;
      docContent += `--- Thoughts & Drafts ---\n\n`;
      
      entries.forEach(entry => {
          docContent += `[${new Date(entry.timestamp).toLocaleTimeString()}]\n${entry.content}\n\n`;
      });
      
      docContent += `\n--- Citation ---\n${citation}\nExported from Read it Deep`;

      // Mock API Call to Google Docs
      setTimeout(() => {
          setIsExporting(false);
          alert(`Successfully exported to Google Docs!\n\nDocument Title: "Notes: ${paperTitle.substring(0, 20)}..."\nCitation attached automatically.`);
      }, 1500);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-10 flex justify-between items-center">
        <div>
            <h2 className="font-semibold text-slate-800">Talk2Self</h2>
            <p className="text-[10px] text-slate-500">Private Journal & Drafts</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </div>
      </div>
      
      {/* List of Entries */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
         {entries.length === 0 && (
             <div className="text-center text-slate-400 py-10">
                 <p className="text-sm">No thoughts recorded yet.</p>
                 <p className="text-xs mt-1">Capture your ideas while you read.</p>
             </div>
         )}
         
         {entries.map((entry) => (
             <div key={entry.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group relative">
                 <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed font-serif">{entry.content}</p>
                 <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
                     <span className="text-[10px] text-slate-400 font-medium">{new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}</span>
                     <button className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                     </button>
                 </div>
                 <div className="absolute -left-1 top-4 w-1 h-8 bg-brand-400 rounded-r opacity-0 group-hover:opacity-100 transition-opacity"></div>
             </div>
         ))}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-200">
          <div className="relative mb-3">
            <textarea 
                className="w-full h-32 p-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none outline-none transition-all placeholder:text-slate-400"
                placeholder="What's on your mind? Draft a paragraph or note a connection..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) handleAddEntry();
                }}
            />
            <div className="absolute bottom-2 right-2 text-[10px] text-slate-400">
                Cmd+Enter
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
                onClick={handleAddEntry}
                disabled={!inputValue.trim()}
                className="flex-1 bg-slate-900 text-white py-2 rounded-md text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
                Add Note
            </button>
            <button 
                onClick={handleExport}
                disabled={isExporting}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-md text-sm font-medium hover:bg-slate-50 hover:text-brand-600 transition-all flex items-center justify-center gap-2"
                title="Export to Google Docs"
            >
                {isExporting ? (
                    <svg className="w-4 h-4 animate-spin text-brand-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                ) : (
                    <>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2zM14 8V4l4 4h-4z" /></svg>
                        <span className="hidden xl:inline">Save to Docs</span>
                    </>
                )}
            </button>
          </div>
      </div>
    </div>
  );
};

export default Talk2SelfSidebar;