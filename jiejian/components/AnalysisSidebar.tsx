import React, { useState } from 'react';
import { AnalysisSection } from '../types';

interface AnalysisSidebarProps {
  sections: AnalysisSection[];
}

const AnalysisSidebar: React.FC<AnalysisSidebarProps> = ({ sections }) => {
  // Track open sections. Default all open.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    framework: true,
    methodology: false,
    data: false,
    code: false
  });

  const toggleSection = (id: string) => {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleJumpTo = (targetId: string) => {
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Flash effect
      element.classList.add('bg-yellow-100', 'transition-colors', 'duration-500');
      setTimeout(() => {
        element.classList.remove('bg-yellow-100');
      }, 1500);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 overflow-y-auto no-scrollbar pb-20">
      <div className="p-4 border-b border-slate-200 font-semibold text-slate-700 bg-white sticky top-0 z-10 shadow-sm">
        Paper Analysis
      </div>
      
      <div className="p-2 space-y-2">
        {sections.map((section) => (
          <div key={section.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <button 
              onClick={() => toggleSection(section.id)}
              className="w-full px-4 py-3 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="font-semibold text-sm text-slate-700">{section.title}</span>
              <svg 
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSections[section.id] ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {openSections[section.id] && (
              <div className="border-t border-slate-100">
                {section.items.map((item, idx) => (
                  <div 
                    key={idx}
                    onClick={() => handleJumpTo(item.targetId)}
                    className="p-3 cursor-pointer hover:bg-brand-50 transition-colors border-b border-slate-50 last:border-0 group relative"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      <span className="text-sm font-medium text-slate-700 group-hover:text-brand-700">{item.label}</span>
                    </div>
                    {item.preview && (
                       <p className="text-[11px] text-slate-400 pl-3.5 leading-relaxed line-clamp-2">
                         {item.preview}
                       </p>
                    )}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <svg className="w-4 h-4 text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalysisSidebar;
