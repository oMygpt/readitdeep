import React, { useMemo, useState } from 'react';
import { Paper, SearchResult } from '../types';

interface LibraryViewProps {
  papers: Paper[];
  searchResults?: SearchResult[];
  onSelectPaper: (paper: Paper) => void;
  onListen: (paper: Paper) => void;
  onUpload: () => void;
  onSearch?: (query: string) => void;
  onRefresh?: () => void;
  onDelete: (paper: Paper) => void;
  onDeleteBatch?: (paperIds: string[]) => void;
  isUploading?: boolean;
}

const MOCK_RELATIONS: Record<string, string[]> = {
    'Transformers': ['BERT vs GPT: Comparative Analysis', 'Efficient Transformers Survey'],
    'Computer Vision': ['Vision Transformers (ViT) Deep Dive', 'YOLOv8 Performance Benchmarks'],
    'Reinforcement Learning': ['Multi-Agent RL Strategies', 'Reward Shaping Techniques'],
    'LLM Optimization': ['QLoRA vs LoRA Benchmarks', '1-Bit LLMs: The Era of Quantization'],
};

const LibraryView: React.FC<LibraryViewProps> = ({ papers, searchResults, onSelectPaper, onListen, onUpload, onSearch, onRefresh, onDelete, onDeleteBatch, isUploading }) => {
  const [localSearch, setLocalSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;

  const toggleSelection = (e: React.MouseEvent, paperId: string) => {
      e.stopPropagation();
      const newSet = new Set(selectedIds);
      if (newSet.has(paperId)) {
          newSet.delete(paperId);
      } else {
          newSet.add(paperId);
      }
      setSelectedIds(newSet);
  };

  const handleBatchDelete = () => {
      if (selectedIds.size === 0) return;
      if (window.confirm(`Delete ${selectedIds.size} papers?`)) {
          if (onDeleteBatch) {
              onDeleteBatch(Array.from(selectedIds));
              setSelectedIds(new Set());
          }
      }
  };

  const clearSelection = () => {
      setSelectedIds(new Set());
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalSearch(e.target.value);
      if (onSearch) onSearch(e.target.value);
  };
  
  // Polling for pending papers
  React.useEffect(() => {
      const hasPending = papers.some(p => p.processing_status === 'pending' || p.processing_status === 'processing');
      if (!hasPending) return;

      const interval = setInterval(() => {
          if (onRefresh) {
              onRefresh();
          } else if (onSearch && !localSearch) {
              onSearch(''); 
          }
      }, 3000);

      return () => clearInterval(interval);
  }, [papers, onSearch, localSearch, onRefresh]);

  const handleSearchResultClick = (result: SearchResult) => {
      const paper = papers.find(p => p.id === result.paper_id);
      if (paper) {
          onSelectPaper(paper);
      } else {
          console.warn("Paper found in search but not in local library list", result.paper_id);
          onSelectPaper({ id: result.paper_id, title: result.title, authors: 'Unknown', category: 'Search Result', date: 'Unknown', readStatus: 'unread' } as any);
      }
  };
  // Group papers by category
  const categories = useMemo(() => {
    const groups: { [key: string]: Paper[] } = {};
    papers.forEach(p => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    });
    return groups;
  }, [papers]);

  // Generate suggestions based on library content
  const suggestions = useMemo(() => {
    const recs: Array<{title: string, category: string}> = [];
    const cats = Array.from(new Set(papers.map(p => p.category)));
    
    cats.forEach(cat => {
        const potential = MOCK_RELATIONS[cat] || [`Emerging Trends in ${cat}`, `Seminal Papers in ${cat}`];
        potential.forEach(t => recs.push({ title: t, category: cat }));
    });
    
    return recs.slice(0, 5);
  }, [papers]);

  const recentPaper = papers.length > 0 ? papers[0] : null;
  const relatedToRecent = useMemo(() => {
    if (!recentPaper) return [];
    return [
        { title: `Advanced ${recentPaper.category} Techniques`, date: '2023' },
        { title: `Critique of ${recentPaper.title.split(':')[0]}`, date: '2024' }
    ];
  }, [recentPaper]);

  const handleListenClick = (e: React.MouseEvent, paper: Paper) => {
      e.stopPropagation();
      onListen(paper);
    };

    const handleDeleteClick = (e: React.MouseEvent, paper: Paper) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation();
        if (window.confirm(`Are you sure you want to delete "${paper.title}"?`)) {
            onDelete(paper);
        }
    };

  return (
    <div className="flex h-full bg-slate-50">
      {/* Sidebar Categories */}
      <div className="w-72 bg-slate-50 border-r border-slate-200 flex flex-col pt-8 overflow-y-auto no-scrollbar hidden lg:flex">
        
        {/* Search Bar */}
        <div className="px-6 mb-6">
            <div className="relative">
                <input 
                    type="text" 
                    className="w-full bg-white border border-slate-300 rounded-md py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="Search library..."
                    value={localSearch}
                    onChange={handleSearchChange}
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
        </div>

        <div className="px-6 mb-8">
           <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Smart Collections</h2>
           <div className="space-y-1">
             {Object.keys(categories).map(cat => (
               <div key={cat} className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-slate-200 cursor-pointer text-slate-700 text-sm font-medium group transition-colors">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400 group-hover:text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                    {cat}
                  </div>
                  <span className="bg-slate-200 text-slate-500 text-xs px-2 py-0.5 rounded-full group-hover:bg-white transition-colors">{categories[cat].length}</span>
               </div>
             ))}
           </div>
        </div>

        {/* New Related Papers Section */}
        {recentPaper && (
            <div className="px-6 mb-8">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Related to Recent</h2>
                <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
                    <div className="text-[10px] text-brand-600 font-bold mb-2 flex items-center gap-1">
                         <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
                         Based on "{recentPaper.title.substring(0, 15)}..."
                    </div>
                    <div className="space-y-3">
                        {relatedToRecent.map((item, idx) => (
                            <div key={idx} className="flex items-start gap-2 group cursor-pointer">
                                <div className="mt-1">
                                    <svg className="w-3 h-3 text-slate-400 group-hover:text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-700 font-medium leading-tight group-hover:text-brand-700 transition-colors">{item.title}</div>
                                    <div className="text-[10px] text-slate-400">{item.date} • AI Suggested</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* AI Suggestions Section */}
        <div className="px-6 mb-6">
           <div className="flex items-center justify-between mb-4">
               <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Suggested Readings</h2>
               <span className="bg-gradient-to-r from-brand-500 to-purple-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">AI</span>
           </div>
           <div className="space-y-4">
             {suggestions.map((sug, idx) => (
               <div key={idx} className="group cursor-pointer p-3 rounded-lg border border-transparent hover:bg-white hover:shadow-sm hover:border-slate-100 transition-all">
                  <div className="text-[10px] text-brand-600 font-semibold mb-1 uppercase tracking-wider">{sug.category}</div>
                  <div className="text-sm text-slate-700 font-medium leading-snug group-hover:text-brand-700 transition-colors">
                    {sug.title}
                  </div>
                  <div className="mt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add
                    </button>
                    <button className="text-[10px] text-slate-400 hover:text-slate-600 px-1">Dismiss</button>
                  </div>
               </div>
             ))}
             <div className="text-center pt-2">
                 <button className="text-xs text-slate-400 hover:text-brand-600 font-medium transition-colors">View All Recommendations →</button>
             </div>
           </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
         {localSearch.length > 1 && searchResults ? (
             <div className="max-w-4xl mx-auto">
                 <h2 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                    <svg className="w-6 h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    Search Results <span className="text-slate-400 text-sm font-normal">({searchResults.length} found)</span>
                 </h2>
                 <div className="space-y-4">
                     {searchResults.map((res, idx) => (
                         <div 
                            key={res.paper_id + idx} 
                            onClick={() => handleSearchResultClick(res)} 
                            className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all group"
                         >
                             <h3 className="font-serif font-bold text-lg text-slate-800 group-hover:text-brand-700 transition-colors">{res.title}</h3>
                             <div className="text-sm text-slate-600 mt-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: res.snippet }} />
                             <div className="mt-2 text-xs text-slate-400 font-medium">Relevance Score: {res.rank.toFixed(2)}</div>
                         </div>
                     ))}
                     {searchResults.length === 0 && (
                         <div className="text-center py-12">
                             <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                             </div>
                             <h3 className="text-slate-600 font-medium">No matches found</h3>
                             <p className="text-slate-400 text-sm mt-1">Try searching for different keywords</p>
                         </div>
                     )}
                 </div>
             </div>
         ) : (
            <>
         <div className="flex justify-between items-center mb-8">
            <h1 className="text-2xl font-serif font-bold text-slate-800">Library</h1>
            <div className="flex gap-2">
                {isSelectionMode && (
                    <button 
                        onClick={clearSelection}
                        className="text-slate-500 hover:text-slate-800 px-3 py-2 text-sm font-medium transition-colors"
                    >
                        Cancel ({selectedIds.size})
                    </button>
                )}
                {isSelectionMode && onDeleteBatch && (
                    <button 
                        onClick={handleBatchDelete}
                        className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-md shadow-sm text-sm font-medium flex items-center gap-2 transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Delete Selected
                    </button>
                )}
                <button 
                    onClick={onUpload}
                    className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-md shadow-sm text-sm font-medium flex items-center gap-2 transition-all hover:shadow-md"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Import Paper
                </button>
            </div>
         </div>

         {/* Grid */}
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {/* Upload Card */}
            <div 
                onClick={onUpload}
                className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 hover:bg-brand-50/50 transition-all cursor-pointer min-h-[180px] group"
            >
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <span className="font-medium text-center">Drop PDF to Auto-Classify</span>
            </div>

            {/* Uploading Placeholder */}
            {isUploading && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-brand-100 animate-pulse flex flex-col">
                    <div className="absolute top-4 right-4 text-xs font-semibold text-slate-300 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                        Today
                    </div>
                    <div className="mb-auto">
                        <div className="h-3 w-20 bg-slate-200 rounded mb-3"></div>
                        <div className="h-6 w-3/4 bg-slate-200 rounded mb-2"></div>
                        <div className="h-4 w-1/2 bg-slate-200 rounded"></div>
                        
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-xs font-medium text-brand-600 mb-1">
                                <span className="flex items-center gap-2">
                                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Uploading...
                                </span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-brand-500 h-1.5 rounded-full animate-progress-indeterminate"></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {papers.map(paper => {
                const isProcessing = paper.processing_status === 'pending' || paper.processing_status === 'processing' || paper.readStatus === 'uploading';
                const isFailed = paper.processing_status === 'failed';
                
                return (
                <div 
                    key={paper.id}
                    onClick={() => {
                        if (isProcessing) return; // Disable click
                        if (isSelectionMode) {
                            toggleSelection({ stopPropagation: () => {} } as any, paper.id);
                        } else {
                            onSelectPaper(paper);
                        }
                    }}
                    className={`bg-white rounded-xl p-5 shadow-sm border transition-all flex flex-col relative group
                        ${isProcessing ? 'opacity-80 cursor-not-allowed border-brand-100' : 'cursor-pointer'}
                        ${selectedIds.has(paper.id) 
                            ? 'border-brand-500 ring-2 ring-brand-100 shadow-md' 
                            : !isProcessing ? 'border-slate-200 hover:shadow-md hover:border-brand-200' : ''}
                    `}
                >
                    {/* Selection Checkbox (Disable during processing?) No, allow delete */}
                    <div 
                        onClick={(e) => toggleSelection(e, paper.id)}
                        className={`absolute top-4 left-4 w-5 h-5 rounded border flex items-center justify-center transition-all z-10
                            ${selectedIds.has(paper.id)
                                ? 'bg-brand-500 border-brand-500 text-white'
                                : 'bg-white border-slate-300 text-transparent opacity-0 group-hover:opacity-100 hover:border-brand-400'}
                            ${isSelectionMode ? 'opacity-100' : ''}
                        `}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>

                    <div className="absolute top-4 right-4 flex gap-2">
                        {(paper as any).has_translation && (
                            <span className="text-[10px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1" title="Translation Ready">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                                CN
                            </span>
                        )}
                        <span className="text-xs font-semibold text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                            {paper.date}
                        </span>
                    </div>
                    
                    <div className="mb-auto">
                        <div className="text-[10px] font-bold text-brand-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
                            {paper.category}
                        </div>
                        <h3 className="font-serif font-bold text-slate-800 text-lg leading-tight mb-2 group-hover:text-brand-700 transition-colors">
                            {paper.title}
                        </h3>
                        <p className="text-sm text-slate-500 line-clamp-2">{paper.authors}</p>
                        
                        {/* Processing Status Indicator */}
                        {isProcessing && (
                            <div className="mt-3">
                                <div className="flex items-center justify-between text-xs font-medium text-brand-600 mb-1">
                                    <span className="flex items-center gap-2">
                                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        {paper.readStatus === 'uploading' ? 'Uploading...' : 'AI Analysis in progress...'}
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-brand-500 h-1.5 rounded-full animate-progress-indeterminate"></div>
                                </div>
                            </div>
                        )}
                        {isFailed && (
                             <div className="mt-2 flex items-center gap-2 text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded w-fit">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Parsing Failed
                            </div>
                        )}
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                         <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                             paper.readStatus === 'completed' ? 'bg-green-100 text-green-700' : 
                             paper.readStatus === 'reading' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'
                         }`}>
                             {paper.readStatus === 'completed' ? 'Completed' : paper.readStatus === 'reading' ? 'In Progress' : 'Unread'}
                         </span>
                         
                         <div className="flex gap-2">
                             <button 
                                onClick={(e) => handleListenClick(e, paper)}
                                className={`p-1.5 rounded-full transition-colors ${isProcessing ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-brand-600 bg-slate-50 hover:bg-brand-50'}`}
                                title="Listen to Paper (Zen Mode)"
                                disabled={isProcessing}
                             >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                             </button>
                             <button 
                                className="text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 p-1.5 rounded-full transition-colors"
                                onClick={(e) => handleDeleteClick(e, paper)}
                                title="Delete Paper"
                             >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                             </button>
                         </div>
                    </div>
                </div>
            )})}
         </div>
         </>
         )}
      </div>
    </div>
  );
};

export default LibraryView;