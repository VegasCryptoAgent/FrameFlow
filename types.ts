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
