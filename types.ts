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
