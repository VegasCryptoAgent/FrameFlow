export interface FrameData {
  id: string;
  timestamp: number;
  imageUrl: string; // base64
  prompt: string | null;
  isAnalyzing: boolean;
  error?: string;
  
  // Image Generation fields
  generatedImage?: string | null; // base64 of generated image
  isGeneratingImage?: boolean;
  isUpscaling?: boolean;

  // Remix fields
  remixPrompt?: string | null;
  remixImage?: string | null;
  isRemixing?: boolean;
  isGeneratingRemixImage?: boolean;

  // Edit status
  isEdited?: boolean;

  // Cinematic Metadata
  metadata?: {
    shotType?: string;
    cameraAngle?: string;
    lighting?: string;
    palette?: string[];
  };
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  url: string;
  file?: File;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  EXTRACTING = 'EXTRACTING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface AppSettings {
  samplingInterval: number; // Seconds between frames
  xaiModel: string;
  customInstructions: string;
  promptTemplate: string; // Template with placeholders like {{PROMPT}}
  preferBeatAccents: boolean;
  preferTalkWindows: boolean;
}

export const RHYTHM_MAP_SCHEMA_VERSION = 'frameflow-rhythm-map-1.0' as const;

export const RHYTHM_MAP_ATTRIBUTION =
  "inspired by BeatScope's cue-map idea (MIT); original FrameFlow implementation";

/** Motion-oriented cue labels for an eight-bar-style rhythm window. Not drum transcription. */
export type RhythmCueLabel = 'impact' | 'scale' | 'flow' | 'flash' | 'bloom';

export type RhythmBand = 'low' | 'mid' | 'high';

export interface RhythmBeat {
  time: number;
}

export interface RhythmOnset {
  time: number;
  strength: number;
  band: RhythmBand;
}

export interface RhythmEnergySample {
  time: number;
  low: number;
  mid: number;
  high: number;
}

export interface RhythmCueWindow {
  start: number;
  end: number;
  label: RhythmCueLabel;
  intensity: number;
}

/**
 * Compact timing package produced by FrameFlow's Web Audio analyzer.
 * schema_version: frameflow-rhythm-map-1.0
 *
 * Inspired by BeatScope's cue-map idea (MIT); original FrameFlow implementation.
 */
export interface RhythmMap {
  schema_version: typeof RHYTHM_MAP_SCHEMA_VERSION;
  attribution: string;
  duration: number;
  bpm: number | null;
  beats: RhythmBeat[];
  onsets: RhythmOnset[];
  energy: RhythmEnergySample[];
  cues: RhythmCueWindow[];
  video?: string;
  created?: string;
}

export const CLIP_HEALTH_SCHEMA_VERSION = 'frameflow-clip-health-1.0' as const;

export const CLIP_HEALTH_ATTRIBUTION =
  'motion-health idea inspired by AIVideoAdherenceGate (MIT); original FrameFlow implementation';

export const PLATFORM_FIT_SCHEMA_VERSION = 'frameflow-platform-fit-1.0' as const;

export const PLATFORM_FIT_ATTRIBUTION =
  'platform-fit idea inspired by ShortsMCP (MIT); original FrameFlow implementation';

/** Ship-readiness grade from duration + frame size. Not a vendor platform table. */
export type PlatformFitStatus = 'GO' | 'WARN' | 'NO-GO';

export type PlatformFitAspect = '9:16' | '16:9' | '1:1' | 'other';

export type PlatformFitId =
  | 'youtube_shorts'
  | 'tiktok'
  | 'instagram_reels'
  | 'facebook_reels'
  | 'twitter_x'
  | 'linkedin';

export interface PlatformFitRow {
  id: PlatformFitId;
  status: PlatformFitStatus;
  want: '9:16' | '16:9';
  minSec: number;
  maxSec: number;
  title: string;
  caption: string;
  issues: string[];
}

/**
 * Versioned platform-fit grade from known width / height / duration.
 * schema_version: frameflow-platform-fit-1.0
 *
 * Platform-fit idea inspired by ShortsMCP (MIT); original FrameFlow implementation.
 */
export interface PlatformFitReport {
  ok: boolean;
  source: typeof PLATFORM_FIT_SCHEMA_VERSION;
  vertical: boolean;
  aspect: PlatformFitAspect;
  durationSeconds: number | null;
  platforms: PlatformFitRow[];
}

/** Pixel-motion verdict from consecutive sampled frames. Not a vision-model grade. */
export type ClipHealthVerdict = 'OK' | 'STATIC' | 'JITTER' | 'MORPH';

export type ClipHealthSeverity = 'fail' | 'warn' | 'info';

export interface ClipHealthSample {
  timestamp: number;
  motion: number;
}

export interface ClipHealthIssue {
  code: string;
  severity: ClipHealthSeverity;
  message: string;
  timestamp?: number;
}

/**
 * Versioned motion-health sidecar produced from sampled frames.
 * schema_version: frameflow-clip-health-1.0
 *
 * Motion-health idea inspired by AIVideoAdherenceGate (MIT); original FrameFlow implementation.
 */
export interface ClipHealthReport {
  schema_version: typeof CLIP_HEALTH_SCHEMA_VERSION;
  attribution: string;
  video?: string;
  created?: string;
  verdict: ClipHealthVerdict;
  mean: number;
  variance: number;
  summary: string;
  timestamps: number[];
  samples: ClipHealthSample[];
  issues: ClipHealthIssue[];
}

export const SILENCE_MAP_SCHEMA_VERSION = 'frameflow-silence-map-1.0' as const;

export const SILENCE_MAP_ATTRIBUTION =
  'inspired by misbakhul29/clipper, original FrameFlow implementation';

/** RMS hop from the browser Web Audio decoder. Server never reads the media file. */
export interface SilenceSample {
  t: number;
  rms: number;
}

export interface SilenceGap {
  start: number;
  end: number;
  duration: number;
  meanRms: number;
}

export interface TalkWindow {
  start: number;
  end: number;
  duration: number;
  meanRms: number;
}

/** Suggested trim — a map, not a rendered cut. FrameFlow does not burn or reframe video. */
export type SuggestedCutKind = 'drop_leading_silence' | 'drop_trailing_silence' | 'drop_internal_gap';

export interface SuggestedCut {
  kind: SuggestedCutKind;
  start: number;
  end: number;
  reason: string;
}

/**
 * Versioned silence / talk-gap sidecar from browser RMS hops.
 * schema_version: frameflow-silence-map-1.0
 *
 * Inspired by misbakhul29/clipper (MIT idea: silence → talk segments / suggested cuts);
 * original FrameFlow implementation. Not their Go/ffmpeg pipeline.
 */
export interface SilenceMap {
  schema_version: typeof SILENCE_MAP_SCHEMA_VERSION;
  attribution: string;
  duration: number;
  noiseFloor: number;
  minSilenceSec: number;
  minTalkSec: number;
  samples: SilenceSample[];
  silences: SilenceGap[];
  talkWindows: TalkWindow[];
  suggestedCuts: SuggestedCut[];
  summary: string;
  video?: string;
  created?: string;
}
