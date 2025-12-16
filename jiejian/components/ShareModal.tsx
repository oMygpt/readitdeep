import React, { useState } from 'react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  paperTitle: string;
}

const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, paperTitle }) => {
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState<string[]>(['bob@research.lab', 'alice@univ.edu']);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(`https://readitdeep.app/share/${Date.now()}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = () => {
    if (email) {
      setInvited([...invited, email]);
      setEmail('');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-serif font-bold text-slate-800">Share with Team</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Paper Info */}
          <div className="flex items-center gap-3 p-3 bg-brand-50 rounded-lg border border-brand-100">
            <div className="w-10 h-10 bg-white rounded flex items-center justify-center text-xl shadow-sm">📄</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-brand-600 font-bold uppercase tracking-wide">Selected Paper</div>
              <div className="text-sm font-medium text-slate-800 truncate">{paperTitle}</div>
            </div>
          </div>

          {/* Invite Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Invite Collaborators</label>
            <div className="flex gap-2">
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@lab.com" 
                className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              />
              <button 
                onClick={handleInvite}
                disabled={!email}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                Invite
              </button>
            </div>
          </div>

          {/* Team List */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Team Access</label>
            <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
              <div className="flex items-center justify-between p-2 hover:bg-slate-50 rounded transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs">YO</div>
                  <div className="text-sm text-slate-700 font-medium">You (Owner)</div>
                </div>
                <span className="text-xs text-slate-400">Admin</span>
              </div>
              {invited.map((inv, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">{inv.substring(0,2).toUpperCase()}</div>
                    <div className="text-sm text-slate-700">{inv}</div>
                  </div>
                  <select className="text-xs text-slate-500 bg-transparent border-none outline-none cursor-pointer">
                    <option>Can Edit</option>
                    <option>Can View</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Copy Link */}
          <div className="pt-4 border-t border-slate-100">
             <div className="flex items-center justify-between gap-3 bg-slate-50 p-1 pl-3 rounded-md border border-slate-200">
                <span className="text-xs text-slate-500 truncate flex-1">https://readitdeep.app/share/p/lora-2022-x8z9</span>
                <button 
                  onClick={handleCopy}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${copied ? 'bg-green-500 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'}`}
                >
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
