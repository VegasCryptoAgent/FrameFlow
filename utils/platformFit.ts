/**
 * FrameFlow platform fit — original duration + frame-size ship check.
 *
 * Platform-fit idea inspired by ShortsMCP (MIT); original FrameFlow
 * implementation. This is not their Python CLI, class layout, or source.
 *
 * Grades which social surfaces a clip can ship to (GO / WARN / NO-GO) from
 * already-known width, height, and duration. Optionally adapts a title /
 * caption / hashtag pack. schema_version: frameflow-platform-fit-1.0
 */
import {
  PLATFORM_FIT_ATTRIBUTION,
  PLATFORM_FIT_SCHEMA_VERSION,
  type PlatformFitAspect,
  type PlatformFitId,
  type PlatformFitReport,
  type PlatformFitRow,
  type PlatformFitStatus,
} from '../types';

export const PLATFORM_FIT_SCHEMA = PLATFORM_FIT_SCHEMA_VERSION;
export { PLATFORM_FIT_ATTRIBUTION };

export const STUDIO_HASHTAGS = ['#6FrameStudio', '#AIFilmmaking', '#AICinema'] as const;

export type PlatformFitRequestBody = {
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  title?: unknown;
  description?: unknown;
  hashtags?: unknown;
};

type AspectWant = '9:16' | '16:9';

type PlatformRule = {
  id: PlatformFitId;
  want: AspectWant;
  minSec: number;
  maxSec: number;
  /** Duration above this (but still under maxSec) is WARN, not NO-GO. */
  preferMaxSec?: number;
  /** 9:16 on a landscape-preferred surface is WARN, never NO-GO. */
  portraitIsWarn?: boolean;
  /** Out-of-window duration is WARN instead of NO-GO (LinkedIn / X studio rule). */
  durationSoft?: boolean;
  shortsTitle?: boolean;
};

const PLATFORM_RULES: PlatformRule[] = [
  { id: 'youtube_shorts', want: '9:16', minSec: 3, maxSec: 180, shortsTitle: true },
  { id: 'tiktok', want: '9:16', minSec: 3, maxSec: 600, preferMaxSec: 60 },
  { id: 'instagram_reels', want: '9:16', minSec: 3, maxSec: 90 },
  { id: 'facebook_reels', want: '9:16', minSec: 3, maxSec: 90 },
  { id: 'twitter_x', want: '16:9', minSec: 3, maxSec: 140, portraitIsWarn: true, durationSoft: true },
  { id: 'linkedin', want: '16:9', minSec: 3, maxSec: 600, portraitIsWarn: true, durationSoft: true },
];

const ASPECT_EPSILON = 0.06;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const uniqueTags = (tags: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
};

const tokenizeHashtags = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (token.startsWith('#') ? token : `#${token}`));

export const normalizeHashtags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueTags(value.flatMap((item) => tokenizeHashtags(readString(item))));
  }
  return uniqueTags(tokenizeHashtags(readString(value)));
};

export const classifyAspect = (width: number, height: number): PlatformFitAspect => {
  if (!(width > 0) || !(height > 0)) return 'other';
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= ASPECT_EPSILON) return '1:1';
  if (Math.abs(ratio - 9 / 16) <= ASPECT_EPSILON) return '9:16';
  if (Math.abs(ratio - 16 / 9) <= ASPECT_EPSILON) return '16:9';
  return 'other';
};

const worstStatus = (statuses: PlatformFitStatus[]): PlatformFitStatus => {
  if (statuses.includes('NO-GO')) return 'NO-GO';
  if (statuses.includes('WARN')) return 'WARN';
  return 'GO';
};

const adaptPack = (
  rule: PlatformRule,
  title: string,
  description: string,
  hashtags: string[]
): { title: string; caption: string } => {
  const hasCopy = Boolean(title || description || hashtags.length);
  if (!hasCopy) return { title: '', caption: '' };

  let adaptedTitle = title;
  if (rule.shortsTitle && adaptedTitle && !/#shorts\b/i.test(adaptedTitle)) {
    adaptedTitle = `${adaptedTitle} #Shorts`;
  } else if (rule.shortsTitle && !adaptedTitle) {
    adaptedTitle = '#Shorts';
  }

  const captionBase = description || title;
  const tags = [...hashtags];
  if (rule.shortsTitle && !tags.some((tag) => /^#shorts$/i.test(tag))) {
    tags.unshift('#Shorts');
  }
  for (const tag of STUDIO_HASHTAGS) {
    if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag);
    }
  }

  const caption = [captionBase, uniqueTags(tags).join(' ')].filter(Boolean).join(' ');
  return { title: adaptedTitle, caption };
};

const gradeOne = (
  rule: PlatformRule,
  aspect: PlatformFitAspect,
  durationSeconds: number | null,
  title: string,
  description: string,
  hashtags: string[]
): PlatformFitRow => {
  const issues: string[] = [];
  const aspectStatuses: PlatformFitStatus[] = [];
  const durationStatuses: PlatformFitStatus[] = [];

  if (aspect === rule.want) {
    aspectStatuses.push('GO');
  } else if (rule.portraitIsWarn && aspect === '9:16') {
    aspectStatuses.push('WARN');
    issues.push(`Portrait 9:16 is usable on ${rule.id}, but ${rule.want} is preferred.`);
  } else if (rule.portraitIsWarn) {
    aspectStatuses.push('WARN');
    issues.push(`Need ${rule.want} preferred; clip is ${aspect}.`);
  } else {
    aspectStatuses.push('NO-GO');
    issues.push(`Need ${rule.want}; clip is ${aspect}.`);
  }

  if (durationSeconds == null) {
    durationStatuses.push('WARN');
    issues.push('Duration unknown — cannot confirm the length window.');
  } else if (durationSeconds < rule.minSec) {
    const status: PlatformFitStatus = rule.durationSoft ? 'WARN' : 'NO-GO';
    durationStatuses.push(status);
    issues.push(`Duration ${durationSeconds}s is under the ${rule.minSec}s minimum.`);
  } else if (durationSeconds > rule.maxSec) {
    const status: PlatformFitStatus = rule.durationSoft ? 'WARN' : 'NO-GO';
    durationStatuses.push(status);
    issues.push(`Duration ${durationSeconds}s is over the ${rule.maxSec}s maximum.`);
  } else if (rule.preferMaxSec != null && durationSeconds > rule.preferMaxSec) {
    durationStatuses.push('WARN');
    issues.push(
      `Duration ${durationSeconds}s is over the preferred ${rule.preferMaxSec}s window (hard cap ${rule.maxSec}s).`
    );
  } else {
    durationStatuses.push('GO');
  }

  const pack = adaptPack(rule, title, description, hashtags);
  return {
    id: rule.id,
    status: worstStatus([...aspectStatuses, ...durationStatuses]),
    want: rule.want,
    minSec: rule.minSec,
    maxSec: rule.maxSec,
    title: pack.title,
    caption: pack.caption,
    issues,
  };
};

export const gradePlatformFit = (input: {
  width: number;
  height: number;
  durationSeconds?: number | null;
  title?: string;
  description?: string;
  hashtags?: string[];
}): PlatformFitReport => {
  const aspect = classifyAspect(input.width, input.height);
  const duration =
    input.durationSeconds != null && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : null;
  const title = (input.title || '').trim();
  const description = (input.description || '').trim();
  const hashtags = input.hashtags || [];
  const platforms = PLATFORM_RULES.map((rule) =>
    gradeOne(rule, aspect, duration, title, description, hashtags)
  );

  return {
    ok: true,
    source: PLATFORM_FIT_SCHEMA_VERSION,
    vertical: input.height > input.width,
    aspect,
    durationSeconds: duration,
    platforms,
  };
};

export const parsePlatformFitRequest = (
  body: PlatformFitRequestBody = {}
): { ok: true; report: PlatformFitReport } | { ok: false; error: string } => {
  const root = isRecord(body) ? body : {};
  const width = readNumber(root.width);
  const height = readNumber(root.height);
  if (width == null || width <= 0 || height == null || height <= 0) {
    return { ok: false, error: 'Send { width, height, durationSeconds?, title?, description?, hashtags? }.' };
  }

  const durationRaw = readNumber(root.durationSeconds);
  const durationSeconds = durationRaw != null && durationRaw > 0 ? durationRaw : null;

  return {
    ok: true,
    report: gradePlatformFit({
      width,
      height,
      durationSeconds,
      title: readString(root.title),
      description: readString(root.description),
      hashtags: normalizeHashtags(root.hashtags),
    }),
  };
};

export const postPlatformFit = async (body: {
  width: number;
  height: number;
  durationSeconds?: number | null;
  title?: string;
  description?: string;
  hashtags?: string | string[];
}): Promise<PlatformFitReport> => {
  const response = await fetch('/api/platform-fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (PlatformFitReport & { error?: string }) | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Platform fit API failed (${response.status}).`);
  }
  return payload;
};
