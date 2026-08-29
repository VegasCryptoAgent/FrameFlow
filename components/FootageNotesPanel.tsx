import React from 'react';
import { Loader2, NotebookText, Upload } from 'lucide-react';
import type { CdafMatchResult } from '../utils/cdafSidecar';

type FootageNotesPanelProps = {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  draft: string;
  busy: boolean;
  match: CdafMatchResult | null;
  loadedSegments: number;
  onDraftChange: (value: string) => void;
  onFile: (file: File) => void;
  onApply: (force: boolean) => void;
  onClose: () => void;
};

const FootageNotesPanel: React.FC<FootageNotesPanelProps> = ({
  fileInputRef,
  draft,
  busy,
  match,
  loadedSegments,
  onDraftChange,
  onFile,
  onApply,
  onClose,
}) => {
  const blocked = Boolean(match && !match.matched);

  return (
    <div className="border border-white/10 bg-black/60 p-5 space-y-4 rounded-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-neon">Footage_Notes</div>
          <p className="text-xs text-white/55 font-mono leading-relaxed">
            Import a FrameFlow <span className="text-white/80">.cdaf.txt</span> sidecar to reuse cached shot notes.
            Matching hash, or name + duration, skips vision on covered timestamps.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white"
        >
          Close
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept=".cdaf,.cdaf.txt,.txt,.md,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 text-[10px] font-black uppercase tracking-widest text-white/70 hover:border-neon hover:text-neon"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload sidecar
        </button>
        {loadedSegments > 0 && (
          <span className="self-center text-[10px] font-mono uppercase tracking-widest text-neon/70">
            {loadedSegments} cached segments
          </span>
        )}
      </div>

      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Or paste CDAF header + markdown body here..."
        className="w-full h-36 bg-transparent border border-white/10 p-3 text-[11px] font-mono text-white/70 focus:border-neon outline-none resize-y"
      />

      {match && (
        <p className={`text-[10px] font-mono uppercase tracking-widest ${match.matched ? 'text-neon/80' : 'text-amber-300'}`}>
          {match.reason}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onApply(false)}
          disabled={busy || !draft.trim() || blocked}
          className="flex items-center gap-2 px-5 py-2 bg-neon text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <NotebookText className="w-3.5 h-3.5" />}
          Apply notes
        </button>
        {blocked && (
          <button
            onClick={() => onApply(true)}
            disabled={busy || !draft.trim()}
            className="px-4 py-2 border border-amber-300/40 text-amber-200 text-[10px] font-black uppercase tracking-widest hover:bg-amber-300/10 disabled:opacity-40"
          >
            Apply anyway
          </button>
        )}
      </div>
    </div>
  );
};

export default FootageNotesPanel;
