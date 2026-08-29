/**
 * FrameFlow footage-notes sidecar (CDAF-inspired, original format).
 * Plain-text file kept next to a video so agents reuse shot notes
 * instead of re-running vision on the same footage.
 */
import type { FrameData } from '../types';

export const CDAF_GENERATOR = 'FrameFlow';
export const CDAF_FORMAT_LINE = 'CDAF 1';

export type CdafHeader = {
  video: string;
  sha256?: string;
  duration?: number;
  generator: string;
  created: string;
};

export type CdafSegment = {
  timestamp: number;
  timecode: string;
  notes: string;
  shotType?: string;
  cameraAngle?: string;
  lighting?: string;
  palette?: string[];
};

export type CdafSidecar = {
  header: CdafHeader;
  summary: string;
  segments: CdafSegment[];
};

export type CdafParseResult =
  | { ok: true; sidecar: CdafSidecar }
  | { ok: false; error: string };

export type CdafValidation = {
  ok: boolean;
  errors: string[];
};

export type CdafMatchKind = 'hash' | 'duration-name' | 'none';

export type CdafMatchResult = {
  matched: boolean;
  kind: CdafMatchKind;
  reason: string;
};

export type CdafVideoIdentity = {
  name: string;
  sha256?: string;
  duration?: number;
};

const SHA256_RE = /^[a-f0-9]{64}$/i;

export const formatCdafTimecode = (seconds: number): string => {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

export const parseCdafTimecode = (value: string): number | null => {
  const raw = value.trim().replace(/^\[|\]$/g, '');
  const hms = raw.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (hms) {
    const hours = Number(hms[1]);
    const mins = Number(hms[2]);
    const secs = Number(hms[3]);
    const frac = hms[4] ? Number(hms[4].padEnd(3, '0')) / 1000 : 0;
    return hours * 3600 + mins * 60 + secs + frac;
  }
  const ms = raw.match(/^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (ms) {
    const mins = Number(ms[1]);
    const secs = Number(ms[2]);
    const frac = ms[3] ? Number(ms[3].padEnd(3, '0')) / 1000 : 0;
    return mins * 60 + secs + frac;
  }
  const plain = Number(raw);
  return Number.isFinite(plain) && plain >= 0 ? plain : null;
};

export const videoBasenameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url, 'http://localhost');
    const inner = parsed.searchParams.get('url');
    const target = inner ? new URL(inner) : parsed;
    const leaf = decodeURIComponent((target.pathname.split('/').filter(Boolean).pop() || '').split('?')[0]);
    return leaf || 'video';
  } catch {
    return 'video';
  }
};

export const sidecarDownloadName = (videoName: string): string => {
  const stem = (videoName || 'footage').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'footage';
  return `${stem}.cdaf.txt`;
};

const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.(mp4|mov|webm|mkv|m4v|avi|cdaf|txt|md)$/g, '')
    .replace(/[^a-z0-9]+/g, '');

export const namesLooselyMatch = (a: string, b: string): boolean => {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 8 && longer.includes(shorter);
};

export const durationsLooselyMatch = (a?: number, b?: number): boolean => {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tol = Math.max(0.5, 0.02 * Math.max(a, b));
  return Math.abs(a - b) <= tol;
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const hashVideoBytes = async (source: Blob | ArrayBuffer): Promise<string> => {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(digest);
};

const promptLead = (prompt: string): string => {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return sentence.length > 110 ? `${sentence.slice(0, 107)}...` : sentence;
};

export const findCdafSegment = (
  sidecar: CdafSidecar,
  timestamp: number,
  toleranceSec = 1.5
): CdafSegment | undefined => {
  let best: CdafSegment | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const segment of sidecar.segments) {
    const delta = Math.abs(segment.timestamp - timestamp);
    if (delta <= toleranceSec && delta < bestDelta) {
      best = segment;
      bestDelta = delta;
    }
  }
  return best;
};

export const applyCdafToFrames = (
  frames: FrameData[],
  sidecar: CdafSidecar,
  toleranceSec = 1.5
): { frames: FrameData[]; applied: number; uncovered: number } => {
  let applied = 0;
  let uncovered = 0;
  const next = frames.map((frame) => {
    const segment = findCdafSegment(sidecar, frame.timestamp, toleranceSec);
    if (!segment) {
      uncovered += 1;
      return frame;
    }
    applied += 1;
    return {
      ...frame,
      prompt: segment.notes,
      metadata: {
        shotType: segment.shotType,
        cameraAngle: segment.cameraAngle,
        lighting: segment.lighting,
        palette: segment.palette,
      },
      isAnalyzing: false,
      error: undefined,
    };
  });
  return { frames: next, applied, uncovered };
};

export const validateCdafSidecar = (sidecar: CdafSidecar): CdafValidation => {
  const errors: string[] = [];
  if (!sidecar.header.video.trim()) errors.push('Header is missing the video basename.');
  if (sidecar.header.sha256 && !SHA256_RE.test(sidecar.header.sha256)) {
    errors.push('Header sha256 must be a 64-character hex digest.');
  }
  if (sidecar.header.duration != null && (!Number.isFinite(sidecar.header.duration) || sidecar.header.duration < 0)) {
    errors.push('Header duration must be a non-negative number of seconds.');
  }
  if (!sidecar.header.generator.trim()) errors.push('Header is missing generator.');
  if (!sidecar.header.created.trim()) errors.push('Header is missing created timestamp.');
  if (!sidecar.summary.trim()) errors.push('Summary is empty.');
  if (sidecar.segments.length === 0) errors.push('Sidecar has no timestamped segments.');
  sidecar.segments.forEach((segment, index) => {
    if (!Number.isFinite(segment.timestamp) || segment.timestamp < 0) {
      errors.push(`Segment ${index + 1} has an invalid timestamp.`);
    }
    if (!segment.notes.trim()) {
      errors.push(`Segment ${index + 1} (${segment.timecode || '?'}) has no shot notes.`);
    }
  });
  return { ok: errors.length === 0, errors };
};

export const matchCdafToVideo = (
  sidecar: CdafSidecar,
  video: CdafVideoIdentity
): CdafMatchResult => {
  if (sidecar.header.sha256 && video.sha256) {
    if (sidecar.header.sha256.toLowerCase() === video.sha256.toLowerCase()) {
      return { matched: true, kind: 'hash', reason: 'SHA-256 matches the current video bytes.' };
    }
    return {
      matched: false,
      kind: 'none',
      reason: 'SHA-256 does not match this video. Import blocked so the wrong notes are not applied.',
    };
  }

  const nameOk = namesLooselyMatch(sidecar.header.video, video.name);
  const durationKnown = video.duration != null && Number.isFinite(video.duration);
  const durationOk = durationsLooselyMatch(sidecar.header.duration, video.duration);

  if (nameOk && durationOk) {
    return { matched: true, kind: 'duration-name', reason: 'Video name and duration match the sidecar.' };
  }
  if (nameOk && !durationKnown) {
    return {
      matched: true,
      kind: 'duration-name',
      reason: 'Video name matches the sidecar. Duration is not measured yet.',
    };
  }
  if (nameOk && sidecar.header.duration == null) {
    return { matched: true, kind: 'duration-name', reason: 'Video name matches; sidecar has no duration to compare.' };
  }
  if (durationOk && !video.name) {
    return { matched: true, kind: 'duration-name', reason: 'Duration matches the sidecar.' };
  }
  if (nameOk && !durationOk) {
    return {
      matched: false,
      kind: 'none',
      reason: 'Filename looks similar but duration differs. Import blocked.',
    };
  }
  return {
    matched: false,
    kind: 'none',
    reason: 'Sidecar does not match this video (hash, name, or duration).',
  };
};

const escapeHeaderValue = (value: string): string => value.replace(/\r?\n/g, ' ').trim();

export const serializeCdafSidecar = (sidecar: CdafSidecar): string => {
  const headerLines = [
    CDAF_FORMAT_LINE,
    `video: ${escapeHeaderValue(sidecar.header.video)}`,
  ];
  if (sidecar.header.sha256) headerLines.push(`sha256: ${sidecar.header.sha256.toLowerCase()}`);
  if (sidecar.header.duration != null && Number.isFinite(sidecar.header.duration)) {
    headerLines.push(`duration: ${sidecar.header.duration.toFixed(3)}`);
  }
  headerLines.push(`generator: ${escapeHeaderValue(sidecar.header.generator || CDAF_GENERATOR)}`);
  headerLines.push(`created: ${escapeHeaderValue(sidecar.header.created)}`);

  const summary = sidecar.summary.trim() || 'Cached shot notes from FrameFlow.';
  const body: string[] = ['# Summary', '', summary, '', '# Segments', ''];

  for (const segment of [...sidecar.segments].sort((a, b) => a.timestamp - b.timestamp)) {
    body.push(`## ${segment.timecode || formatCdafTimecode(segment.timestamp)}`, '');
    if (segment.shotType) body.push(`- shot: ${segment.shotType}`);
    if (segment.cameraAngle) body.push(`- camera: ${segment.cameraAngle}`);
    if (segment.lighting) body.push(`- lighting: ${segment.lighting}`);
    if (segment.palette?.length) body.push(`- palette: ${segment.palette.join(', ')}`);
    if (segment.shotType || segment.cameraAngle || segment.lighting || segment.palette?.length) {
      body.push('');
    }
    body.push(segment.notes.trim(), '');
  }

  return `${headerLines.join('\n')}\n---\n\n${body.join('\n').trim()}\n`;
};

const parseHeaderMap = (block: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^CDAF\b/i.test(line)) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
};

const parseSegmentHeading = (line: string): number | null => {
  const heading = line.replace(/^#+\s*/, '').trim();
  return parseCdafTimecode(heading);
};

const parseMetaLine = (line: string): { key: string; value: string } | null => {
  const bullet = line.match(/^(?:[-*]\s+|\*\*)(shot|camera|lighting|palette)\*?\*?:?\s*(.+)$/i);
  if (!bullet) return null;
  return { key: bullet[1].toLowerCase(), value: bullet[2].replace(/\*+$/, '').trim() };
};

const parseBody = (body: string): { summary: string; segments: CdafSegment[] } => {
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/);
  let section: 'none' | 'summary' | 'segments' = 'none';
  const summaryLines: string[] = [];
  const segments: CdafSegment[] = [];
  let current: CdafSegment | null = null;
  const noteLines: string[] = [];

  const flushNotes = () => {
    if (!current) return;
    current.notes = noteLines.join('\n').trim();
    noteLines.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\s*summary\b/i.test(trimmed)) {
      flushNotes();
      current = null;
      section = 'summary';
      continue;
    }
    if (/^#\s*segments\b/i.test(trimmed)) {
      flushNotes();
      current = null;
      section = 'segments';
      continue;
    }
    if (section === 'segments' && /^##\s+/.test(trimmed)) {
      flushNotes();
      const timestamp = parseSegmentHeading(trimmed);
      if (timestamp == null) continue;
      current = {
        timestamp,
        timecode: formatCdafTimecode(timestamp),
        notes: '',
      };
      segments.push(current);
      continue;
    }
    if (section === 'summary') {
      summaryLines.push(line);
      continue;
    }
    if (section === 'segments' && current) {
      const meta = parseMetaLine(trimmed);
      if (meta && !current.notes) {
        if (meta.key === 'shot') current.shotType = meta.value;
        else if (meta.key === 'camera') current.cameraAngle = meta.value;
        else if (meta.key === 'lighting') current.lighting = meta.value;
        else if (meta.key === 'palette') {
          current.palette = meta.value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
        }
        continue;
      }
      noteLines.push(line);
    }
  }
  flushNotes();

  return {
    summary: summaryLines.join('\n').trim(),
    segments,
  };
};

export const parseCdafSidecar = (text: string): CdafParseResult => {
  const raw = (text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { ok: false, error: 'Footage notes file is empty.' };

  const split = raw.match(/^(CDAF(?:\s+\d+)?\s*(?:\r?\n[\s\S]*?)?)\r?\n---\s*(?:\r?\n|$)/i);
  if (!split) {
    return {
      ok: false,
      error: 'Not a FrameFlow footage-notes sidecar. Expected a CDAF header followed by --- and a markdown body.',
    };
  }

  const headerMap = parseHeaderMap(split[1]);
  const durationRaw = headerMap.duration;
  const duration = durationRaw != null && durationRaw !== '' ? Number(durationRaw) : undefined;
  const header: CdafHeader = {
    video: headerMap.video || '',
    sha256: headerMap.sha256 || undefined,
    duration: duration != null && Number.isFinite(duration) ? duration : undefined,
    generator: headerMap.generator || CDAF_GENERATOR,
    created: headerMap.created || '',
  };
  const { summary, segments } = parseBody(raw.slice(split[0].length));
  const sidecar: CdafSidecar = { header, summary, segments };
  const validation = validateCdafSidecar(sidecar);
  if (!validation.ok) {
    return { ok: false, error: validation.errors[0] || 'Footage notes sidecar is invalid.' };
  }
  return { ok: true, sidecar };
};

export const buildCdafFromFrames = (
  frames: FrameData[],
  identity: CdafVideoIdentity,
  extras?: { storyScript?: string | null }
): CdafSidecar => {
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const segments: CdafSegment[] = sorted
    .filter((frame) => (frame.prompt || '').trim())
    .map((frame) => ({
      timestamp: frame.timestamp,
      timecode: formatCdafTimecode(frame.timestamp),
      notes: (frame.prompt || '').trim(),
      shotType: frame.metadata?.shotType,
      cameraAngle: frame.metadata?.cameraAngle,
      lighting: frame.metadata?.lighting,
      palette: frame.metadata?.palette,
    }));

  const duration = identity.duration;
  const durationLabel = duration != null && Number.isFinite(duration) ? `${duration.toFixed(1)}s` : 'unknown duration';
  const indexLines = segments
    .slice(0, 12)
    .map((segment) => `- ${segment.timecode} — ${promptLead(segment.notes) || 'shot note'}`);
  const storyLead = (extras?.storyScript || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const summary = [
    `${segments.length} cached shot note${segments.length === 1 ? '' : 's'} for ${identity.name || 'video'} (${durationLabel}). Reuse this sidecar instead of re-running vision.`,
    storyLead ? `Narrative: ${storyLead}` : '',
    indexLines.length ? indexLines.join('\n') : '',
  ].filter(Boolean).join('\n\n');

  return {
    header: {
      video: identity.name || 'video',
      sha256: identity.sha256,
      duration: duration != null && Number.isFinite(duration) ? duration : undefined,
      generator: CDAF_GENERATOR,
      created: new Date().toISOString(),
    },
    summary,
    segments,
  };
};
