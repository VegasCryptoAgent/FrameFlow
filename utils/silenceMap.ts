/**
 * FrameFlow silence / talk-gap map — original TypeScript implementation.
 *
 * Inspired by misbakhul29/clipper (MIT idea: silence → talk segments /
 * suggested cuts); original FrameFlow implementation. This is not their Go
 * source, ffmpeg filtergraph, ASS burn pipeline, or OpenRouter prompts.
 *
 * Browser Web Audio produces RMS hops. A JSON endpoint scores those hops
 * into silences, talk windows, and suggested trims. The server never decodes
 * video. No ffmpeg. schema_version: frameflow-silence-map-1.0
 */
import {
  SILENCE_MAP_ATTRIBUTION,
  SILENCE_MAP_SCHEMA_VERSION,
  type SilenceGap,
  type SilenceMap,
  type SilenceSample,
  type SuggestedCut,
  type SuggestedCutKind,
  type TalkWindow,
} from '../types';

export const SILENCE_MAP_SCHEMA = SILENCE_MAP_SCHEMA_VERSION;
export { SILENCE_MAP_ATTRIBUTION };

export type SilenceMapParseResult =
  | { ok: true; map: SilenceMap }
  | { ok: false; error: string };

export type SilenceMapApiResponse = {
  ok: boolean;
  source: typeof SILENCE_MAP_SCHEMA_VERSION;
  silences: SilenceGap[];
  talkWindows: TalkWindow[];
  suggestedCuts: SuggestedCut[];
  summary: string;
};

export type SilenceMapRequestBody = {
  durationSeconds?: unknown;
  samples?: unknown;
  noiseFloor?: unknown;
  minSilenceSec?: unknown;
  minTalkSec?: unknown;
};

export type SilenceMapScore = SilenceMapApiResponse & {
  duration: number;
  noiseFloor: number;
  minSilenceSec: number;
  minTalkSec: number;
  samples: SilenceSample[];
};

export type SilenceAnalyzeProgress = (phase: string, ratio: number) => void;

const ANALYSIS_RATE = 8000;
const HOP_SEC = 0.05;
const WIN_SEC = 0.1;
const MAX_SIDECAR_SAMPLES = 400;
const DEFAULT_MIN_SILENCE = 0.45;
const DEFAULT_MIN_TALK = 0.3;
const CUT_KINDS: SuggestedCutKind[] = [
  'drop_leading_silence',
  'drop_trailing_silence',
  'drop_internal_gap',
];

const AudioContextCtor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  const scoped = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || scoped.webkitAudioContext;
};

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const meanOf = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readPositive = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = readNumber(value);
  if (parsed == null) return fallback;
  return clamp(parsed, min, max);
};

const readSample = (value: unknown): SilenceSample | null => {
  if (!isRecord(value)) return null;
  const t = readNumber(value.t) ?? readNumber(value.time) ?? readNumber(value.timestamp);
  const rms = readNumber(value.rms) ?? readNumber(value.energy) ?? readNumber(value.level);
  if (t == null || rms == null || t < 0 || rms < 0) return null;
  return { t: round3(t), rms: round3(rms) };
};

/**
 * Pick a noise floor from the RMS cloud when the caller does not set one.
 * Quiet cluster vs loud cluster midpoint — not a copied ffmpeg silencedetect graph.
 */
export const estimateNoiseFloor = (rmsValues: number[]): number => {
  if (rmsValues.length === 0) return 0.02;
  const peak = rmsValues.reduce((max, value) => Math.max(max, value), 0);
  if (peak < 1e-5) return 0.01;

  const p20 = percentile(rmsValues, 0.2);
  const p50 = percentile(rmsValues, 0.5);
  const quiet = rmsValues.filter((value) => value <= p50);
  const loud = rmsValues.filter((value) => value > p50);
  const quietMean = meanOf(quiet.length ? quiet : rmsValues);
  const loudMean = meanOf(loud.length ? loud : rmsValues);
  const split = loudMean - quietMean;

  if (split > Math.max(0.02, quietMean * 2.2)) {
    return round3(clamp(quietMean + split * 0.32, 0.004, peak * 0.55));
  }

  const fromLow = Math.max(p20 * 1.7, p50 * 0.4, 0.008);
  return round3(clamp(fromLow, 0.004, Math.max(0.02, peak * 0.45)));
};

type LabeledRegion = {
  silent: boolean;
  start: number;
  end: number;
  rmsSum: number;
  count: number;
};

const mergeAdjacent = (regions: LabeledRegion[]): LabeledRegion[] => {
  const merged: LabeledRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last && last.silent === region.silent) {
      last.end = region.end;
      last.rmsSum += region.rmsSum;
      last.count += region.count;
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
};

const relabelShort = (
  regions: LabeledRegion[],
  silent: boolean,
  minSec: number
): LabeledRegion[] => {
  const next = regions.map((region) => {
    const duration = region.end - region.start;
    if (region.silent === silent && duration < minSec) {
      return { ...region, silent: !silent };
    }
    return region;
  });
  return mergeAdjacent(next);
};

const toGap = (region: LabeledRegion): SilenceGap => {
  const duration = round3(Math.max(0, region.end - region.start));
  return {
    start: round3(region.start),
    end: round3(region.end),
    duration,
    meanRms: round3(region.count ? region.rmsSum / region.count : 0),
  };
};

const buildRegions = (
  samples: SilenceSample[],
  duration: number,
  noiseFloor: number,
  minSilenceSec: number,
  minTalkSec: number
): LabeledRegion[] => {
  if (samples.length === 0 || duration <= 0) return [];

  const raw: LabeledRegion[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const start = i === 0 ? 0 : samples[i].t;
    const end = i + 1 < samples.length ? samples[i + 1].t : duration;
    const silent = samples[i].rms <= noiseFloor;
    const last = raw[raw.length - 1];
    if (last && last.silent === silent) {
      last.end = end;
      last.rmsSum += samples[i].rms;
      last.count += 1;
    } else {
      raw.push({
        silent,
        start,
        end,
        rmsSum: samples[i].rms,
        count: 1,
      });
    }
  }

  if (raw.length === 0) return [];
  raw[0].start = 0;
  raw[raw.length - 1].end = duration;

  // Brief dips stay talk; brief spikes stay silence; then keep lasting gaps.
  let regions = mergeAdjacent(raw);
  regions = relabelShort(regions, true, minSilenceSec);
  regions = relabelShort(regions, false, minTalkSec);
  regions = relabelShort(regions, true, minSilenceSec);
  return regions;
};

const suggestCuts = (
  silences: SilenceGap[],
  duration: number,
  minSilenceSec: number
): SuggestedCut[] => {
  const cuts: SuggestedCut[] = [];
  const edgeSlop = 0.08;
  const internalMin = Math.max(1.15, minSilenceSec * 2.4);

  for (const gap of silences) {
    const isLead = gap.start <= edgeSlop;
    const isTail = gap.end >= duration - edgeSlop;
    if (isLead) {
      cuts.push({
        kind: 'drop_leading_silence',
        start: gap.start,
        end: gap.end,
        reason: `Drop ${gap.duration.toFixed(2)}s of leading silence before the first talk window.`,
      });
      continue;
    }
    if (isTail) {
      cuts.push({
        kind: 'drop_trailing_silence',
        start: gap.start,
        end: gap.end,
        reason: `Drop ${gap.duration.toFixed(2)}s of trailing silence after the last talk window.`,
      });
      continue;
    }
    if (gap.duration >= internalMin) {
      cuts.push({
        kind: 'drop_internal_gap',
        start: gap.start,
        end: gap.end,
        reason: `Long ${gap.duration.toFixed(2)}s internal gap — candidate pause to tighten.`,
      });
    }
  }
  return cuts;
};

const summarize = (
  silences: SilenceGap[],
  talks: TalkWindow[],
  cuts: SuggestedCut[],
  duration: number
): string => {
  const silenceSec = round3(silences.reduce((sum, gap) => sum + gap.duration, 0));
  const talkSec = round3(talks.reduce((sum, win) => sum + win.duration, 0));
  const lead = cuts.find((cut) => cut.kind === 'drop_leading_silence');
  const tail = cuts.find((cut) => cut.kind === 'drop_trailing_silence');
  const internals = cuts.filter((cut) => cut.kind === 'drop_internal_gap').length;
  const trimBits = [
    lead ? `${lead.end - lead.start > 0 ? (lead.end - lead.start).toFixed(1) : '0'}s lead` : '',
    tail ? `${(tail.end - tail.start).toFixed(1)}s tail` : '',
    internals ? `${internals} internal gap${internals === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  if (talks.length === 0 && silences.length > 0) {
    return `No talk windows above the floor — ${silenceSec.toFixed(1)}s of ${duration.toFixed(1)}s reads as silence.`;
  }
  if (silences.length === 0) {
    return `Continuous talk — ${talkSec.toFixed(1)}s with no gap above the minimum silence length.`;
  }
  return [
    `${silences.length} silence gap${silences.length === 1 ? '' : 's'} (${silenceSec.toFixed(1)}s)`,
    `${talks.length} talk window${talks.length === 1 ? '' : 's'} (${talkSec.toFixed(1)}s)`,
    trimBits.length ? `suggested: drop ${trimBits.join(' + ')}` : 'no edge trims',
  ].join(' · ');
};

const downsampleSamples = (samples: SilenceSample[], maxPoints: number): SilenceSample[] => {
  if (samples.length <= maxPoints) return samples;
  const stride = Math.ceil(samples.length / maxPoints);
  const out: SilenceSample[] = [];
  for (let i = 0; i < samples.length; i += stride) out.push(samples[i]);
  const last = samples[samples.length - 1];
  if (out[out.length - 1]?.t !== last.t) out.push(last);
  return out;
};

export const scoreSilenceSamples = (
  samples: SilenceSample[],
  durationSeconds: number,
  options?: { noiseFloor?: number; minSilenceSec?: number; minTalkSec?: number }
): SilenceMapScore => {
  const duration = Math.max(0, durationSeconds);
  const ordered = [...samples]
    .filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.rms) && sample.t >= 0)
    .sort((a, b) => a.t - b.t);
  const minSilenceSec = clamp(options?.minSilenceSec ?? DEFAULT_MIN_SILENCE, 0.05, 8);
  const minTalkSec = clamp(options?.minTalkSec ?? DEFAULT_MIN_TALK, 0.05, 8);
  const suppliedFloor = options?.noiseFloor;
  const noiseFloor =
    suppliedFloor != null && Number.isFinite(suppliedFloor) && suppliedFloor > 0
      ? clamp(suppliedFloor, 0.0005, 1)
      : estimateNoiseFloor(ordered.map((sample) => sample.rms));

  const regions = buildRegions(ordered, duration, noiseFloor, minSilenceSec, minTalkSec);
  const silences = regions.filter((region) => region.silent).map(toGap);
  const talkWindows = regions.filter((region) => !region.silent).map(toGap);
  const suggestedCuts = suggestCuts(silences, duration, minSilenceSec);
  const summary = summarize(silences, talkWindows, suggestedCuts, duration);

  return {
    ok: true,
    source: SILENCE_MAP_SCHEMA_VERSION,
    silences,
    talkWindows,
    suggestedCuts,
    summary,
    duration: round3(duration),
    noiseFloor: round3(noiseFloor),
    minSilenceSec: round3(minSilenceSec),
    minTalkSec: round3(minTalkSec),
    samples: downsampleSamples(ordered, MAX_SIDECAR_SAMPLES),
  };
};

export const parseSilenceMapRequest = (
  body: SilenceMapRequestBody = {}
): { ok: true; score: SilenceMapScore } | { ok: false; error: string } => {
  const root = isRecord(body) ? body : {};
  const samples = Array.isArray(root.samples)
    ? root.samples.map(readSample).filter((item): item is SilenceSample => item != null)
    : [];
  if (samples.length === 0) {
    return {
      ok: false,
      error: 'Send { durationSeconds, samples: [{ t, rms }, ...], noiseFloor?, minSilenceSec?, minTalkSec? }.',
    };
  }

  const durationRaw = readNumber(root.durationSeconds);
  const lastT = samples[samples.length - 1]?.t ?? 0;
  const duration =
    durationRaw != null && durationRaw > 0 ? durationRaw : Math.max(lastT, samples[0].t + 0.05);
  const noiseFloor = readNumber(root.noiseFloor);
  const minSilenceSec = readNumber(root.minSilenceSec);
  const minTalkSec = readNumber(root.minTalkSec);

  return {
    ok: true,
    score: scoreSilenceSamples(samples, duration, {
      noiseFloor: noiseFloor != null && noiseFloor > 0 ? noiseFloor : undefined,
      minSilenceSec: minSilenceSec ?? undefined,
      minTalkSec: minTalkSec ?? undefined,
    }),
  };
};

export const apiFromScore = (score: SilenceMapScore): SilenceMapApiResponse => ({
  ok: score.ok,
  source: score.source,
  silences: score.silences,
  talkWindows: score.talkWindows,
  suggestedCuts: score.suggestedCuts,
  summary: score.summary,
});

export const buildSilenceMap = (
  score: SilenceMapScore,
  extras?: { video?: string; created?: string; attribution?: string }
): SilenceMap => ({
  schema_version: SILENCE_MAP_SCHEMA_VERSION,
  attribution: extras?.attribution?.trim() || SILENCE_MAP_ATTRIBUTION,
  duration: score.duration,
  noiseFloor: score.noiseFloor,
  minSilenceSec: score.minSilenceSec,
  minTalkSec: score.minTalkSec,
  samples: score.samples,
  silences: score.silences,
  talkWindows: score.talkWindows,
  suggestedCuts: score.suggestedCuts,
  summary: score.summary,
  video: extras?.video,
  created: extras?.created || new Date().toISOString(),
});

export const mapFromApi = (
  api: SilenceMapApiResponse,
  extras: {
    samples: SilenceSample[];
    duration: number;
    noiseFloor: number;
    minSilenceSec: number;
    minTalkSec: number;
    video?: string;
  }
): SilenceMap => ({
  schema_version: SILENCE_MAP_SCHEMA_VERSION,
  attribution: SILENCE_MAP_ATTRIBUTION,
  duration: round3(extras.duration),
  noiseFloor: round3(extras.noiseFloor),
  minSilenceSec: round3(extras.minSilenceSec),
  minTalkSec: round3(extras.minTalkSec),
  samples: extras.samples,
  silences: api.silences,
  talkWindows: api.talkWindows,
  suggestedCuts: api.suggestedCuts,
  summary: api.summary,
  video: extras.video,
  created: new Date().toISOString(),
});

export const formatSilenceTimecode = (seconds: number): string => {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

export const silenceSidecarDownloadName = (videoName: string): string => {
  const stem = (videoName || 'footage').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'footage';
  return `${stem}.ffsilence.json`;
};

export const serializeSilenceMap = (map: SilenceMap): string => `${JSON.stringify(map, null, 2)}\n`;

export const validateSilenceMap = (map: SilenceMap): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (map.schema_version !== SILENCE_MAP_SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version (expected ${SILENCE_MAP_SCHEMA_VERSION}).`);
  }
  if (!Number.isFinite(map.duration) || map.duration < 0) {
    errors.push('duration must be a non-negative number of seconds.');
  }
  if (!Array.isArray(map.silences) || !Array.isArray(map.talkWindows) || !Array.isArray(map.suggestedCuts)) {
    errors.push('silences, talkWindows, and suggestedCuts must be arrays.');
  }
  map.suggestedCuts.forEach((cut, index) => {
    if (!CUT_KINDS.includes(cut.kind)) {
      errors.push(`Suggested cut ${index + 1} has an unknown kind.`);
    }
    if (!Number.isFinite(cut.start) || !Number.isFinite(cut.end) || cut.end < cut.start) {
      errors.push(`Suggested cut ${index + 1} has an invalid time range.`);
    }
  });
  return { ok: errors.length === 0, errors };
};

export const parseSilenceMap = (text: string): SilenceMapParseResult => {
  const raw = (text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { ok: false, error: 'Silence map file is empty.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Not valid JSON. Expected a FrameFlow .ffsilence.json sidecar.' };
  }

  const root = isRecord(parsed) && isRecord(parsed.silenceMap) ? parsed.silenceMap : parsed;
  if (!isRecord(root)) return { ok: false, error: 'Silence map JSON must be an object.' };

  const samples = Array.isArray(root.samples)
    ? root.samples.map(readSample).filter((item): item is SilenceSample => item != null)
    : [];
  const duration =
    readNumber(root.duration) ??
    readNumber(root.durationSeconds) ??
    (samples.length ? Math.max(samples[samples.length - 1].t, 0) : null);
  if (duration == null) return { ok: false, error: 'Silence map is missing a numeric duration.' };

  const noiseFloor = readPositive(root.noiseFloor, 0, 0, 1);
  const minSilenceSec = readPositive(root.minSilenceSec, DEFAULT_MIN_SILENCE, 0.05, 8);
  const minTalkSec = readPositive(root.minTalkSec, DEFAULT_MIN_TALK, 0.05, 8);

  const scored = scoreSilenceSamples(samples.length ? samples : fallbackSamplesFromRegions(root, duration), duration, {
    noiseFloor: noiseFloor > 0 ? noiseFloor : undefined,
    minSilenceSec,
    minTalkSec,
  });

  const importedCuts = Array.isArray(root.suggestedCuts)
    ? root.suggestedCuts
        .map((item) => {
          if (!isRecord(item)) return null;
          const start = readNumber(item.start);
          const end = readNumber(item.end);
          const kind = item.kind;
          if (start == null || end == null || typeof kind !== 'string' || !CUT_KINDS.includes(kind as SuggestedCutKind)) {
            return null;
          }
          return {
            kind: kind as SuggestedCutKind,
            start,
            end,
            reason: typeof item.reason === 'string' ? item.reason : '',
          };
        })
        .filter((item): item is SuggestedCut => item != null)
    : scored.suggestedCuts;

  const map: SilenceMap = {
    schema_version: SILENCE_MAP_SCHEMA_VERSION,
    attribution:
      typeof root.attribution === 'string' && root.attribution.trim()
        ? root.attribution
        : SILENCE_MAP_ATTRIBUTION,
    duration,
    noiseFloor: scored.noiseFloor,
    minSilenceSec: scored.minSilenceSec,
    minTalkSec: scored.minTalkSec,
    samples: scored.samples,
    silences: scored.silences,
    talkWindows: scored.talkWindows,
    suggestedCuts: importedCuts.length ? importedCuts : scored.suggestedCuts,
    summary: typeof root.summary === 'string' && root.summary.trim() ? root.summary : scored.summary,
    video: typeof root.video === 'string' ? root.video : undefined,
    created: typeof root.created === 'string' ? root.created : new Date().toISOString(),
  };

  if (typeof root.schema_version === 'string' && root.schema_version !== SILENCE_MAP_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema_version "${root.schema_version}".` };
  }

  const validation = validateSilenceMap(map);
  if (!validation.ok) {
    return { ok: false, error: validation.errors[0] || 'Silence map sidecar is invalid.' };
  }
  return { ok: true, map };
};

const fallbackSamplesFromRegions = (root: Record<string, unknown>, duration: number): SilenceSample[] => {
  const samples: SilenceSample[] = [];
  const pushRegion = (start: number, end: number, rms: number) => {
    const hops = Math.max(2, Math.round((end - start) / 0.2));
    for (let i = 0; i < hops; i += 1) {
      const t = start + ((end - start) * i) / Math.max(1, hops - 1);
      samples.push({ t: round3(t), rms });
    }
  };
  if (Array.isArray(root.silences)) {
    for (const item of root.silences) {
      if (!isRecord(item)) continue;
      const start = readNumber(item.start);
      const end = readNumber(item.end);
      const meanRms = readNumber(item.meanRms) ?? 0.004;
      if (start == null || end == null) continue;
      pushRegion(start, end, meanRms);
    }
  }
  if (Array.isArray(root.talkWindows)) {
    for (const item of root.talkWindows) {
      if (!isRecord(item)) continue;
      const start = readNumber(item.start);
      const end = readNumber(item.end);
      const meanRms = readNumber(item.meanRms) ?? 0.12;
      if (start == null || end == null) continue;
      pushRegion(start, end, meanRms);
    }
  }
  if (samples.length === 0) {
    samples.push({ t: 0, rms: 0.01 }, { t: duration, rms: 0.01 });
  }
  return samples.sort((a, b) => a.t - b.t);
};

const mixMono = (buffer: AudioBuffer): Float32Array => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) out[i] += data[i];
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i += 1) out[i] *= inv;
  }
  return out;
};

const decimate = (input: Float32Array, fromRate: number, toRate: number): { samples: Float32Array; sampleRate: number } => {
  const ratio = fromRate / toRate;
  if (ratio <= 1.15) return { samples: input, sampleRate: fromRate };
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return { samples: out, sampleRate: toRate };
};

const windowRms = (samples: Float32Array, sampleRate: number): SilenceSample[] => {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const win = Math.max(hop, Math.round(sampleRate * WIN_SEC));
  const count = Math.max(1, Math.floor((samples.length - win) / hop) + 1);
  const out: SilenceSample[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const start = i * hop;
    let acc = 0;
    const limit = Math.min(win, samples.length - start);
    for (let j = 0; j < limit; j += 1) {
      const value = samples[start + j];
      acc += value * value;
    }
    out[i] = {
      t: round3((start + limit / 2) / sampleRate),
      rms: round3(Math.sqrt(acc / Math.max(1, limit))),
    };
  }
  return out;
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

/** Browser-only: decode the loaded clip and emit RMS hops. Server never calls this. */
export const sampleVideoRms = async (
  source: File | Blob | string,
  extras?: { onProgress?: SilenceAnalyzeProgress }
): Promise<{ samples: SilenceSample[]; duration: number }> => {
  extras?.onProgress?.('decode', 0.1);
  const bytes = await fetchAudioBytes(source);
  extras?.onProgress?.('decode', 0.32);
  const buffer = await decodeAudioBuffer(bytes);
  if (buffer.duration < 0.2) {
    throw new Error('Audio track is too short to build a silence map.');
  }
  extras?.onProgress?.('rms', 0.58);
  const mono = mixMono(buffer);
  const peak = mono.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak < 1e-4) {
    throw new Error('No audible audio track found. The video may be silent.');
  }
  const reduced = decimate(mono, buffer.sampleRate, ANALYSIS_RATE);
  const samples = windowRms(reduced.samples, reduced.sampleRate);
  extras?.onProgress?.('rms', 1);
  return {
    samples: downsampleSamples(samples, MAX_SIDECAR_SAMPLES),
    duration: round3(buffer.duration),
  };
};

export const postSilenceMap = async (body: {
  durationSeconds: number;
  samples: SilenceSample[];
  noiseFloor?: number;
  minSilenceSec?: number;
  minTalkSec?: number;
}): Promise<SilenceMapApiResponse> => {
  const response = await fetch('/api/silence-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (SilenceMapApiResponse & { error?: string }) | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Silence map API failed (${response.status}).`);
  }
  return payload;
};

/**
 * Snap Deconstruct sample times into talk windows when the toggle is on.
 * Parallel to prefer-beat-accents: existing interval remains the fallback.
 */
export const applyTalkWindowPreference = (
  times: number[],
  duration: number,
  map: SilenceMap | null,
  preferTalkWindows: boolean
): number[] => {
  if (!preferTalkWindows || !map || map.talkWindows.length === 0) return times;
  const windows = map.talkWindows;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : map.duration;
  const snapped = times.map((time) => {
    const inside = windows.find((window) => time >= window.start && time <= window.end);
    if (inside) return round3(clamp(time, 0, Math.max(0, safeDuration - 0.05)));

    let best = windows[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const window of windows) {
      const dist = time < window.start ? window.start - time : time > window.end ? time - window.end : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = window;
      }
    }
    const inset = Math.min(0.12, Math.max(0, best.duration * 0.2));
    const lo = best.start + inset;
    const hi = Math.max(lo, best.end - inset);
    return round3(clamp(clamp(time, lo, hi), 0, Math.max(0, safeDuration - 0.05)));
  });

  const unique: number[] = [];
  const minGap = 0.2;
  for (const time of snapped.sort((a, b) => a - b)) {
    const last = unique[unique.length - 1];
    if (last == null || time - last >= minGap) unique.push(time);
  }
  return unique.length > 0 ? unique : times;
};
