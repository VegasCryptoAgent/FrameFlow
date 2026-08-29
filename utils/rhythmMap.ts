/**
 * FrameFlow rhythm cue map — original Web Audio implementation.
 *
 * Inspired by BeatScope's cue-map idea (MIT); original FrameFlow implementation.
 * This is not BeatScope source, not their Python analyzer, and not a drum
 * transcription. It builds a compact, reusable timing package (LOW/MID/HIGH
 * energy, beat/transient cues, eight-bar-style motion labels) so editors and
 * agents reuse timing instead of guessing.
 *
 * schema_version: frameflow-rhythm-map-1.0
 */
import {
  RHYTHM_MAP_ATTRIBUTION,
  RHYTHM_MAP_SCHEMA_VERSION,
  type RhythmBand,
  type RhythmCueLabel,
  type RhythmCueWindow,
  type RhythmEnergySample,
  type RhythmMap,
  type RhythmOnset,
} from '../types';

export const RHYTHM_MAP_SCHEMA = RHYTHM_MAP_SCHEMA_VERSION;

export type RhythmParseResult =
  | { ok: true; map: RhythmMap }
  | { ok: false; error: string };

export type RhythmAnalyzeProgress = (phase: string, ratio: number) => void;

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

const ANALYSIS_RATE = 8000;
const HOP_SEC = 0.05;
const WIN_SEC = 0.09;
const MAX_ENERGY_POINTS = 280;
const MAX_ONSETS = 180;
const CUE_LABELS: RhythmCueLabel[] = ['impact', 'scale', 'flow', 'flash', 'bloom'];
const BANDS: RhythmBand[] = ['low', 'mid', 'high'];

const AudioContextCtor = (): typeof AudioContext => {
  const scoped = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || scoped.webkitAudioContext!;
};

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
};

const normalize01 = (values: number[]): number[] => {
  const scale = percentile(values, 0.95);
  if (scale <= 1e-8) return values.map(() => 0);
  return values.map((value) => clamp(value / scale, 0, 1));
};

/** RBJ cookbook lowpass / highpass / bandpass. Standard DSP, not a third-party port. */
const biquadCoeffs = (
  type: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  q: number,
  sampleRate: number
): BiquadCoeffs => {
  const w0 = (2 * Math.PI * clamp(freq, 20, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.1, q));
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
};

const applyBiquad = (input: Float32Array, coeffs: BiquadCoeffs): Float32Array => {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
};

const mixMono = (buffer: AudioBuffer): Float32Array => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i++) out[i] *= inv;
  }
  return out;
};

const decimate = (
  input: Float32Array,
  fromRate: number,
  toRate: number
): { samples: Float32Array; sampleRate: number } => {
  const ratio = fromRate / toRate;
  if (ratio <= 1.15) return { samples: input, sampleRate: fromRate };
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return { samples: out, sampleRate: toRate };
};

const windowRms = (
  samples: Float32Array,
  sampleRate: number,
  hopSec: number,
  winSec: number
): { rms: number[]; times: number[] } => {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const win = Math.max(hop, Math.round(sampleRate * winSec));
  const count = Math.max(1, Math.floor((samples.length - win) / hop) + 1);
  const rms: number[] = new Array(count);
  const times: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = i * hop;
    let acc = 0;
    const limit = Math.min(win, samples.length - start);
    for (let j = 0; j < limit; j++) {
      const value = samples[start + j];
      acc += value * value;
    }
    rms[i] = Math.sqrt(acc / Math.max(1, limit));
    times[i] = (start + limit / 2) / sampleRate;
  }
  return { rms, times };
};

const positiveFlux = (values: number[]): number[] =>
  values.map((value, index) => {
    if (index === 0) return 0;
    return Math.max(0, value - values[index - 1]);
  });

const pickPeaks = (
  flux: number[],
  times: number[],
  minGapSec: number
): { time: number; strength: number }[] => {
  if (flux.length < 3) return [];
  const med = median(flux);
  const deviations = flux.map((value) => Math.abs(value - med));
  const mad = median(deviations) || 1e-6;
  const threshold = Math.max(med + 2.4 * mad, percentile(flux, 0.78));
  const raw: { time: number; strength: number }[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && flux[i] >= threshold) {
      raw.push({ time: times[i], strength: flux[i] });
    }
  }
  raw.sort((a, b) => a.time - b.time);
  const kept: { time: number; strength: number }[] = [];
  for (const peak of raw) {
    const last = kept[kept.length - 1];
    if (!last || peak.time - last.time >= minGapSec) {
      kept.push(peak);
    } else if (peak.strength > last.strength) {
      kept[kept.length - 1] = peak;
    }
  }
  const strengths = kept.map((peak) => peak.strength);
  const norm = normalize01(strengths);
  return kept.map((peak, index) => ({
    time: round3(peak.time),
    strength: round3(norm[index] || 0),
  }));
};

const estimateBpm = (flux: number[], hopSec: number): number | null => {
  const minBpm = 68;
  const maxBpm = 184;
  const minLag = Math.round(60 / maxBpm / hopSec);
  const maxLag = Math.round(60 / minBpm / hopSec);
  if (flux.length < maxLag + 8 || maxLag <= minLag) return null;

  const centered = flux.map((value) => value - mean(flux));
  let bestLag = 0;
  let best = 0;
  let second = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    let n = 0;
    for (let i = 0; i + lag < centered.length; i++) {
      acc += centered[i] * centered[i + lag];
      n += 1;
    }
    const score = n ? acc / n : 0;
    if (score > best) {
      second = best;
      best = score;
      bestLag = lag;
    } else if (score > second) {
      second = score;
    }
  }
  if (bestLag === 0 || best <= 1e-8) return null;
  if (second > 0 && best / second < 1.08) return null;
  const bpm = 60 / (bestLag * hopSec);
  if (bpm < 60 || bpm > 200) return null;
  return round3(bpm);
};

const buildBeatGrid = (
  duration: number,
  bpm: number,
  onsets: RhythmOnset[]
): { time: number }[] => {
  const period = 60 / bpm;
  let bestOffset = 0;
  let bestScore = -1;
  const steps = 20;
  for (let step = 0; step < steps; step++) {
    const offset = (step / steps) * period;
    let score = 0;
    for (const onset of onsets) {
      const phase = (((onset.time - offset) % period) + period) % period;
      const dist = Math.min(phase, period - phase);
      if (dist < period * 0.14) {
        score += onset.strength * (1 - dist / (period * 0.14));
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  const beats: { time: number }[] = [];
  const start = bestOffset < duration * 0.02 ? bestOffset : bestOffset - period;
  for (let time = start; time < duration - 0.02; time += period) {
    if (time >= 0) beats.push({ time: round3(time) });
  }
  return beats;
};

const downsampleEnergy = (
  times: number[],
  low: number[],
  mid: number[],
  high: number[],
  maxPoints: number
): RhythmEnergySample[] => {
  const stride = Math.max(1, Math.ceil(times.length / maxPoints));
  const samples: RhythmEnergySample[] = [];
  for (let i = 0; i < times.length; i += stride) {
    samples.push({
      time: round3(times[i]),
      low: round3(low[i] || 0),
      mid: round3(mid[i] || 0),
      high: round3(high[i] || 0),
    });
  }
  return samples;
};

const eightBarWindowSec = (bpm: number | null, duration: number): number => {
  const fromTempo = bpm && bpm > 0 ? 8 * 4 * (60 / bpm) : 8;
  const bounded = clamp(fromTempo, 6, 18);
  if (duration <= bounded * 1.25) return Math.max(4, duration);
  return bounded;
};

const labelWindow = (stats: {
  lowMean: number;
  midMean: number;
  highMean: number;
  lowOnset: number;
  midOnset: number;
  highOnset: number;
  slope: number;
  peakiness: number;
  variance: number;
}): { label: RhythmCueLabel; intensity: number } => {
  const flash = stats.highOnset * 1.45 + stats.highMean * 0.35 + stats.peakiness * 0.25;
  const impact = stats.lowOnset * 1.55 + stats.lowMean * 0.55 + stats.peakiness * 0.45;
  const bloom = Math.max(0, stats.slope) * 1.85 + (stats.lowMean + stats.midMean + stats.highMean) * 0.18;
  const scale =
    (stats.lowMean + stats.midMean) * 0.85 - stats.variance * 0.55 - (stats.lowOnset + stats.highOnset) * 0.25;
  const flow =
    stats.midMean * 0.75 - stats.peakiness * 0.35 - Math.abs(stats.slope) * 0.25 + 0.12;

  const scored: Array<[RhythmCueLabel, number]> = [
    ['flash', flash],
    ['impact', impact],
    ['bloom', bloom],
    ['scale', scale],
    ['flow', flow],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  const [label, score] = scored[0];
  return { label, intensity: round3(clamp(score, 0, 1.6) / 1.6) };
};

const buildCueWindows = (
  duration: number,
  bpm: number | null,
  energy: RhythmEnergySample[],
  onsets: RhythmOnset[]
): RhythmCueWindow[] => {
  if (duration <= 0) return [];
  const windowSec = eightBarWindowSec(bpm, duration);
  const cues: RhythmCueWindow[] = [];
  for (let start = 0; start < duration - 0.05; start += windowSec) {
    const end = Math.min(duration, start + windowSec);
    const samples = energy.filter((sample) => sample.time >= start && sample.time < end);
    const windowOnsets = onsets.filter((onset) => onset.time >= start && onset.time < end);
    if (samples.length === 0) {
      cues.push({ start: round3(start), end: round3(end), label: 'flow', intensity: 0.15 });
      continue;
    }
    const totals = samples.map((sample) => (sample.low + sample.mid + sample.high) / 3);
    const third = Math.max(1, Math.floor(samples.length / 3));
    const head = mean(totals.slice(0, third));
    const tail = mean(totals.slice(-third));
    const overall = mean(totals) || 1e-6;
    const variance = mean(totals.map((value) => (value - overall) ** 2));
    const peakiness = (percentile(totals, 0.95) + 1e-6) / (overall + 1e-6);
    const bandCount = (band: RhythmBand) =>
      windowOnsets.filter((onset) => onset.band === band).reduce((sum, onset) => sum + onset.strength, 0);
    const span = Math.max(1, windowOnsets.length);
    const labeled = labelWindow({
      lowMean: mean(samples.map((sample) => sample.low)),
      midMean: mean(samples.map((sample) => sample.mid)),
      highMean: mean(samples.map((sample) => sample.high)),
      lowOnset: bandCount('low') / span,
      midOnset: bandCount('mid') / span,
      highOnset: bandCount('high') / span,
      slope: (tail - head) / (overall + 1e-6),
      peakiness: clamp(peakiness / 3, 0, 1),
      variance: clamp(variance * 4, 0, 1),
    });
    cues.push({
      start: round3(start),
      end: round3(end),
      label: labeled.label,
      intensity: labeled.intensity,
    });
  }
  return cues;
};

export const formatRhythmTimecode = (seconds: number): string => {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

export const rhythmSidecarDownloadName = (videoName: string): string => {
  const stem = (videoName || 'footage').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'footage';
  return `${stem}.ffrhythm.json`;
};

export const serializeRhythmMap = (map: RhythmMap): string => `${JSON.stringify(map, null, 2)}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const validateRhythmMap = (map: RhythmMap): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (map.schema_version !== RHYTHM_MAP_SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version (expected ${RHYTHM_MAP_SCHEMA_VERSION}).`);
  }
  if (!Number.isFinite(map.duration) || map.duration < 0) {
    errors.push('duration must be a non-negative number of seconds.');
  }
  if (map.bpm != null && (!Number.isFinite(map.bpm) || map.bpm <= 0 || map.bpm > 300)) {
    errors.push('bpm must be null or a sensible tempo.');
  }
  if (!Array.isArray(map.beats) || !Array.isArray(map.onsets) || !Array.isArray(map.energy) || !Array.isArray(map.cues)) {
    errors.push('beats, onsets, energy, and cues must be arrays.');
  }
  map.cues.forEach((cue, index) => {
    if (!CUE_LABELS.includes(cue.label)) {
      errors.push(`Cue ${index + 1} has an unknown label.`);
    }
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end < cue.start) {
      errors.push(`Cue ${index + 1} has an invalid time range.`);
    }
  });
  return { ok: errors.length === 0, errors };
};

export const parseRhythmMap = (text: string): RhythmParseResult => {
  const raw = (text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { ok: false, error: 'Rhythm map file is empty.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Not valid JSON. Expected a FrameFlow .ffrhythm.json sidecar.' };
  }

  const root = isRecord(parsed) && isRecord(parsed.rhythmMap) ? parsed.rhythmMap : parsed;
  if (!isRecord(root)) return { ok: false, error: 'Rhythm map JSON must be an object.' };

  const duration = readNumber(root.duration);
  if (duration == null) return { ok: false, error: 'Rhythm map is missing a numeric duration.' };

  const bpmRaw = root.bpm;
  const bpm = bpmRaw == null ? null : readNumber(bpmRaw);

  const beats = Array.isArray(root.beats)
    ? root.beats
        .map((item) => {
          const rec = isRecord(item) ? item : null;
          const time = rec ? readNumber(rec.time) : null;
          return time == null ? null : { time };
        })
        .filter((item): item is { time: number } => item != null)
    : [];

  const onsets = Array.isArray(root.onsets)
    ? root.onsets
        .map((item) => {
          if (!isRecord(item)) return null;
          const time = readNumber(item.time);
          const strength = readNumber(item.strength);
          const band = item.band;
          if (time == null || strength == null || typeof band !== 'string' || !BANDS.includes(band as RhythmBand)) {
            return null;
          }
          return { time, strength: clamp(strength, 0, 1), band: band as RhythmBand };
        })
        .filter((item): item is RhythmOnset => item != null)
    : [];

  const energy = Array.isArray(root.energy)
    ? root.energy
        .map((item) => {
          if (!isRecord(item)) return null;
          const time = readNumber(item.time);
          const low = readNumber(item.low);
          const mid = readNumber(item.mid);
          const high = readNumber(item.high);
          if (time == null || low == null || mid == null || high == null) return null;
          return { time, low: clamp(low, 0, 1), mid: clamp(mid, 0, 1), high: clamp(high, 0, 1) };
        })
        .filter((item): item is RhythmEnergySample => item != null)
    : [];

  const cues = Array.isArray(root.cues)
    ? root.cues
        .map((item) => {
          if (!isRecord(item)) return null;
          const start = readNumber(item.start);
          const end = readNumber(item.end);
          const intensity = readNumber(item.intensity) ?? 0.4;
          const label = item.label;
          if (start == null || end == null || typeof label !== 'string' || !CUE_LABELS.includes(label as RhythmCueLabel)) {
            return null;
          }
          return { start, end, label: label as RhythmCueLabel, intensity: clamp(intensity, 0, 1) };
        })
        .filter((item): item is RhythmCueWindow => item != null)
    : [];

  const map: RhythmMap = {
    schema_version: RHYTHM_MAP_SCHEMA_VERSION,
    attribution: typeof root.attribution === 'string' && root.attribution.trim()
      ? root.attribution
      : RHYTHM_MAP_ATTRIBUTION,
    duration,
    bpm,
    beats,
    onsets,
    energy,
    cues,
    video: typeof root.video === 'string' ? root.video : undefined,
    created: typeof root.created === 'string' ? root.created : undefined,
  };

  if (typeof root.schema_version === 'string' && root.schema_version !== RHYTHM_MAP_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema_version "${root.schema_version}".` };
  }

  const validation = validateRhythmMap(map);
  if (!validation.ok) {
    return { ok: false, error: validation.errors[0] || 'Rhythm map sidecar is invalid.' };
  }
  return { ok: true, map };
};

const fetchAudioBytes = async (source: File | Blob | string): Promise<ArrayBuffer> => {
  if (typeof source !== 'string') return source.arrayBuffer();
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not fetch audio bytes (${response.status}). Try a local upload.`);
  }
  return response.arrayBuffer();
};

const decodeAudioBuffer = async (bytes: ArrayBuffer): Promise<AudioBuffer> => {
  const Ctor = AudioContextCtor();
  if (!Ctor) throw new Error('Web Audio is not available in this browser.');
  const ctx = new Ctor();
  try {
    const copy = bytes.slice(0);
    return await ctx.decodeAudioData(copy);
  } catch {
    throw new Error(
      'Could not decode an audio track from this video. Upload a local MP4/WebM that already plays in FrameFlow and includes audio.'
    );
  } finally {
    await ctx.close().catch(() => undefined);
  }
};

/** Build a compact map from already-decoded mono samples. Exported for local checks. */
export const buildRhythmMapFromMono = (
  samples: Float32Array,
  sampleRate: number,
  extras?: { video?: string; created?: string }
): RhythmMap => {
  const duration = samples.length / sampleRate;
  if (!Number.isFinite(duration) || duration < 0.2) {
    throw new Error('Audio track is too short to build a rhythm map.');
  }

  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak < 1e-4) {
    throw new Error('No audible audio track found. The video may be silent.');
  }

  const reduced = decimate(samples, sampleRate, ANALYSIS_RATE);
  const rate = reduced.sampleRate;
  const low = applyBiquad(reduced.samples, biquadCoeffs('lowpass', 180, 0.72, rate));
  const mid = applyBiquad(reduced.samples, biquadCoeffs('bandpass', 900, 0.65, rate));
  const high = applyBiquad(reduced.samples, biquadCoeffs('highpass', 2400, 0.72, rate));

  const lowRms = windowRms(low, rate, HOP_SEC, WIN_SEC);
  const midRms = windowRms(mid, rate, HOP_SEC, WIN_SEC);
  const highRms = windowRms(high, rate, HOP_SEC, WIN_SEC);
  const times = lowRms.times;
  const lowN = normalize01(lowRms.rms);
  const midN = normalize01(midRms.rms);
  const highN = normalize01(highRms.rms);

  const lowFlux = positiveFlux(lowN);
  const midFlux = positiveFlux(midN);
  const highFlux = positiveFlux(highN);
  const combinedFlux = times.map((_, index) => lowFlux[index] * 1.15 + midFlux[index] + highFlux[index] * 0.9);

  const lowPeaks = pickPeaks(lowFlux, times, 0.09);
  const midPeaks = pickPeaks(midFlux, times, 0.08);
  const highPeaks = pickPeaks(highFlux, times, 0.06);

  const tagged: RhythmOnset[] = [
    ...lowPeaks.map((peak) => ({ ...peak, band: 'low' as const })),
    ...midPeaks.map((peak) => ({ ...peak, band: 'mid' as const })),
    ...highPeaks.map((peak) => ({ ...peak, band: 'high' as const })),
  ].sort((a, b) => a.time - b.time || b.strength - a.strength);

  const merged: RhythmOnset[] = [];
  for (const onset of tagged) {
    const last = merged[merged.length - 1];
    if (!last || onset.time - last.time >= 0.045) {
      merged.push(onset);
    } else if (onset.strength > last.strength) {
      merged[merged.length - 1] = onset;
    }
  }
  merged.sort((a, b) => b.strength - a.strength);
  const onsets = merged.slice(0, MAX_ONSETS).sort((a, b) => a.time - b.time);

  const bpm = estimateBpm(combinedFlux, HOP_SEC);
  const beats = bpm
    ? buildBeatGrid(duration, bpm, onsets)
    : onsets.filter((onset) => onset.strength >= 0.55).map((onset) => ({ time: onset.time }));

  const energy = downsampleEnergy(times, lowN, midN, highN, MAX_ENERGY_POINTS);
  const cues = buildCueWindows(duration, bpm, energy, onsets);

  return {
    schema_version: RHYTHM_MAP_SCHEMA_VERSION,
    attribution: RHYTHM_MAP_ATTRIBUTION,
    duration: round3(duration),
    bpm,
    beats,
    onsets,
    energy,
    cues,
    video: extras?.video,
    created: extras?.created || new Date().toISOString(),
  };
};

export const analyzeVideoRhythm = async (
  source: File | Blob | string,
  extras?: { video?: string; onProgress?: RhythmAnalyzeProgress }
): Promise<RhythmMap> => {
  extras?.onProgress?.('decode', 0.08);
  const bytes = await fetchAudioBytes(source);
  extras?.onProgress?.('decode', 0.28);
  const buffer = await decodeAudioBuffer(bytes);
  extras?.onProgress?.('bands', 0.46);
  if (buffer.duration < 0.2) {
    throw new Error('Audio track is too short to build a rhythm map.');
  }
  const mono = mixMono(buffer);
  extras?.onProgress?.('onsets', 0.72);
  const map = buildRhythmMapFromMono(mono, buffer.sampleRate, {
    video: extras?.video,
    created: new Date().toISOString(),
  });
  extras?.onProgress?.('cues', 1);
  return map;
};

const cueContains = (map: RhythmMap, time: number, labels: RhythmCueLabel[]): boolean =>
  map.cues.some((cue) => labels.includes(cue.label) && time >= cue.start && time < cue.end);

const collectAccentTimes = (map: RhythmMap): number[] => {
  const scored: Array<{ time: number; weight: number }> = [];
  for (const onset of map.onsets) {
    let weight = onset.strength;
    if (onset.band === 'low') weight *= 1.2;
    if (cueContains(map, onset.time, ['impact', 'flash'])) weight *= 1.35;
    scored.push({ time: onset.time, weight });
  }
  for (const beat of map.beats) {
    scored.push({
      time: beat.time,
      weight: cueContains(map, beat.time, ['impact', 'flash']) ? 0.85 : 0.5,
    });
  }
  return scored.filter((item) => item.weight >= 0.28).map((item) => item.time);
};

const nearestTime = (times: number[], target: number): number | null => {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const time of times) {
    const dist = Math.abs(time - target);
    if (dist < bestDist) {
      best = time;
      bestDist = dist;
    }
  }
  return best;
};

/**
 * Regular interval grid, or the same count snapped toward high-impact onsets/beats.
 * Existing sampling interval remains the fallback when the map is missing or the toggle is off.
 */
export const computeSampleTimestamps = (
  duration: number,
  intervalSeconds: number,
  map: RhythmMap | null,
  preferBeatAccents: boolean
): number[] => {
  const interval = Math.max(0.25, intervalSeconds || 3);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const regular: number[] = [];
  if (safeDuration <= 0) return [0];
  for (let time = 0; time < safeDuration - 0.04; time += interval) {
    regular.push(round3(time));
  }
  if (regular.length === 0) regular.push(0);
  if (!preferBeatAccents || !map) return regular;

  const accents = collectAccentTimes(map);
  if (accents.length === 0) return regular;

  const snapped = regular.map((time) => {
    const nearest = nearestTime(accents, time);
    if (nearest != null && Math.abs(nearest - time) <= interval * 0.5) {
      return round3(clamp(nearest, 0, Math.max(0, safeDuration - 0.05)));
    }
    return time;
  });

  const unique: number[] = [];
  const minGap = Math.min(0.35, interval * 0.4);
  for (const time of snapped.sort((a, b) => a - b)) {
    const last = unique[unique.length - 1];
    if (last == null || time - last >= minGap) unique.push(time);
  }
  return unique;
};
