import React, { useMemo, useRef } from 'react';
import { Activity, Download, HeartPulse, Loader2, Upload } from 'lucide-react';
import { CLIP_HEALTH_ATTRIBUTION, type ClipHealthReport, type ClipHealthVerdict } from '../types';
import { formatClipHealthTimecode } from '../utils/clipHealth';

type ClipHealthPanelProps = {
  report: ClipHealthReport | null;
  busy: boolean;
  error: string | null;
  draft: string;
  canAnalyze: boolean;
  onDraftChange: (value: string) => void;
  onAnalyze: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onApplyImport: () => void;
  onClose: () => void;
};

const VERDICT_TONE: Record<ClipHealthVerdict, string> = {
  OK: 'bg-neon text-black',
  STATIC: 'bg-red-500 text-white',
  JITTER: 'bg-amber-300 text-black',
  MORPH: 'bg-white text-black',
};

const barTone = (verdict: ClipHealthVerdict): string => {
  if (verdict === 'STATIC') return 'bg-red-400';
  if (verdict === 'JITTER') return 'bg-amber-300';
  if (verdict === 'MORPH') return 'bg-white';
  return 'bg-neon';
};

const ClipHealthPanel: React.FC<ClipHealthPanelProps> = ({
  report,
  busy,
  error,
  draft,
  canAnalyze,
  onDraftChange,
  onAnalyze,
  onExport,
  onImportFile,
  onApplyImport,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const motionColumns = useMemo(() => {
    if (!report?.samples.length) return [];
    const target = Math.min(96, report.samples.length);
    const stride = Math.max(1, Math.ceil(report.samples.length / target));
    const peak = report.samples.reduce((max, sample) => Math.max(max, sample.motion), 0) || 1;
    const cols: Array<{ motion: number; timestamp: number }> = [];
    for (let i = 0; i < report.samples.length; i += stride) {
      cols.push({
        motion: report.samples[i].motion / peak,
        timestamp: report.samples[i].timestamp,
      });
    }
    return cols;
  }, [report]);

  return (
    <div className="border border-white/10 bg-black/60 p-5 space-y-4 rounded-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-neon">Clip_Health</div>
          <p className="text-xs text-white/55 font-mono leading-relaxed">
            Local consecutive-frame motion check on sampled stills. Downscales to grayscale,
            measures mean-abs luma diff, then grades STATIC / JITTER / MORPH / OK.
            Export a <span className="text-white/80">.ffhealth.json</span> sidecar.
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
        {CLIP_HEALTH_ATTRIBUTION}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          id="analyze-clip-health"
          onClick={onAnalyze}
          disabled={busy || !canAnalyze}
          className="flex items-center gap-2 px-5 py-2 bg-neon text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HeartPulse className="w-3.5 h-3.5" />}
          Analyze Health
        </button>
        <button
          onClick={onExport}
          disabled={!report}
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
        {report && (
          <span className={`self-center px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${VERDICT_TONE[report.verdict]}`}>
            {report.verdict}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept=".ffhealth.json,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = '';
        }}
      />

      {error && (
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-300">{error}</p>
      )}

      {report && (
        <div className="space-y-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Motion_Over_Time</div>
          <div className="h-14 border border-white/10 bg-black flex items-end gap-px px-1 py-1">
            {motionColumns.length > 0 ? (
              motionColumns.map((col, index) => (
                <div
                  key={`${col.timestamp}-${index}`}
                  className={`flex-1 ${barTone(report.verdict)}`}
                  style={{ height: `${Math.max(6, col.motion * 100)}%` }}
                  title={`${formatClipHealthTimecode(col.timestamp)}`}
                />
              ))
            ) : (
              <div className="w-full self-center text-center text-[9px] font-mono uppercase tracking-widest text-white/25">
                No motion samples yet
              </div>
            )}
          </div>
          <p className="text-[10px] font-mono text-white/55 leading-relaxed">{report.summary}</p>
          <div className="flex flex-wrap gap-3 text-[8px] font-mono uppercase tracking-widest text-white/35">
            <span>Mean {report.mean.toFixed(4)}</span>
            <span>Var {report.variance.toFixed(5)}</span>
            <span>{report.samples.length} steps</span>
          </div>
        </div>
      )}

      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Or paste a .ffhealth.json sidecar here..."
        className="w-full h-28 bg-transparent border border-white/10 p-3 text-[11px] font-mono text-white/70 focus:border-neon outline-none resize-y"
      />

      <button
        onClick={onApplyImport}
        disabled={busy || !draft.trim()}
        className="flex items-center gap-2 px-5 py-2 border border-neon/40 text-neon text-[10px] font-black uppercase tracking-widest hover:bg-neon hover:text-black disabled:opacity-40"
      >
        <Activity className="w-3.5 h-3.5" />
        Apply imported health
      </button>
    </div>
  );
};

export default ClipHealthPanel;
