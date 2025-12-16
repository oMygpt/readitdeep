import React, { useRef, useEffect, useState } from 'react';
import { AudioState } from '../types';

interface AudioPlayerProps {
  audioState: AudioState;
  onClose: () => void;
  onPlayPause: (playing: boolean) => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioState, onClose, onPlayPause }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [localProgress, setLocalProgress] = useState(0);

  useEffect(() => {
    if (audioState.audioUrl && audioRef.current) {
        // Reset if url changes
        if (audioRef.current.src !== audioState.audioUrl) {
             audioRef.current.src = audioState.audioUrl;
        }
        
        if (audioState.isPlaying) {
            audioRef.current.play().catch(e => console.error("Play error", e));
        } else {
            audioRef.current.pause();
        }
    }
  }, [audioState.audioUrl, audioState.isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
        const p = (audioRef.current.currentTime / audioRef.current.duration) * 100;
        setLocalProgress(p || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (audioRef.current && audioRef.current.duration) {
          audioRef.current.currentTime = (val / 100) * audioRef.current.duration;
          setLocalProgress(val);
      }
  };

  return (
    <div className="fixed bottom-[60px] md:bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] px-4 py-3 z-50 flex items-center gap-4 animate-slide-up">
       {/* Play/Pause Button */}
       <button 
         onClick={() => onPlayPause(!audioState.isPlaying)}
         className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 transition-colors shrink-0"
         disabled={audioState.isLoading}
       >
          {audioState.isLoading ? (
             <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : audioState.isPlaying ? (
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          ) : (
             <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
       </button>

       {/* Info & Progress */}
       <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center mb-1">
             <div className="text-xs font-bold text-slate-800 truncate">Deep Dive: LoRA</div>
             <div className="text-[10px] text-brand-600 font-medium bg-brand-50 px-1.5 rounded">AI Podcast</div>
          </div>
          <div className="relative w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
             {audioState.isLoading ? (
                <div className="absolute inset-0 bg-brand-200 animate-pulse"></div>
             ) : (
                <>
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={localProgress} 
                        onChange={handleSeek}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div 
                        className="h-full bg-brand-500 rounded-full transition-all duration-100"
                        style={{ width: `${localProgress}%` }}
                    ></div>
                </>
             )}
          </div>
       </div>

       {/* Close */}
       <button onClick={onClose} className="text-slate-400 hover:text-red-500 shrink-0">
           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
       </button>
       
       <audio 
         ref={audioRef} 
         onTimeUpdate={handleTimeUpdate} 
         onEnded={() => onPlayPause(false)}
       />
    </div>
  );
};

export default AudioPlayer;