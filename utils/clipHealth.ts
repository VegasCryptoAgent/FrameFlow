/**
 * FrameFlow clip health — original consecutive-frame motion check.
 *
 * Motion-health idea inspired by AIVideoAdherenceGate (MIT); original FrameFlow
 * implementation. This is not their Python CLI, class layout, or source.
 *
 * Downscales sampled frames to a small grayscale canvas, measures mean-absolute
 * luma diff between neighbors, then classifies STATIC / JITTER / MORPH / OK.
 * schema_version: frameflow-clip-health-1.0
 */
import {
  CLIP_HEALTH_ATTRIBUTION,
  CLIP_HEALTH_SCHEMA_VERSION,
  type ClipHealthIssue,
  type ClipHealthReport,
  type ClipHealthSample,
  type ClipHealthVerdict,
} from '../types';

export const CLIP_HEALTH_SCHEMA = CLIP_HEALTH_SCHEMA_VERSION;

export type ClipHealthParseResult =
  | { ok: true; report: ClipHealthReport }
  | { ok: false; error: string };

export type ClipHealthRequestBody = {
  samples?: Array<{ timestamp?: unknown; motion?: unknown; diff?: unknown }>;
  diffs?: unknown;
};

export type ClipHealthApiResponse = {
  ok: boolean;
  verdict: ClipHealthVerdict;
  mean: number;
  variance: number;
  issues: ClipHealthIssue[];
  summary: string;
};

const ANALYSIS_WIDTH = 96;
const STATIC_MEAN = 0.014;
const STATIC_MAX = 0.03;
const MORPH_ABS = 0.075;
const JITTER_CV = 0.7;
const JITTER_STD = 0.022;

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const meanOf = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const varianceOf = (values: number[], mean = meanOf(values)): number => {
  if (values.length === 0) return 0;
  return meanOf(values.map((value) => (value - mean) ** 2));
};

const medianOf = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const stdOf = (values: number[], mean = meanOf(values)): number => Math.sqrt(varianceOf(values, mean));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Accept 0–1 normalized diffs or raw 8-bit luma MAD (0–255).
 * A series whose peak is clearly above 1.5 is treated as 8-bit.
 */
export const normalizeMotionValues = (values: number[]): number[] => {
  if (values.length === 0) return [];
  const peak = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak > 1.5) return values.map((value) => clamp01(Math.abs(value) / 255));
  return values.map((value) => clamp01(Math.abs(value)));
};

const countDirectionChanges = (values: number[]): number => {
  if (values.length < 3) return 0;
  let swings = 0;
  let prev = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (Math.abs(delta) < 0.004) continue;
    const sign = delta > 0 ? 1 : -1;
    if (prev !== 0 && sign !== prev) swings += 1;
    prev = sign;
  }
  return swings;
};

const classifyMotions = (
  motions: number[]
): { verdict: ClipHealthVerdict; reason: string; spikeAt?: number } => {
  if (motions.length === 0) {
    return {
      verdict: 'STATIC',
      reason: 'Need at least two sampled frames to measure consecutive-frame motion.',
    };
  }

  const avg = meanOf(motions);
  const peak = motions.reduce((max, value) => Math.max(max, value), 0);
  const peakIndex = motions.indexOf(peak);
  const std = stdOf(motions, avg);
  const cv = avg > 1e-6 ? std / avg : 0;
  const swings = countDirectionChanges(motions);

  if (avg <= STATIC_MEAN && peak <= STATIC_MAX) {
    return {
      verdict: 'STATIC',
      reason: 'Near-zero luma change across the run — footage looks frozen or static.',
    };
  }

  const others = motions.filter((_, index) => index !== peakIndex);
  const baseMed = others.length ? medianOf(others) : 0;
  const baseMean = others.length ? meanOf(others) : 0;
  const restStd = others.length ? stdOf(others, baseMean) : 0;
  const prefix = motions.slice(0, Math.max(0, peakIndex));
  const prefixMean = prefix.length ? meanOf(prefix) : 0;
  const prefixStd = prefix.length ? stdOf(prefix, prefixMean) : 0;
  const isolatedSpike =
    peak >= MORPH_ABS &&
    peak >= Math.max(0.055, baseMed * 3.1, baseMean * 2.6);
  const restAreStable = others.length >= 2 && restStd <= 0.04 && baseMean < peak * 0.45;
  const stablePrefix =
    prefix.length >= 2 && prefixMean < peak * 0.5 && prefixStd <= 0.045;

  if (isolatedSpike && restAreStable && (stablePrefix || prefix.length < 2)) {
    return {
      verdict: 'MORPH',
      reason: 'Sudden motion spike after a stable run — likely a morph or scene-change cut.',
      spikeAt: peakIndex,
    };
  }

  const thrash =
    (cv >= JITTER_CV && std >= JITTER_STD) ||
    (swings >= Math.max(3, Math.floor(motions.length * 0.45)) && std >= 0.028);

  if (thrash && peak > STATIC_MAX) {
    return {
      verdict: 'JITTER',
      reason: 'Motion variance is high — frames thrash instead of tracking smoothly.',
    };
  }

  return {
    verdict: 'OK',
    reason: 'Consecutive-frame motion sits in a healthy mid range with no freeze, thrash, or cut spike.',
  };
};

const issuesForVerdict = (
  verdict: ClipHealthVerdict,
  reason: string,
  spikeTimestamp?: number
): ClipHealthIssue[] => {
  if (verdict === 'OK') return [];
  return [
    {
      code: verdict,
      severity: verdict === 'MORPH' ? 'warn' : 'fail',
      message: reason,
      timestamp: spikeTimestamp,
    },
  ];
};

export const scoreMotionSeries = (
  rawMotions: number[],
  timestamps: number[] = []
): {
  verdict: ClipHealthVerdict;
  mean: number;
  variance: number;
  summary: string;
  issues: ClipHealthIssue[];
  samples: ClipHealthSample[];
} => {
  const motions = normalizeMotionValues(rawMotions);
  const classified = classifyMotions(motions);
  const avg = meanOf(motions);
  const variance = varianceOf(motions, avg);
  const spikeTimestamp =
    classified.spikeAt != null
      ? timestamps[classified.spikeAt] ?? timestamps[classified.spikeAt + 1]
      : undefined;
  const issues = issuesForVerdict(classified.verdict, classified.reason, spikeTimestamp);
  if (motions.length === 0) {
    issues.splice(0, issues.length, {
      code: 'INSUFFICIENT_SAMPLES',
      severity: 'fail',
      message: classified.reason,
    });
  }
  const samples = motions.map((motion, index) => ({
    timestamp: timestamps[index] ?? index + 1,
    motion: round6(motion),
  }));
  return {
    verdict: classified.verdict,
    mean: round6(avg),
    variance: round6(variance),
    summary: classified.reason,
    issues,
    samples,
  };
};

export const scoreClipHealth = (body: ClipHealthRequestBody = {}): ClipHealthApiResponse => {
  const fromSamples: { motion: number; timestamp?: number }[] = [];
  if (Array.isArray(body.samples)) {
    for (const item of body.samples) {
      if (!isRecord(item)) continue;
      const motion = readNumber(item.motion) ?? readNumber(item.diff);
      if (motion == null) continue;
      const timestamp = readNumber(item.timestamp) ?? undefined;
      fromSamples.push({ motion, timestamp });
    }
  }

  const fromDiffs = Array.isArray(body.diffs)
    ? body.diffs.map((value) => readNumber(value)).filter((value): value is number => value != null)
    : [];

  const rawMotions = fromSamples.length > 0 ? fromSamples.map((item) => item.motion) : fromDiffs;
  const timestamps =
    fromSamples.length > 0
      ? fromSamples.map((item, index) => item.timestamp ?? index + 1)
      : fromDiffs.map((_, index) => index + 1);

  const scored = scoreMotionSeries(rawMotions, timestamps);
  return {
    ok: scored.verdict === 'OK',
    verdict: scored.verdict,
    mean: scored.mean,
    variance: scored.variance,
    issues: scored.issues,
    summary: scored.summary,
  };
};

export const buildClipHealthReport = (input: {
  motions: number[];
  timestamps?: number[];
  frameTimes?: number[];
  video?: string;
  created?: string;
}): ClipHealthReport => {
  const scored = scoreMotionSeries(input.motions, input.timestamps || []);
  return {
    schema_version: CLIP_HEALTH_SCHEMA_VERSION,
    attribution: CLIP_HEALTH_ATTRIBUTION,
    video: input.video,
    created: input.created || new Date().toISOString(),
    verdict: scored.verdict,
    mean: scored.mean,
    variance: scored.variance,
    summary: scored.summary,
    timestamps: (input.frameTimes && input.frameTimes.length > 0
      ? input.frameTimes
      : scored.samples.map((sample) => sample.timestamp)
    ).map((time) => round6(time)),
    samples: scored.samples,
    issues: scored.issues,
  };
};

export const reportFromApi = (
  api: ClipHealthApiResponse,
  extras: { samples: ClipHealthSample[]; frameTimes?: number[]; video?: string }
): ClipHealthReport => ({
  schema_version: CLIP_HEALTH_SCHEMA_VERSION,
  attribution: CLIP_HEALTH_ATTRIBUTION,
  video: extras.video,
  created: new Date().toISOString(),
  verdict: api.verdict,
  mean: round6(api.mean),
  variance: round6(api.variance),
  summary: api.summary,
  timestamps: (extras.frameTimes && extras.frameTimes.length > 0
    ? extras.frameTimes
    : extras.samples.map((sample) => sample.timestamp)
  ).map((time) => round6(time)),
  samples: extras.samples.map((sample) => ({
    timestamp: round6(sample.timestamp),
    motion: round6(sample.motion),
  })),
  issues: api.issues || [],
});

export const formatClipHealthTimecode = (seconds: number): string => {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

export const clipHealthSidecarDownloadName = (videoName: string): string => {
  const stem = (videoName || 'footage').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'footage';
  return `${stem}.ffhealth.json`;
};

export const serializeClipHealthReport = (report: ClipHealthReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

export const validateClipHealthReport = (report: ClipHealthReport): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (report.schema_version !== CLIP_HEALTH_SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version (expected ${CLIP_HEALTH_SCHEMA_VERSION}).`);
  }
  if (!['OK', 'STATIC', 'JITTER', 'MORPH'].includes(report.verdict)) {
    errors.push('verdict must be OK, STATIC, JITTER, or MORPH.');
  }
  if (!Array.isArray(report.samples) || !Array.isArray(report.timestamps)) {
    errors.push('samples and timestamps must be arrays.');
  }
  report.samples.forEach((sample, index) => {
    if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.motion)) {
      errors.push(`Sample ${index + 1} is missing numeric timestamp/motion.`);
    }
  });
  return { ok: errors.length === 0, errors };
};

export const parseClipHealthReport = (text: string): ClipHealthParseResult => {
  const raw = (text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { ok: false, error: 'Clip health file is empty.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Not valid JSON. Expected a FrameFlow .ffhealth.json sidecar.' };
  }

  const root = isRecord(parsed) && isRecord(parsed.clipHealth) ? parsed.clipHealth : parsed;
  if (!isRecord(root)) return { ok: false, error: 'Clip health JSON must be an object.' };

  const samples = Array.isArray(root.samples)
    ? root.samples
        .map((item) => {
          if (!isRecord(item)) return null;
          const timestamp = readNumber(item.timestamp);
          const motion = readNumber(item.motion) ?? readNumber(item.diff);
          if (timestamp == null || motion == null) return null;
          return { timestamp, motion: clamp01(Math.abs(motion) > 1.5 ? motion / 255 : motion) };
        })
        .filter((item): item is ClipHealthSample => item != null)
    : [];

  const timestamps = Array.isArray(root.timestamps)
    ? root.timestamps.map((value) => readNumber(value)).filter((value): value is number => value != null)
    : samples.map((sample) => sample.timestamp);

  const scored = scoreMotionSeries(
    samples.map((sample) => sample.motion),
    samples.map((sample) => sample.timestamp)
  );

  const report: ClipHealthReport = {
    schema_version: CLIP_HEALTH_SCHEMA_VERSION,
    attribution:
      typeof root.attribution === 'string' && root.attribution.trim()
        ? root.attribution
        : CLIP_HEALTH_ATTRIBUTION,
    video: typeof root.video === 'string' ? root.video : undefined,
    created: typeof root.created === 'string' ? root.created : new Date().toISOString(),
    verdict: scored.verdict,
    mean: scored.mean,
    variance: scored.variance,
    summary: typeof root.summary === 'string' && root.summary.trim() ? root.summary : scored.summary,
    timestamps,
    samples: scored.samples,
    issues: scored.issues,
  };

  if (typeof root.schema_version === 'string' && root.schema_version !== CLIP_HEALTH_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema_version "${root.schema_version}".` };
  }

  const validation = validateClipHealthReport(report);
  if (!validation.ok) {
    return { ok: false, error: validation.errors[0] || 'Clip health sidecar is invalid.' };
  }
  return { ok: true, report };
};

const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode a sampled frame for clip health.'));
    image.src = url;
  });

const lumaPlane = (image: HTMLImageElement, width = ANALYSIS_WIDTH): Uint8ClampedArray => {
  const safeWidth = Math.max(16, Math.min(128, Math.round(width)));
  const ratio = image.naturalHeight / Math.max(1, image.naturalWidth);
  const height = Math.max(1, Math.round(safeWidth * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is not available for clip health.');
  context.drawImage(image, 0, 0, safeWidth, height);
  const pixels = context.getImageData(0, 0, safeWidth, height).data;
  const luma = new Uint8ClampedArray(safeWidth * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    luma[p] = (pixels[i] * 77 + pixels[i + 1] * 150 + pixels[i + 2] * 29) >> 8;
  }
  return luma;
};

const meanAbsLuma = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) acc += Math.abs(a[i] - b[i]);
  return acc / n / 255;
};

export type ClipHealthFrame = {
  timestamp: number;
  imageUrl: string;
};

/** Measure per-step motion from already-extracted frame image URLs in the browser. */
export const measureFrameMotion = async (frames: ClipHealthFrame[]): Promise<ClipHealthSample[]> => {
  const sorted = [...frames]
    .filter((frame) => frame.imageUrl)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return [];

  const planes: Uint8ClampedArray[] = [];
  for (const frame of sorted) {
    const image = await loadImageElement(frame.imageUrl);
    planes.push(lumaPlane(image));
  }

  const samples: ClipHealthSample[] = [];
  for (let i = 1; i < planes.length; i += 1) {
    samples.push({
      timestamp: sorted[i].timestamp,
      motion: round6(meanAbsLuma(planes[i - 1], planes[i])),
    });
  }
  return samples;
};

export const analyzeClipHealthFromFrames = async (
  frames: ClipHealthFrame[],
  extras?: { video?: string }
): Promise<ClipHealthReport> => {
  const samples = await measureFrameMotion(frames);
  const frameTimes = [...frames]
    .map((frame) => frame.timestamp)
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  return buildClipHealthReport({
    motions: samples.map((sample) => sample.motion),
    timestamps: samples.map((sample) => sample.timestamp),
    frameTimes,
    video: extras?.video,
  });
};

export const postClipHealth = async (body: ClipHealthRequestBody): Promise<ClipHealthApiResponse> => {
  const response = await fetch('/api/clip-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as ClipHealthApiResponse & { error?: string } | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || `Clip health API failed (${response.status}).`);
  }
  return payload;
};
