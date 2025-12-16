import React, { useState, useEffect } from 'react';
import { Note } from '../types';
import { apiService } from '../services/api';

interface NotesPanelProps {
  notes: Note[];
  onAddNote: (note: Note) => void;
}

const NotesPanel: React.FC<NotesPanelProps> = ({ notes, onAddNote }) => {
  const [currentInput, setCurrentInput] = useState('');
  const [suggestion, setSuggestion] = useState<string[]>([]);
  const [isAnalysing, setIsAnalysing] = useState(false);

  // Debounce analysis
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (currentInput.length > 10) {
        setIsAnalysing(true);
        try {
          const result = await apiService.analyzeNoteForLinks(currentInput);
          setSuggestion(result.suggestedLinks);
        } catch (error) {
           console.error(error);
        } finally {
          setIsAnalysing(false);
        }
      } else {
        setSuggestion([]);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [currentInput]);

  const handleSave = () => {
    if (!currentInput.trim()) return;
    const newNote: Note = {
      id: Date.now().toString(),
      content: currentInput,
      timestamp: Date.now(),
      author: 'Alice',
      linkedConcepts: suggestion
    };
    onAddNote(newNote);
    setCurrentInput('');
    setSuggestion([]);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 shadow-xl">
      <div className="p-4 border-b border-slate-200 font-semibold text-slate-700 bg-white">
        Deep Notes
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {notes.length === 0 && (
            <div className="text-center text-slate-400 mt-10 text-sm">
                No notes yet. <br/> Jot down your thoughts to find connections.
            </div>
        )}
        {notes.map(note => (
          <div key={note.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 group">
            <p className="text-slate-800 text-sm whitespace-pre-wrap font-sans">{note.content}</p>
            {note.linkedConcepts && note.linkedConcepts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="text-xs text-brand-600 font-medium flex items-center gap-1">
                       <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                       Linked to: {note.linkedConcepts.join(", ")}
                    </div>
                </div>
            )}
            <div className="mt-2 text-[10px] text-slate-400">
                {new Date(note.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 bg-white border-t border-slate-200">
        {suggestion.length > 0 && (
            <div className="mb-2 p-2 bg-brand-50 border border-brand-100 rounded text-xs text-brand-900 flex items-start animate-fade-in">
                <span className="mr-2 mt-0.5">✨</span>
                <div>
                    Detection: Related to <strong>{suggestion.join(', ')}</strong>. 
                    <br/><span className="text-brand-600">Bidirectional link will be created on save.</span>
                </div>
            </div>
        )}
        <textarea 
            className="w-full h-24 p-3 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none outline-none transition-all"
            placeholder="Write a note... (e.g., 'Reminds me of ResNet')"
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
        />
        <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-slate-400">
                {isAnalysing ? 'AI is thinking...' : ''}
            </span>
            <button 
                onClick={handleSave}
                disabled={!currentInput.trim()}
                className="px-4 py-2 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
                Add Note
            </button>
        </div>
      </div>
    </div>
  );
};

export default NotesPanel;
