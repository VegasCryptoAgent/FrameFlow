import React from 'react';
import { Loader2, Share2 } from 'lucide-react';
import { PLATFORM_FIT_ATTRIBUTION, type PlatformFitReport, type PlatformFitStatus } from '../types';

type PlatformFitPanelProps = {
  report: PlatformFitReport | null;
  busy: boolean;
  error: string | null;
  title: string;
  canGrade: boolean;
  clipSummary: string;
  onTitleChange: (value: string) => void;
  onGrade: () => void;
  onClose: () => void;
};

const STATUS_TONE: Record<PlatformFitStatus, string> = {
  GO: 'bg-neon text-black',
  WARN: 'bg-amber-300 text-black',
  'NO-GO': 'bg-red-500 text-white',
};

const PLATFORM_LABEL: Record<string, string> = {
  youtube_shorts: 'YouTube Shorts',
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
  facebook_reels: 'Facebook Reels',
  twitter_x: 'X / Twitter',
  linkedin: 'LinkedIn',
};

const PlatformFitPanel: React.FC<PlatformFitPanelProps> = ({
  report,
  busy,
  error,
  title,
  canGrade,
  clipSummary,
  onTitleChange,
  onGrade,
  onClose,
}) => {
  return (
    <div className="border border-white/10 bg-black/60 p-5 space-y-4 rounded-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-neon">Platform_Fit</div>
          <p className="text-xs text-white/55 font-mono leading-relaxed">
            Grade which surfaces this clip can ship to from duration + frame size
            (GO / WARN / NO-GO). Optional title previews the #Shorts pack.
            No ffmpeg. No extra API keys.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white"
        >
          Close
        </button>
      </div>

      <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 leading-relaxed">
        {PLATFORM_FIT_ATTRIBUTION}
      </p>

      {clipSummary && (
        <p className="text-[10px] font-mono uppercase tracking-widest text-white/45">{clipSummary}</p>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button
          id="grade-platform-fit"
          onClick={onGrade}
          disabled={busy || !canGrade}
          className="flex items-center gap-2 px-5 py-2 bg-neon text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          Grade Platforms
        </button>
        <input
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Optional title for #Shorts pack"
          className="flex-1 min-w-[12rem] bg-transparent border border-white/10 px-3 py-2 text-[11px] font-mono text-white/70 focus:border-neon outline-none"
        />
      </div>

      {error && (
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-300">{error}</p>
      )}

      {report && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {report.platforms.map((row) => (
              <span
                key={row.id}
                className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${STATUS_TONE[row.status]}`}
              >
                {PLATFORM_LABEL[row.id] || row.id} · {row.status}
              </span>
            ))}
          </div>

          <ul className="space-y-3">
            {report.platforms.map((row) => (
              <li key={`${row.id}-detail`} className="border border-white/10 bg-black/40 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
                    {PLATFORM_LABEL[row.id] || row.id}
                  </span>
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_TONE[row.status]}`}>
                    {row.status}
                  </span>
                </div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/35">
                  Want {row.want} · {row.minSec}–{row.maxSec}s
                </p>
                {row.title && (
                  <p className="text-[11px] font-mono text-white/70 leading-relaxed">{row.title}</p>
                )}
                {row.caption && row.caption !== row.title && (
                  <p className="text-[10px] font-mono text-white/45 leading-relaxed">{row.caption}</p>
                )}
                {row.issues.length > 0 && (
                  <ul className="space-y-1">
                    {row.issues.map((issue) => (
                      <li key={issue} className="text-[10px] font-mono text-amber-200/80 leading-relaxed">
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PlatformFitPanel;
