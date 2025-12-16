import React from 'react';
import { PromptType } from '../types';

interface ActionToolbarProps {
  x: number;
  y: number;
  onAction: (type: PromptType) => void;
}

const ActionToolbar: React.FC<ActionToolbarProps> = ({ x, y, onAction }) => {
  const actions = [
    { type: PromptType.NOTE, icon: '📝', label: 'Take Note' },
    { type: PromptType.EXPLAIN_SIMPLE, icon: '👶', label: 'Explain' },
    { type: PromptType.MATH_TUTOR, icon: '🧙‍♂️', label: 'Math Tutor' },
    { type: PromptType.CRITIQUE, icon: '🧐', label: 'Critique' },
  ];

  return (
    <div 
      className="fixed z-50 animate-bounce-in flex gap-1 bg-slate-900 p-1.5 rounded-full shadow-xl shadow-slate-900/20"
      style={{ top: y - 60, left: x - 140 }}
    >
      {actions.map((action) => (
        <button
          key={action.type}
          onClick={() => onAction(action.type)}
          className="flex flex-col items-center justify-center w-16 h-12 rounded-lg hover:bg-slate-700 text-white transition-colors group"
          title={action.label}
        >
          <span className="text-lg mb-0.5">{action.icon}</span>
          <span className="text-[9px] font-medium leading-none opacity-80 group-hover:opacity-100">{action.label}</span>
        </button>
      ))}
      
      {/* Little arrow at bottom */}
      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 rotate-45"></div>
    </div>
  );
};

export default ActionToolbar;
