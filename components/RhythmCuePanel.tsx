import React, { useMemo, useRef } from 'react';
import { Activity, Download, Loader2, Upload, AudioLines } from 'lucide-react';
import { RHYTHM_MAP_ATTRIBUTION, type RhythmCueLabel, type RhythmMap } from '../types';
import { formatRhythmTimecode } from '../utils/rhythmMap';

type RhythmCuePanelProps = {
  map: RhythmMap | null;
  busy: boolean;
  error: string | null;
  draft: string;
  preferBeatAccents: boolean;
  canAnalyze: boolean;
  onDraftChange: (value: string) => void;
  onPreferBeatAccents: (value: boolean) => void;
  onAnalyze: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onApplyImport: () => void;
  onClose: () => void;
};

const CUE_TONE: Record<RhythmCueLabel, string> = {
  impact: 'bg-white text-black',
  scale: 'bg-neon/80 text-black',
  flow: 'bg-neon/25 text-neon',
  flash: 'bg-amber-300 text-black',
  bloom: 'bg-white/20 text-white',
};

const RhythmCuePanel: React.FC<RhythmCuePanelProps> = ({
  map,
  busy,
  error,
  draft,
  preferBeatAccents,
  canAnalyze,
  onDraftChange,
  onPreferBeatAccents,
  onAnalyze,
  onExport,
  onImportFile,
  onApplyImport,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const energyColumns = useMemo(() => {
    if (!map?.energy.length) return [];
    const target = Math.min(96, map.energy.length);
    const stride = Math.max(1, Math.ceil(map.energy.length / target));
    const cols: Array<{ low: number; mid: number; high: number }> = [];
    for (let i = 0; i < map.energy.length; i += stride) {
      cols.push(map.energy[i]);
    }
    return cols;
  }, [map]);

  return (
    <div className="border border-white/10 bg-black/60 p-5 space-y-4 rounded-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-neon">Rhythm_Cue_Map</div>
          <p className="text-xs text-white/55 font-mono leading-relaxed">
            Local Web Audio timing package: LOW / MID / HIGH energy, beat and transient cues,
            eight-bar-style motion labels. Export a <span className="text-white/80">.ffrhythm.json</span> sidecar
            so agents reuse timing instead of guessing.
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
        {RHYTHM_MAP_ATTRIBUTION}
      </p>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={preferBeatAccents}
          onChange={(event) => onPreferBeatAccents(event.target.checked)}
          className="accent-neon w-4 h-4"
        />
        <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
          Prefer beat accents when sampling
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onAnalyze}
          disabled={busy || !canAnalyze}
          className="flex items-center gap-2 px-5 py-2 bg-neon text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5" />}
          Analyze Rhythm
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
          Upload sidecar
        </button>
        {map && (
          <span className="self-center text-[10px] font-mono uppercase tracking-widest text-neon/70">
            {map.cues.length} cue windows
            {map.bpm != null ? ` · ${Math.round(map.bpm)} bpm` : ''}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept=".ffrhythm.json,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = '';
        }}
      />

      {error && (
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-300">{error}</p>
      )}

      {map && energyColumns.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Track_Structure</div>
          <div className="h-16 border border-white/10 bg-black flex items-end gap-px px-1 py-1">
            {energyColumns.map((col, index) => (
              <div key={`${col.low}-${index}`} className="flex-1 h-full flex flex-col justify-end gap-px">
                <div className="w-full bg-amber-300/80" style={{ height: `${Math.max(4, col.high * 34)}%` }} />
                <div className="w-full bg-neon/70" style={{ height: `${Math.max(4, col.mid * 34)}%` }} />
                <div className="w-full bg-white/70" style={{ height: `${Math.max(4, col.low * 34)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-[8px] font-mono uppercase tracking-widest text-white/35">
            <span>Low white</span>
            <span>Mid neon</span>
            <span>High amber</span>
            <span>{formatRhythmTimecode(0)} → {formatRhythmTimecode(map.duration)}</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden border border-white/10">
            {map.cues.map((cue, index) => (
              <div
                key={`${cue.start}-${cue.label}-${index}`}
                className={`h-full ${CUE_TONE[cue.label]} opacity-80`}
                style={{ width: `${Math.max(2, ((cue.end - cue.start) / map.duration) * 100)}%` }}
                title={`${cue.label} ${formatRhythmTimecode(cue.start)}`}
              />
            ))}
          </div>
        </div>
      )}

      {map && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
            Eight_Bar_Cues · {map.onsets.length} onsets · {map.beats.length} beats
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-hide">
            {map.cues.map((cue, index) => (
              <li
                key={`${cue.start}-${cue.label}-${index}`}
                className="flex items-center gap-3 border border-white/5 px-3 py-2 bg-white/[0.02]"
              >
                <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${CUE_TONE[cue.label]}`}>
                  {cue.label}
                </span>
                <span className="text-[10px] font-mono text-white/50">
                  {formatRhythmTimecode(cue.start)}–{formatRhythmTimecode(cue.end)}
                </span>
                <span className="ml-auto text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  {Math.round(cue.intensity * 100)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Or paste a .ffrhythm.json sidecar here..."
        className="w-full h-28 bg-transparent border border-white/10 p-3 text-[11px] font-mono text-white/70 focus:border-neon outline-none resize-y"
      />

      <button
        onClick={onApplyImport}
        disabled={busy || !draft.trim()}
        className="flex items-center gap-2 px-5 py-2 border border-neon/40 text-neon text-[10px] font-black uppercase tracking-widest hover:bg-neon hover:text-black disabled:opacity-40"
      >
        <Activity className="w-3.5 h-3.5" />
        Apply imported cues
      </button>
    </div>
  );
};

export default RhythmCuePanel;
