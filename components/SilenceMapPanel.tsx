import React, { useMemo, useRef } from 'react';
import { Activity, Download, Loader2, Scissors, Upload } from 'lucide-react';
import { SILENCE_MAP_ATTRIBUTION, type SilenceMap, type SuggestedCutKind } from '../types';
import { formatSilenceTimecode } from '../utils/silenceMap';

type SilenceMapPanelProps = {
  map: SilenceMap | null;
  busy: boolean;
  error: string | null;
  draft: string;
  canAnalyze: boolean;
  preferTalkWindows: boolean;
  noiseFloor: number;
  minSilenceSec: number;
  minTalkSec: number;
  onDraftChange: (value: string) => void;
  onPreferTalkWindows: (value: boolean) => void;
  onNoiseFloorChange: (value: number) => void;
  onMinSilenceSecChange: (value: number) => void;
  onMinTalkSecChange: (value: number) => void;
  onAnalyze: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onApplyImport: () => void;
  onClose: () => void;
};

const CUT_TONE: Record<SuggestedCutKind, string> = {
  drop_leading_silence: 'bg-amber-300 text-black',
  drop_trailing_silence: 'bg-amber-300 text-black',
  drop_internal_gap: 'bg-white/20 text-white',
};

const CUT_LABEL: Record<SuggestedCutKind, string> = {
  drop_leading_silence: 'Lead',
  drop_trailing_silence: 'Tail',
  drop_internal_gap: 'Gap',
};

const SilenceMapPanel: React.FC<SilenceMapPanelProps> = ({
  map,
  busy,
  error,
  draft,
  canAnalyze,
  preferTalkWindows,
  noiseFloor,
  minSilenceSec,
  minTalkSec,
  onDraftChange,
  onPreferTalkWindows,
  onNoiseFloorChange,
  onMinSilenceSecChange,
  onMinTalkSecChange,
  onAnalyze,
  onExport,
  onImportFile,
  onApplyImport,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lane = useMemo(() => {
    if (!map || map.duration <= 0) return [];
    const pieces: Array<{ kind: 'silence' | 'talk'; start: number; end: number }> = [
      ...map.silences.map((gap) => ({ kind: 'silence' as const, start: gap.start, end: gap.end })),
      ...map.talkWindows.map((win) => ({ kind: 'talk' as const, start: win.start, end: win.end })),
    ].sort((a, b) => a.start - b.start);
    return pieces;
  }, [map]);

  return (
    <div className="border border-white/10 bg-black/60 p-5 space-y-4 rounded-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-neon">Silence_Cut_Map</div>
          <p className="text-xs text-white/55 font-mono leading-relaxed">
            Local Web Audio RMS hops scored into silence gaps, talk windows, and suggested trims
            (drop leading / trailing silence). Export a <span className="text-white/80">.ffsilence.json</span> sidecar.
            No ffmpeg. No burn-in.
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
        {SILENCE_MAP_ATTRIBUTION}
      </p>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={preferTalkWindows}
          onChange={(event) => onPreferTalkWindows(event.target.checked)}
          className="accent-neon w-4 h-4"
        />
        <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
          Prefer talk windows when sampling
        </span>
      </label>

      <div className="grid sm:grid-cols-3 gap-4">
        <label className="space-y-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
            RMS threshold {noiseFloor <= 0 ? '· auto' : `· ${noiseFloor.toFixed(3)}`}
          </span>
          <input
            type="range"
            min="0"
            max="0.28"
            step="0.005"
            value={noiseFloor}
            onChange={(event) => onNoiseFloorChange(parseFloat(event.target.value))}
            className="w-full accent-neon"
          />
        </label>
        <label className="space-y-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
            Min gap {minSilenceSec.toFixed(2)}s
          </span>
          <input
            type="range"
            min="0.15"
            max="3"
            step="0.05"
            value={minSilenceSec}
            onChange={(event) => onMinSilenceSecChange(parseFloat(event.target.value))}
            className="w-full accent-neon"
          />
        </label>
        <label className="space-y-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
            Min talk {minTalkSec.toFixed(2)}s
          </span>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.05"
            value={minTalkSec}
            onChange={(event) => onMinTalkSecChange(parseFloat(event.target.value))}
            className="w-full accent-neon"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          id="analyze-silence-map"
          onClick={onAnalyze}
          disabled={busy || !canAnalyze}
          className="flex items-center gap-2 px-5 py-2 bg-neon text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
          Analyze Silence
        </button>
        <button
          onClick={onExport}
          disabled={!map}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 text-[10px] font-black uppercase tracking-widest text-white/70 hover:border-neon hover:text-neon disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          Export sidecar
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 text-[10px] font-black uppercase tracking-widest text-white/70 hover:border-neon hover:text-neon"
        >
          <Upload className="w-3.5 h-3.5" />
          Import sidecar
        </button>
        {map && (
          <span className="self-center text-[10px] font-mono uppercase tracking-widest text-neon/70">
            {map.silences.length} gaps · {map.talkWindows.length} talk
            {map.suggestedCuts.length ? ` · ${map.suggestedCuts.length} cuts` : ''}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept=".ffsilence.json,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = '';
        }}
      />

      {error && (
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-300">{error}</p>
      )}

      {map && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Talk_Gap_Lane</div>
          <div className="h-8 border border-white/10 bg-black flex overflow-hidden">
            {lane.length > 0 ? (
              lane.map((piece, index) => (
                <div
                  key={`${piece.kind}-${piece.start}-${index}`}
                  className={piece.kind === 'talk' ? 'bg-neon/80' : 'bg-white/10'}
                  style={{ width: `${Math.max(1.2, ((piece.end - piece.start) / map.duration) * 100)}%` }}
                  title={`${piece.kind} ${formatSilenceTimecode(piece.start)}–${formatSilenceTimecode(piece.end)}`}
                />
              ))
            ) : (
              <div className="w-full self-center text-center text-[9px] font-mono uppercase tracking-widest text-white/25">
                No regions yet
              </div>
            )}
          </div>
          <p className="text-[10px] font-mono text-white/55 leading-relaxed">{map.summary}</p>
          <div className="flex flex-wrap gap-3 text-[8px] font-mono uppercase tracking-widest text-white/35">
            <span>Talk neon</span>
            <span>Silence dim</span>
            <span>Floor {map.noiseFloor.toFixed(3)}</span>
            <span>{formatSilenceTimecode(0)} → {formatSilenceTimecode(map.duration)}</span>
          </div>
        </div>
      )}

      {map && map.talkWindows.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
            Talk_Windows · {map.talkWindows.length}
          </div>
          <ul className="max-h-36 overflow-y-auto space-y-1.5 scrollbar-hide">
            {map.talkWindows.map((win, index) => (
              <li
                key={`talk-${win.start}-${index}`}
                className="flex items-center gap-3 border border-white/5 px-3 py-2 bg-white/[0.02]"
              >
                <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-neon text-black">
                  Talk
                </span>
                <span className="text-[10px] font-mono text-white/50">
                  {formatSilenceTimecode(win.start)}–{formatSilenceTimecode(win.end)}
                </span>
                <span className="ml-auto text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  {win.duration.toFixed(2)}s
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {map && map.silences.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
            Silence_Gaps · {map.silences.length}
          </div>
          <ul className="max-h-36 overflow-y-auto space-y-1.5 scrollbar-hide">
            {map.silences.map((gap, index) => (
              <li
                key={`gap-${gap.start}-${index}`}
                className="flex items-center gap-3 border border-white/5 px-3 py-2 bg-white/[0.02]"
              >
                <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-white/15 text-white">
                  Gap
                </span>
                <span className="text-[10px] font-mono text-white/50">
                  {formatSilenceTimecode(gap.start)}–{formatSilenceTimecode(gap.end)}
                </span>
                <span className="ml-auto text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  {gap.duration.toFixed(2)}s
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {map && map.suggestedCuts.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
            Suggested_Cuts · {map.suggestedCuts.length}
          </div>
          <ul className="space-y-1.5">
            {map.suggestedCuts.map((cut, index) => (
              <li
                key={`${cut.kind}-${cut.start}-${index}`}
                className="flex items-start gap-3 border border-white/5 px-3 py-2 bg-white/[0.02]"
              >
                <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${CUT_TONE[cut.kind]}`}>
                  {CUT_LABEL[cut.kind]}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[10px] font-mono text-white/50">
                    {formatSilenceTimecode(cut.start)}–{formatSilenceTimecode(cut.end)}
                  </p>
                  <p className="text-[10px] font-mono text-white/40 leading-relaxed">{cut.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Or paste a .ffsilence.json sidecar here..."
        className="w-full h-28 bg-transparent border border-white/10 p-3 text-[11px] font-mono text-white/70 focus:border-neon outline-none resize-y"
      />

      <button
        onClick={onApplyImport}
        disabled={busy || !draft.trim()}
        className="flex items-center gap-2 px-5 py-2 border border-neon/40 text-neon text-[10px] font-black uppercase tracking-widest hover:bg-neon hover:text-black disabled:opacity-40"
      >
        <Activity className="w-3.5 h-3.5" />
        Apply imported map
      </button>
    </div>
  );
};

export default SilenceMapPanel;
