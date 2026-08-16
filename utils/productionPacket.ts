/**
 * Local production-packet helpers for FrameFlow.
 * Inventory, continuity passport, and a verify pass over analyzed shots.
 * No network, no extra API keys.
 */
import type { FrameData } from '../types';

export type QualitySeverity = 'fail' | 'warn' | 'info';

export type QualityIssue = {
  severity: QualitySeverity;
  code: string;
  message: string;
  frameId?: string;
  timestamp?: number;
};

export type AssetPassport = {
  characters: string[];
  wardrobeLock: string;
  locations: string[];
  lightingLock: string;
  paletteLock: string[];
  cameraGrammar: string[];
  continuityNote: string;
  lockedBlock: string;
};

export type ShotInventoryRow = {
  index: number;
  frameId: string;
  timestamp: number;
  timecode: string;
  shotType: string;
  cameraAngle: string;
  lighting: string;
  palette: string[];
  prompt: string;
  hasError: boolean;
  hasGeneratedStill: boolean;
};

export type QualityReport = {
  generatedAt: string;
  score: number;
  ready: boolean;
  summary: string;
  issues: QualityIssue[];
  counts: {
    shots: number;
    prompted: number;
    failed: number;
    withStills: number;
  };
};

export type ProductionPacket = {
  version: 1;
  app: 'FrameFlow';
  generatedAt: string;
  samplingIntervalSec?: number;
  passport: AssetPassport;
  inventory: ShotInventoryRow[];
  report: QualityReport;
};

const formatTimecode = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const sortedFrames = (frames: FrameData[]): FrameData[] =>
  [...frames].sort((a, b) => a.timestamp - b.timestamp);

const mode = (values: string[]): string => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
};

const unique = (values: string[], limit = 8): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
};

const promptLead = (prompt: string): string => {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
};

export const buildShotInventory = (frames: FrameData[]): ShotInventoryRow[] =>
  sortedFrames(frames).map((frame, index) => ({
    index: index + 1,
    frameId: frame.id,
    timestamp: frame.timestamp,
    timecode: formatTimecode(frame.timestamp),
    shotType: frame.metadata?.shotType || 'unspecified',
    cameraAngle: frame.metadata?.cameraAngle || 'unspecified',
    lighting: frame.metadata?.lighting || 'unspecified',
    palette: frame.metadata?.palette || [],
    prompt: (frame.prompt || '').trim(),
    hasError: Boolean(frame.error),
    hasGeneratedStill: Boolean(frame.generatedImage || frame.remixImage),
  }));

export const buildAssetPassport = (frames: FrameData[]): AssetPassport => {
  const inventory = buildShotInventory(frames);
  const prompted = inventory.filter((row) => row.prompt);
  const lightingLock = mode(prompted.map((row) => row.lighting).filter((v) => v !== 'unspecified')) || 'match existing practicals';
  const cameraGrammar = unique(prompted.map((row) => row.shotType).filter((v) => v !== 'unspecified'), 6);
  const paletteLock = unique(prompted.flatMap((row) => row.palette), 6);
  const characters = unique(
    prompted
      .map((row) => promptLead(row.prompt))
      .filter(Boolean)
      .slice(0, 12),
    4
  );
  const locations = unique(
    prompted.map((row) => {
      const match = row.prompt.match(/\b(?:in|inside|at|on)\s+(?:a|an|the)\s+([^.,;]{4,48})/i);
      return match?.[1] || '';
    }),
    4
  );
  const wardrobeLock = characters.length
    ? 'Keep wardrobe, hair, age, and face geometry byte-identical across every shot prompt.'
    : 'Lock wardrobe and face details in every prompt; do not paraphrase identity.';
  const continuityNote = [
    lightingLock ? `Lighting lock: ${lightingLock}.` : '',
    cameraGrammar.length ? `Coverage used: ${cameraGrammar.join(', ')}.` : '',
    paletteLock.length ? `Palette lock: ${paletteLock.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  const lockedBlock = [
    'CONTINUITY PASSPORT — paste verbatim into every shot prompt.',
    characters.length ? `Subjects: ${characters.join(' | ')}` : 'Subjects: keep the same principal(s) as the source frames.',
    locations.length ? `Locations: ${locations.join(' | ')}` : '',
    `Lighting: ${lightingLock}.`,
    paletteLock.length ? `Palette: ${paletteLock.join(', ')}.` : '',
    wardrobeLock,
    'Do not invent new faces, outfits, or rooms unless the shot list explicitly calls a new scene.',
  ].filter(Boolean).join('\n');

  return {
    characters,
    wardrobeLock,
    locations,
    lightingLock,
    paletteLock,
    cameraGrammar,
    continuityNote,
    lockedBlock,
  };
};

export const buildQualityReport = (
  frames: FrameData[],
  samplingIntervalSec = 3
): QualityReport => {
  const inventory = buildShotInventory(frames);
  const issues: QualityIssue[] = [];
  const prompted = inventory.filter((row) => row.prompt).length;
  const failed = inventory.filter((row) => row.hasError).length;
  const withStills = inventory.filter((row) => row.hasGeneratedStill).length;

  if (inventory.length === 0) {
    issues.push({
      severity: 'fail',
      code: 'NO_SHOTS',
      message: 'No extracted frames to verify.',
    });
  }

  for (const row of inventory) {
    if (row.hasError) {
      issues.push({
        severity: 'fail',
        code: 'ANALYSIS_ERROR',
        message: `Shot ${row.index} at ${row.timecode} failed analysis.`,
        frameId: row.frameId,
        timestamp: row.timestamp,
      });
    } else if (!row.prompt) {
      issues.push({
        severity: 'fail',
        code: 'MISSING_PROMPT',
        message: `Shot ${row.index} at ${row.timecode} has no production prompt.`,
        frameId: row.frameId,
        timestamp: row.timestamp,
      });
    } else if (row.prompt.length < 40) {
      issues.push({
        severity: 'warn',
        code: 'THIN_PROMPT',
        message: `Shot ${row.index} prompt is too thin for a reliable regen (${row.prompt.length} chars).`,
        frameId: row.frameId,
        timestamp: row.timestamp,
      });
    }

    if (row.prompt && row.shotType === 'unspecified') {
      issues.push({
        severity: 'warn',
        code: 'MISSING_SHOT_TYPE',
        message: `Shot ${row.index} is missing shot-type metadata.`,
        frameId: row.frameId,
        timestamp: row.timestamp,
      });
    }
  }

  for (let i = 1; i < inventory.length; i += 1) {
    const prev = inventory[i - 1];
    const curr = inventory[i];
    const gap = curr.timestamp - prev.timestamp;
    if (gap > samplingIntervalSec * 2.5) {
      issues.push({
        severity: 'warn',
        code: 'COVERAGE_GAP',
        message: `Coverage gap of ${gap.toFixed(1)}s between ${prev.timecode} and ${curr.timecode}.`,
        frameId: curr.frameId,
        timestamp: curr.timestamp,
      });
    }
    if (prev.prompt && curr.prompt && prev.prompt === curr.prompt) {
      issues.push({
        severity: 'warn',
        code: 'DUPLICATE_PROMPT',
        message: `Shots ${prev.index} and ${curr.index} share an identical prompt — likely a freeze or stalled cut.`,
        frameId: curr.frameId,
        timestamp: curr.timestamp,
      });
    }
  }

  const lightingValues = inventory
    .map((row) => row.lighting)
    .filter((v) => v !== 'unspecified');
  const uniqueLighting = unique(lightingValues, 20);
  if (uniqueLighting.length >= Math.max(4, Math.ceil(inventory.length * 0.7))) {
    issues.push({
      severity: 'warn',
      code: 'LIGHTING_DRIFT',
      message: `Lighting labels drift across ${uniqueLighting.length} variants. Lock one grade before generating stills.`,
    });
  }

  if (prompted > 0 && withStills === 0) {
    issues.push({
      severity: 'info',
      code: 'NO_STILLS',
      message: 'Prompts are ready but no Grok Imagine stills have been generated yet.',
    });
  }

  const fails = issues.filter((issue) => issue.severity === 'fail').length;
  const warns = issues.filter((issue) => issue.severity === 'warn').length;
  const score = Math.max(0, Math.min(100, 100 - fails * 18 - warns * 6));
  const ready = fails === 0 && inventory.length > 0;

  const summary = inventory.length === 0
    ? 'Nothing to verify.'
    : ready
      ? `Packet ready: ${prompted}/${inventory.length} prompted shots, score ${score}/100.`
      : `Not ready: ${fails} blocking issue${fails === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}, score ${score}/100.`;

  return {
    generatedAt: new Date().toISOString(),
    score,
    ready,
    summary,
    issues,
    counts: {
      shots: inventory.length,
      prompted,
      failed,
      withStills,
    },
  };
};

export const buildProductionPacket = (
  frames: FrameData[],
  samplingIntervalSec = 3
): ProductionPacket => ({
  version: 1,
  app: 'FrameFlow',
  generatedAt: new Date().toISOString(),
  samplingIntervalSec,
  passport: buildAssetPassport(frames),
  inventory: buildShotInventory(frames),
  report: buildQualityReport(frames, samplingIntervalSec),
});

export const packetToMarkdown = (packet: ProductionPacket): string => {
  const issueLines = packet.report.issues.length
    ? packet.report.issues.map((issue) => `- **${issue.severity.toUpperCase()}** \`${issue.code}\` — ${issue.message}`).join('\n')
    : '- None';

  const shotLines = packet.inventory.map((row) => {
    const prompt = row.prompt ? row.prompt.replace(/\n/g, ' ') : '_missing_';
    return `| ${row.index} | ${row.timecode} | ${row.shotType} | ${row.cameraAngle} | ${row.lighting} | ${prompt} |`;
  }).join('\n');

  return [
    '# FrameFlow production packet',
    '',
    `Generated: ${packet.generatedAt}`,
    `Verify score: **${packet.report.score}/100** — ${packet.report.ready ? 'READY' : 'NOT READY'}`,
    '',
    '## Continuity passport',
    '',
    '```',
    packet.passport.lockedBlock,
    '```',
    '',
    packet.passport.continuityNote,
    '',
    '## Quality report',
    '',
    packet.report.summary,
    '',
    issueLines,
    '',
    '## Shot inventory (EDL)',
    '',
    '| # | Timecode | Shot | Angle | Lighting | Prompt |',
    '|---|----------|------|-------|----------|--------|',
    shotLines,
    '',
  ].join('\n');
};

export const downloadTextFile = (filename: string, contents: string, mime = 'text/plain'): void => {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
