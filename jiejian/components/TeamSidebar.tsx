import React, { useState } from 'react';
import { TeamComment } from '../types';

interface TeamSidebarProps {
  comments: TeamComment[];
}

const TeamSidebar: React.FC<TeamSidebarProps> = ({ comments: initialComments }) => {
  const [localComments, setLocalComments] = useState<TeamComment[]>(initialComments);
  const [inputValue, setInputValue] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

  const handleAskAi = () => {
      setIsAiTyping(true);
      // Simulate AI processing
      setTimeout(() => {
          const aiComment: TeamComment = {
              id: Date.now().toString(),
              author: 'Deep Read AI',
              avatarColor: '#6366f1',
              content: 'Based on the team\'s discussion, there is a consensus that the low-rank approximation in LoRA effectively balances efficiency and performance. Bob\'s comparison to ResNet skip connections is particularly insightful, suggesting a geometric interpretation of the adaptation process.',
              timestamp: 'Just now',
              isAi: true
          };
          setLocalComments(prev => [...prev, aiComment]);
          setIsAiTyping(false);
      }, 1500);
  };

  const handleSendMessage = () => {
      if (!inputValue.trim()) return;

      const newComment: TeamComment = {
          id: Date.now().toString(),
          author: 'Me',
          avatarColor: '#1e293b',
          content: inputValue,
          timestamp: 'Just now',
          replies: 0
      };
      setLocalComments(prev => [...prev, newComment]);
      
      // Check for @AI mention (case insensitive)
      const shouldSummonAi = inputValue.toLowerCase().includes('@ai') || inputValue.trim() === '@';
      
      setInputValue('');

      if (shouldSummonAi) {
          handleAskAi();
      }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 overflow-y-auto no-scrollbar pb-20">
      <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm flex justify-between items-center">
        <span className="font-semibold text-slate-700">Team Activity</span>
        <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-0.5 rounded-full">3 Online</span>
      </div>
      
      <div className="p-4 space-y-6">
         {/* Pinned Note */}
         <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 relative">
            <div className="absolute -top-2 -right-2 bg-yellow-400 text-white p-1 rounded-full shadow-sm">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" /></svg>
            </div>
            <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-slate-800 text-white text-[10px] flex items-center justify-center font-bold">AL</div>
                <span className="text-xs font-bold text-slate-800">Alice (Lead)</span>
            </div>
            <p className="text-sm text-slate-700 font-medium">Please review the "Matrix Decomposition" section specifically for our implementation meeting tomorrow.</p>
         </div>

         {/* Feed */}
         {localComments.map((comment) => (
             <div key={comment.id} className="group">
                 <div className="flex gap-3 mb-1">
                     <div 
                        className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm ${comment.isAi ? 'bg-gradient-to-tr from-brand-500 to-purple-500' : ''}`}
                        style={{ backgroundColor: comment.isAi ? undefined : comment.avatarColor }}
                     >
                         {comment.isAi ? 'AI' : comment.author.substring(0, 2).toUpperCase()}
                     </div>
                     <div className={`flex-1 min-w-0 bg-white p-3 rounded-lg rounded-tl-none border shadow-sm hover:shadow-md transition-shadow ${comment.isAi ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200'}`}>
                         <div className="flex justify-between items-start mb-1">
                             <span className={`text-xs font-bold ${comment.isAi ? 'text-brand-700' : 'text-slate-900'}`}>
                                 {comment.author} {comment.isAi && '✨'}
                             </span>
                             <span className="text-[10px] text-slate-400">{comment.timestamp}</span>
                         </div>
                         
                         {comment.highlight && (
                             <div className="mb-2 pl-2 border-l-2 border-slate-300 text-xs text-slate-500 italic line-clamp-2">
                                 "{comment.highlight}"
                             </div>
                         )}
                         
                         <p className="text-sm text-slate-700 leading-snug">{comment.content}</p>
                         
                         <div className="mt-3 pt-2 border-t border-slate-50 flex items-center gap-4 text-xs text-slate-400">
                             <button className="hover:text-brand-600 font-medium flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                Reply {comment.replies ? `(${comment.replies})` : ''}
                             </button>
                             <button className="hover:text-red-500">Like</button>
                         </div>
                     </div>
                 </div>
             </div>
         ))}
         
         {isAiTyping && (
             <div className="flex gap-3 animate-pulse">
                 <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold">AI</div>
                 <div className="flex items-center gap-1 bg-white px-3 py-2 rounded-lg border border-slate-100">
                     <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce"></span>
                     <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-75"></span>
                     <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-150"></span>
                 </div>
             </div>
         )}
      </div>
      
      {/* Quick Input */}
      <div className="p-3 bg-white border-t border-slate-200 sticky bottom-0">
          <div className="relative">
            <input 
                type="text" 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Discuss with team... (Type @AI for help)"
                className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
            />
            <button 
                onClick={handleAskAi}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-brand-500 hover:text-brand-700 hover:bg-brand-50 rounded-full transition-colors"
                title="Summarize Discussion (AI)"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </button>
          </div>
      </div>
    </div>
  );
};

export default TeamSidebar;