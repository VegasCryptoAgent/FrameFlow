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
  geminiModel: string;
  customInstructions: string;
  promptTemplate: string; // Template with placeholders like {{PROMPT}}
}