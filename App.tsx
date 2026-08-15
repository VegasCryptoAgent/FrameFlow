
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Clapperboard, 
  Settings2, 
  Play, 
  Loader2, 
  Trash2,
  Download,
  RefreshCw,
  X,
  CheckSquare,
  Square,
  Info,
  Image as ImageIcon,
  ArrowUpDown,
  AlertCircle,
  BookOpen,
  Sparkles,
  Tag,
  Clock,
  FileText,
  ChevronRight,
  Maximize2,
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Local imports
import VideoUploader, { SAMPLE_VIDEOS, proxyVideoUrl } from './components/VideoUploader';
import FrameCard from './components/FrameCard';
import StoryboardView from './components/StoryboardView';
import { extractFramesFromVideo } from './utils/videoProcessor';
import { 
  generateFramePrompt, 
  generateImage, 
  generateStoryScript, 
  upscaleImage,
  generateRemixPrompt,
  generateRemixStoryScript,
  refineRemix,
  checkXaiConfiguration
} from './services/xaiService';
import { FrameData, AnalysisStatus, AppSettings } from './types';

// Simple ID generator
const generateId = () => Math.random().toString(36).substring(2, 9);

type SortOption = 'time-asc' | 'time-desc' | 'prompt-asc' | 'prompt-desc';

const TEMPLATE_VARIABLES = [
  { name: 'PROMPT', description: 'Full AI generated description' },
  { name: 'SUBJECT', description: 'Main subject details' },
  { name: 'ACTION', description: 'Subject movement/action' },
  { name: 'STYLE', description: 'Visual/artistic style' },
  { name: 'ENVIRONMENT', description: 'Setting/Background' },
  { name: 'LIGHTING', description: 'Lighting/Mood' },
  { name: 'CAMERA', description: 'Angle/Lens/Shot type' },
];

const App: React.FC = () => {
  // App state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Silence Vite WebSocket errors which are expected in this environment
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      // Specifically ignore Vite WebSocket connection failures
      if (typeof event.reason === 'string' && event.reason.includes('WebSocket closed without opened')) {
        event.preventDefault();
        return;
      }
      if (event.reason?.message?.includes('WebSocket closed without opened')) {
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<FrameData[]>(() => {
    const saved = localStorage.getItem('frameflow-frames');
    return saved ? JSON.parse(saved) : [];
  });
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);

  // Persistence
  useEffect(() => {
    if (frames.length > 0) {
      localStorage.setItem('frameflow-frames', JSON.stringify(frames));
    }
  }, [frames]);

  const [progress, setProgress] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = (message: string) => {
    setActionNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setActionNotice(null), 4500);
  };
  
  // Refs
  const templateTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Storyboard State
  const [storyScript, setStoryScript] = useState<string | null>(null);
  const [remixStoryScript, setRemixStoryScript] = useState<string | null>(null);
  const [isStoryboardMode, setIsStoryboardMode] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isBulkGeneratingImages, setIsBulkGeneratingImages] = useState(false);

  // Remix State
  const [remixIdea, setRemixIdea] = useState('');
  const [remixScriptFile, setRemixScriptFile] = useState<File | null>(null);
  const [isRemixing, setIsRemixing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isGeneratingRemixImages, setIsGeneratingRemixImages] = useState(false);

  // Chat State
  const [remixChatHistory, setRemixChatHistory] = useState<{role: 'user' | 'assistant', content: string}[]>([]);

  // Selection State
  // FIX: Added explicit generic type for Set to ensure reliable string typing
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set<string>());

  // Sorting State
  const [sortBy, setSortBy] = useState<SortOption>('time-asc');

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    samplingInterval: 3, // Default 3 seconds
    xaiModel: 'grok-4.5',
    customInstructions: '',
    promptTemplate: '{{PROMPT}}' // Default template
  });
  const [showSettings, setShowSettings] = useState(false);
  const [suggestionState, setSuggestionState] = useState<{
    show: boolean;
    x: number;
    y: number;
    filter: string;
    selectedIndex: number;
    cursorPos: number;
  }>({ show: false, x: 0, y: 0, filter: '', selectedIndex: 0, cursorPos: 0 });

  // Handlers
  const ensureApiKey = async (): Promise<boolean> => {
    try {
      await checkXaiConfiguration();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'xAI is not configured.';
      setGlobalError(message);
      alert(message);
      return false;
    }
  };

  // Handlers
  const handleVideoSelected = (file: File | null, url: string | null) => {
    // Reset state
    setFrames([]);
    setSelectedFrameIds(new Set<string>());
    setStatus(AnalysisStatus.IDLE);
    setProgress(0);
    setSortBy('time-asc');
    setGlobalError(null);
    setStoryScript(null);
    setIsStoryboardMode(false);
    setRemixIdea('');
    setRemixScriptFile(null);
    setRemixChatHistory([]);

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setVideoUrl(objectUrl);
      setVideoFile(file);
    } else if (url) {
      setVideoUrl(url);
      setVideoFile(null);
    }
  };

  const handleReset = () => {
    if (videoUrl && videoFile) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl(null);
    setVideoFile(null);
    setFrames([]);
    setSelectedFrameIds(new Set<string>());
    setStatus(AnalysisStatus.IDLE);
    setProgress(0);
    setGlobalError(null);
    setStoryScript(null);
    setRemixStoryScript(null);
    setIsStoryboardMode(false);
    setRemixIdea('');
    setRemixScriptFile(null);
    setRemixChatHistory([]);
  };

  const startAnalysis = async () => {
    if (!videoUrl) return;

    // Ensure we have an API key if needed
    if (!(await ensureApiKey())) return;

    setStatus(AnalysisStatus.EXTRACTING);
    setProgress(0);
    setGlobalError(null);
    setSelectedFrameIds(new Set<string>()); // Clear selection on new analysis
    setStoryScript(null); // Reset script

    try {
      // 1. Extract Frames
      const extractedFrames = await extractFramesFromVideo(
        videoUrl, 
        settings.samplingInterval,
        (prog) => setProgress(prog)
      );

      if (extractedFrames.length === 0) {
        throw new Error("No frames could be extracted from the video. Please try a different video or check the format.");
      }

      // Convert to FrameData structure
      const initialFrames: FrameData[] = extractedFrames.map(f => ({
        id: generateId(),
        timestamp: f.timestamp,
        imageUrl: f.imageUrl,
        prompt: null,
        isAnalyzing: true,
        error: undefined
      }));

      setFrames(initialFrames);
      setStatus(AnalysisStatus.ANALYZING);
      setProgress(0);

      // 2. Analyze Frames (Parallel but limited to avoid rate limits if possible)
      const BATCH_SIZE = 1;
      console.log(`Starting analysis for ${initialFrames.length} frames (Sequential processing to avoid rate limits)`);
      
      for (let i = 0; i < initialFrames.length; i += BATCH_SIZE) {
        const batch = initialFrames.slice(i, i + BATCH_SIZE);
        console.log(`Analyzing frame ${i + 1}/${initialFrames.length}...`);
        
        await Promise.all(batch.map(async (frame) => {
          try {
            const { prompt, metadata } = await generateFramePrompt(frame.imageUrl, {
              customInstructions: settings.customInstructions,
              template: settings.promptTemplate,
              model: settings.xaiModel
            });
            setFrames(prev => prev.map(f => 
              f.id === frame.id 
                ? { ...f, prompt, metadata, isAnalyzing: false } 
                : f
            ));
          } catch (error) {
            console.error(`Frame analysis error for frame ${frame.id}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to analyze';
            setFrames(prev => prev.map(f => 
              f.id === frame.id 
                ? { ...f, isAnalyzing: false, error: errorMessage } 
                : f
            ));
          }
        }));

        // Update progress roughly
        const currentProgress = Math.round(((i + BATCH_SIZE) / initialFrames.length) * 100);
        setProgress(Math.min(100, currentProgress));

        // Delay between frames to respect RPM limits
        if (i + BATCH_SIZE < initialFrames.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      setStatus(AnalysisStatus.COMPLETED);

    } catch (error) {
      console.error(error);
      setGlobalError(error instanceof Error ? error.message : "An unexpected error occurred during analysis.");
      setStatus(AnalysisStatus.ERROR);
    }
  };

  const handleRetryFrame = async (frameId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;

    if (!(await ensureApiKey())) return;

    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, isAnalyzing: true, error: undefined } : f));

    try {
      const { prompt, metadata } = await generateFramePrompt(frame.imageUrl, {
        customInstructions: settings.customInstructions,
        template: settings.promptTemplate,
        model: settings.xaiModel
      });
      setFrames(prev => prev.map(f => 
        f.id === frameId 
          ? { ...f, prompt, metadata, isAnalyzing: false } 
          : f
      ));
    } catch (error) {
      setFrames(prev => prev.map(f => 
        f.id === frameId 
          ? { ...f, isAnalyzing: false, error: 'Retry failed' } 
          : f
      ));
    }
  };

  const handleUpdatePrompt = (frameId: string, newPrompt: string) => {
    setFrames(prev => prev.map(f => 
      f.id === frameId 
        ? { ...f, prompt: newPrompt, isEdited: true } 
        : f
    ));
  };

  const processBatchImageGeneration = async (frameIds: string[]) => {
    if (frameIds.length === 0) return;
    
    const hasKey = await ensureApiKey();
    if (!hasKey) return;

    const framesToProcess = frames.filter(f => frameIds.includes(f.id) && f.prompt);
    
    // Set loading state for all frames in the batch
    setFrames(prev => prev.map(f => 
      frameIds.includes(f.id) && f.prompt ? { ...f, isGeneratingImage: true } : f
    ));

    // Process in small batches for images (high-latency model)
    const BATCH_SIZE = 2;
    for (let i = 0; i < framesToProcess.length; i += BATCH_SIZE) {
      const batch = framesToProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (frame) => {
        if (!frame.prompt) return;
        try {
          // Pass original frame as reference
          const generatedImage = await generateImage(frame.prompt, frame.imageUrl);
          setFrames(prev => prev.map(f => 
            f.id === frame.id ? { ...f, generatedImage, isGeneratingImage: false } : f
          ));
        } catch (e) {
          console.error("Batch image gen error", e);
          setFrames(prev => prev.map(f => 
            f.id === frame.id ? { ...f, isGeneratingImage: false } : f
          ));
        }
      }));

      // Add delay for image generation batching too
      if (i + BATCH_SIZE < framesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };

  const handleGenerateImage = async (frameId: string, referenceImageUrl?: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame || !frame.prompt) return;

    const hasKey = await ensureApiKey();
    if (!hasKey) return;

    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, isGeneratingImage: true } : f));

    try {
        const refImage = referenceImageUrl || frame.imageUrl;
        const generatedImage = await generateImage(frame.prompt, refImage);
        setFrames(prev => prev.map(f => 
            f.id === frameId ? { ...f, generatedImage, isGeneratingImage: false } : f
        ));
    } catch (e) {
        console.error("Failed to generate image", e);
        setFrames(prev => prev.map(f => 
            f.id === frameId ? { ...f, isGeneratingImage: false } : f
        ));
        alert("Failed to generate image. Please ensure you have selected a valid project/key.");
    }
  };

  const handleUpscaleImage = async (frameId: string, size: "2K" = "2K") => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame || !frame.prompt) return;

    // We upscale the generatedImage by default as requested
    const imageToUpscale = frame.generatedImage || frame.remixImage;
    if (!imageToUpscale) return;

    const hasKey = await ensureApiKey();
    if (!hasKey) return;

    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, isUpscaling: true } : f));

    try {
      const upscaled = await upscaleImage(frame.prompt, imageToUpscale, size);
      setFrames(prev => prev.map(f => {
        if (f.id === frameId) {
          // Update whichever image was the source
          return { 
            ...f, 
            generatedImage: f.generatedImage === imageToUpscale ? upscaled : f.generatedImage,
            remixImage: f.remixImage === imageToUpscale ? upscaled : f.remixImage,
            isUpscaling: false 
          };
        }
        return f;
      }));
    } catch (e) {
      console.error("Upscale failed:", e);
      setFrames(prev => prev.map(f => f.id === frameId ? { ...f, isUpscaling: false } : f));
      alert("Upscale failed. Please check your API key and model availability.");
    }
  };

  const handleGenerateAllImages = async () => {
    const frameIdsWithPrompts = frames
      .filter(f => f.prompt && !f.generatedImage)
      .map(f => f.id);
    
    if (frameIdsWithPrompts.length === 0) {
      alert("No frames available for image generation (all frames may already have images or missing prompts).");
      return;
    }

    if (!window.confirm(`Generate AI images for all ${frameIdsWithPrompts.length} remaining frames? This may take several minutes.`)) {
      return;
    }

    setIsBulkGeneratingImages(true);
    try {
      await processBatchImageGeneration(frameIdsWithPrompts);
    } finally {
      setIsBulkGeneratingImages(false);
    }
  };

  const formatShotClock = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const buildLocalNarrative = (sourceFrames: FrameData[]) => {
    const analyzed = sourceFrames.filter(f => f.prompt).length;
    const shots = sourceFrames
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((frame, index) => {
        const title = `SHOT ${String(index + 1).padStart(2, '0')}  ${formatShotClock(frame.timestamp)}`;
        const body = frame.prompt || 'Frame captured. AI interpretation was unavailable for this shot.';
        return `${title}\n${body}`;
      })
      .join('\n\n');
    return [
      'LOGLINE:',
      `A ${sourceFrames.length}-shot storyboard assembled from the extracted video frames.`,
      '',
      'TREATMENT:',
      analyzed
        ? `${analyzed} of ${sourceFrames.length} shots include AI production notes. Remaining shots keep their captured stills so the board can still be reviewed and exported.`
        : 'AI analysis was unavailable, so this board uses the extracted stills and timestamps. You can still review the sequence and export a PDF.',
      '',
      'SCENE BREAKDOWN:',
      shots,
    ].join('\n');
  };

  const handleCreateStoryboard = async () => {
    if (frames.length === 0) {
      showNotice('Extract frames before building a storyboard.');
      return;
    }

    if (storyScript) {
      setIsStoryboardMode(true);
      return;
    }

    const validPrompts = frames
      .map(f => f.prompt)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);

    setIsGeneratingScript(true);
    try {
      if (validPrompts.length > 0) {
        try {
          await checkXaiConfiguration();
          const script = await generateStoryScript(validPrompts, settings.xaiModel);
          setStoryScript(script);
          setIsStoryboardMode(true);
          showNotice('Storyboard ready. You can export a PDF from the board.');
          return;
        } catch (error) {
          console.error('Failed to generate storyboard script', error);
        }
      }

      setStoryScript(buildLocalNarrative(frames));
      setIsStoryboardMode(true);
      showNotice(validPrompts.length === 0
        ? 'Opened a visual storyboard from the extracted frames. PDF export is available.'
        : 'Opened a local storyboard after AI narrative generation failed. PDF export is available.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRemixStoryboard = async () => {
    if (!remixIdea?.trim() && !remixScriptFile) {
      alert("Please enter a movie idea or upload a script first.");
      return;
    }

    const framesWithPrompts = frames.filter(f => f.prompt);
    if (framesWithPrompts.length === 0) {
      alert("No analyzed frames found. Please analyze the video first.");
      return;
    }

    if (!(await ensureApiKey())) return;

    setIsRemixing(true);
    setProgress(0);

    try {
      let scriptData: { mimeType: string; data: string; filename: string } | undefined;
      
      if (remixScriptFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(remixScriptFile);
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
        });
        scriptData = {
          mimeType: remixScriptFile.type,
          data: base64,
          filename: remixScriptFile.name
        };
      }

      // If we have selected frames, only remix those. Otherwise remix everything with a prompt.
      const framesToRemix = selectedFrameIds.size > 0 
        ? frames.filter(f => selectedFrameIds.has(f.id) && f.prompt)
        : frames.filter(f => f.prompt);

      if (framesToRemix.length === 0) {
        alert("No valid frames selected for remixing.");
        setIsRemixing(false);
        return;
      }

      // 1. Generate Remixed Narrative Script (always do this for context)
      const allOriginalPrompts = frames.filter(f => f.prompt).map(f => f.prompt as string);
      const newScript = await generateRemixStoryScript(allOriginalPrompts, remixIdea, scriptData, settings.xaiModel);
      setRemixStoryScript(newScript);

      // 2. Generate Remixed Frame Prompts
      const BATCH_SIZE = 1;
      const remixedFramesMap: Record<string, string> = {};
      console.log(`Remixing ${framesToRemix.length} frames (Sequential processing)...`);
      
      for (let i = 0; i < framesToRemix.length; i += BATCH_SIZE) {
        const batch = framesToRemix.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (frame) => {
          if (!frame.prompt) return;
          try {
            const remixPrompt = await generateRemixPrompt(frame.prompt, remixIdea, scriptData, {
              customInstructions: settings.customInstructions,
              template: settings.promptTemplate,
              model: settings.xaiModel,
              storyContext: newScript
            });
            remixedFramesMap[frame.id] = remixPrompt;
            setFrames(prev => prev.map(f => 
              f.id === frame.id 
                ? { ...f, remixPrompt } 
                : f
            ));
          } catch (error) {
            console.error("Remix failed for frame", frame.id, error);
          }
        }));

        const currentProgress = Math.round(((i + BATCH_SIZE) / framesToRemix.length) * 100);
        setProgress(Math.min(100, currentProgress));

        // Delay between remix batches
        if (i + BATCH_SIZE < framesToRemix.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // 3. Automatically trigger image generation for the remixed prompts
      const framesToAutoGen = frames.filter(f => remixedFramesMap[f.id]).map(f => ({
        ...f,
        remixPrompt: remixedFramesMap[f.id]
      }));
      
      handleGenerateRemixImages(framesToAutoGen);

    } catch (error) {
      console.error(error);
      alert("Failed to remix storyboard.");
    } finally {
      setIsRemixing(false);
      setProgress(100);
    }
  };

  const handleRefineRemix = async (feedback: string) => {
    if (!remixStoryScript) return;
    if (!(await ensureApiKey())) return;
    
    setIsRefining(true);
    setRemixChatHistory(prev => [...prev, { role: 'user', content: feedback }]);
    
    try {
      const refinementData = frames.map(f => ({
        id: f.id,
        originalPrompt: f.prompt as string,
        currentRemixPrompt: f.remixPrompt || undefined
      }));

      const result = await refineRemix(
        remixStoryScript,
        feedback,
        refinementData,
        { history: remixChatHistory, model: settings.xaiModel }
      );

      setRemixStoryScript(result.refinedScript);
      setRemixChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `Refinement executed. Script and ${Object.keys(result.refinedFrames).length} shot prompts updated based on your feedback.` 
      }]);

      const updatedFrames = frames.map(frame => {
        const newPrompt = result.refinedFrames[frame.id];
        const promptChanged = newPrompt && newPrompt !== frame.remixPrompt;
        
        return {
          ...frame,
          remixPrompt: newPrompt || frame.remixPrompt,
          remixImage: promptChanged ? null : frame.remixImage 
        };
      });

      setFrames(updatedFrames);

      // If any images were cleared, auto-trigger regeneration for a seamless chat experience
      const framesToRegen = updatedFrames.filter(f => f.remixPrompt && !f.remixImage);
      if (framesToRegen.length > 0) {
        handleGenerateRemixImages(framesToRegen);
      }
    } catch (error) {
      console.error("Refinement failed:", error);
      setRemixChatHistory(prev => [...prev, { role: 'assistant', content: "Error: Failed to process refinement request." }]);
      alert("Failed to refine remix.");
    } finally {
      setIsRefining(false);
    }
  };

  const handleGenerateRemixImages = async (targetFrames?: FrameData[]) => {
    let framesToProcess: FrameData[] = [];
    
    if (targetFrames) {
      framesToProcess = targetFrames;
    } else {
      // Manual trigger: if frames are selected, only process those. Otherwise process all that need images.
      if (selectedFrameIds.size > 0) {
        framesToProcess = frames.filter(f => selectedFrameIds.has(f.id) && f.remixPrompt && !f.remixImage);
        if (framesToProcess.length === 0) {
          alert("Selected frames do not have remixed prompts or already have images.");
          return;
        }
      } else {
        framesToProcess = frames.filter(f => f.remixPrompt && !f.remixImage);
        if (framesToProcess.length === 0) {
          alert("No remixed prompts found to generate images for.");
          return;
        }
      }
    }

    const hasKey = await ensureApiKey();
    if (!hasKey) return;

    setIsGeneratingRemixImages(true);
    
    // Set loading state
    const targetIds = new Set(framesToProcess.map(f => f.id));
    setFrames(prev => prev.map(f => 
       targetIds.has(f.id) ? { ...f, isGeneratingRemixImage: true } : f
    ));

    const BATCH_SIZE = 1;
    for (let i = 0; i < framesToProcess.length; i += BATCH_SIZE) {
      const batch = framesToProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (frame) => {
        const promptToUse = frame.remixPrompt;
        
        if (!promptToUse) return;
        try {
          // Use original frame as reference for composition
          const remixImage = await generateImage(promptToUse, frame.imageUrl);
          setFrames(prev => prev.map(f => 
            f.id === frame.id ? { ...f, remixImage, isGeneratingRemixImage: false } : f
          ));
        } catch (e) {
          console.error("Remix image gen error", e);
          setFrames(prev => prev.map(f => 
            f.id === frame.id ? { ...f, isGeneratingRemixImage: false } : f
          ));
        }
      }));

      // Delay between remix image generations
      if (i + BATCH_SIZE < framesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    setIsGeneratingRemixImages(false);
  };

  const handleDownloadAll = () => {
    const textContent = frames
      .filter(f => f.prompt)
      .map(f => `[${f.timestamp.toFixed(2)}s]\n${f.prompt}\n`)
      .join('\n-------------------\n\n');
    
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Selection Handlers
  const toggleFrameSelection = (id: string) => {
    const newSelected = new Set<string>(selectedFrameIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedFrameIds(newSelected);
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart;
    setSettings({ ...settings, promptTemplate: value });

    // Check if we are inside a {{ variable }}
    const textBeforeCursor = value.substring(0, cursor);
    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
    const lastCloseBraces = textBeforeCursor.lastIndexOf('}}');

    if (lastOpenBraces !== -1 && lastOpenBraces > lastCloseBraces) {
      const filter = textBeforeCursor.substring(lastOpenBraces + 2);
      
      // Simple coordinate estimation
      const rect = e.target.getBoundingClientRect();
      // We'll place it roughly where the textarea is, or try a bit better
      // For a truly precise dropdown we'd need a hidden mirror div, 
      // but for this UI a fixed position dropdown within the textarea container looks good too.
      setSuggestionState({
        show: true,
        x: 20, // relative to container
        y: 60, // relative to container
        filter,
        selectedIndex: 0,
        cursorPos: cursor
      });
    } else {
      setSuggestionState(prev => ({ ...prev, show: false }));
    }
  };

  const handleTemplateKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestionState.show) return;

    const filtered = TEMPLATE_VARIABLES.filter(v => 
      v.name.toLowerCase().includes(suggestionState.filter.toLowerCase())
    );

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionState(prev => ({ 
        ...prev, 
        selectedIndex: (prev.selectedIndex + 1) % (filtered.length || 1) 
      }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionState(prev => ({ 
        ...prev, 
        selectedIndex: (prev.selectedIndex - 1 + (filtered.length || 1)) % (filtered.length || 1) 
      }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered.length > 0) {
        e.preventDefault();
        insertVariableAtCursor(filtered[suggestionState.selectedIndex].name);
      }
    } else if (e.key === 'Escape') {
      setSuggestionState(prev => ({ ...prev, show: false }));
    }
  };

  const insertVariableAtCursor = (variableName: string) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    const textBeforeCursor = settings.promptTemplate.substring(0, cursor);
    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
    
    if (lastOpenBraces === -1) return;

    const textAfterCursor = settings.promptTemplate.substring(cursor);
    const insertion = `${variableName}}`;
    
    const newTemplate = settings.promptTemplate.substring(0, lastOpenBraces + 2) + insertion + textAfterCursor;
    setSettings({ ...settings, promptTemplate: newTemplate });
    
    setSuggestionState(prev => ({ ...prev, show: false }));

    setTimeout(() => {
      textarea.focus();
      const newPos = lastOpenBraces + 2 + insertion.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleSelectAll = () => {
    if (selectedFrameIds.size === frames.length) {
      setSelectedFrameIds(new Set<string>());
    } else {
      setSelectedFrameIds(new Set<string>(frames.map(f => f.id)));
    }
  };

  const handleBulkDelete = () => {
    if (window.confirm(`Delete ${selectedFrameIds.size} selected frames?`)) {
      setFrames(prev => prev.filter(f => !selectedFrameIds.has(f.id)));
      setSelectedFrameIds(new Set<string>());
    }
  };

  const handleBulkRegenerate = async () => {
    // FIX: Explicitly type idsToProcess as string[] and use spread operator for reliable inference from Set
    const idsToProcess: string[] = [...selectedFrameIds];
    if (idsToProcess.length === 0) return;
    if (!(await ensureApiKey())) return;

    setFrames(prev => prev.map(f => 
      idsToProcess.includes(f.id) 
        ? { ...f, isAnalyzing: true, error: undefined, prompt: null }
        : f
    ));
    setSelectedFrameIds(new Set<string>());

    const BATCH_SIZE = 1;
    const framesToProcess = frames.filter(f => idsToProcess.includes(f.id));

    for (let i = 0; i < framesToProcess.length; i += BATCH_SIZE) {
       const batch = framesToProcess.slice(i, i + BATCH_SIZE);
       await Promise.all(batch.map(async (frame) => {
          try {
              const { prompt, metadata } = await generateFramePrompt(frame.imageUrl, {
                customInstructions: settings.customInstructions,
                template: settings.promptTemplate,
                model: settings.xaiModel
              });
               setFrames(prev => prev.map(f => 
                f.id === frame.id 
                  ? { ...f, prompt, metadata, isAnalyzing: false } 
                  : f
              ));
          } catch (e) {
               setFrames(prev => prev.map(f => 
                f.id === frame.id 
                  ? { ...f, isAnalyzing: false, error: 'Regeneration failed' } 
                  : f
              ));
          }
       }));

       // Delay between regeneration requests
       if (i + BATCH_SIZE < framesToProcess.length) {
         await new Promise(resolve => setTimeout(resolve, 2000));
       }
    }
  };

  const handleBulkGenerateImages = async () => {
    // FIX: Explicitly type idsToProcess as string[] and use spread operator for reliable inference from Set
    const idsToProcess: string[] = [...selectedFrameIds];
    if (idsToProcess.length === 0) return;
    
    setSelectedFrameIds(new Set<string>()); // Clear selection
    await processBatchImageGeneration(idsToProcess);
  };

  const insertVariable = (variableName: string) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = settings.promptTemplate;
    const insertion = `{{${variableName}}}`;
    
    const newTemplate = text.substring(0, start) + insertion + text.substring(end);
    setSettings({ ...settings, promptTemplate: newTemplate });
    
    // Set focus back and move cursor after insertion
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insertion.length, start + insertion.length);
    }, 0);
  };

  // Sorting Logic
  const sortedFrames = useMemo(() => {
    const sorted = [...frames];
    switch (sortBy) {
      case 'time-desc':
        return sorted.sort((a, b) => b.timestamp - a.timestamp);
      case 'prompt-asc':
        return sorted.sort((a, b) => (a.prompt?.length || 0) - (b.prompt?.length || 0));
      case 'prompt-desc':
        return sorted.sort((a, b) => (b.prompt?.length || 0) - (a.prompt?.length || 0));
      case 'time-asc':
      default:
        return sorted.sort((a, b) => a.timestamp - b.timestamp);
    }
  }, [frames, sortBy]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      if (videoUrl && videoFile) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-grid">
      {/* Header - Brutalist Rail */}
      <header className="border-b border-white/10 sticky top-0 z-50 bg-black/80 backdrop-blur-md">
        <div className="max-w-[1800px] mx-auto px-6 h-20 flex items-center justify-between">
          <motion.div 
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="flex items-center gap-4"
          >
            <div className="w-10 h-10 bg-neon flex items-center justify-center rotate-3 hover:rotate-0 transition-transform cursor-pointer">
              <Clapperboard className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-white font-display uppercase">
              FRAME<span className="text-neon italic">FLOW</span>
            </h1>
          </motion.div>
          
          <div className="flex items-center gap-6">
            <AnimatePresence>
              {selectedFrameIds.size > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="hidden md:flex items-center gap-4 px-4 py-2 bg-neon/10 border border-neon/30 rounded-full"
                >
                  <span className="text-neon text-xs font-bold uppercase tracking-widest">{selectedFrameIds.size} Selected</span>
                  <div className="flex gap-2">
                    <button onClick={handleBulkRegenerate} className="hover:text-neon transition-colors"><RefreshCw className="w-4 h-4" /></button>
                    <button onClick={handleBulkGenerateImages} className="hover:text-neon transition-colors"><ImageIcon className="w-4 h-4" /></button>
                    <button onClick={handleBulkDelete} className="hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 group px-4 py-2 border transition-all duration-300 ${showSettings ? 'bg-neon border-neon text-black' : 'border-white/20 text-white/60 hover:border-neon hover:text-neon'}`}
            >
              <Settings2 className={`w-5 h-5 transition-transform duration-500 ${showSettings ? 'rotate-90' : 'group-hover:rotate-45'}`} />
              <span className="text-xs font-bold uppercase tracking-widest hidden sm:block">Config</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col relative">
        <AnimatePresence mode="wait">
          {isStoryboardMode && storyScript ? (
            <motion.div
              key="storyboard"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="p-6"
            >
              <StoryboardView 
                  frames={frames} 
                  script={storyScript} 
                  remixScript={remixStoryScript || ''}
                  onBack={() => setIsStoryboardMode(false)} 
                  remixIdea={remixIdea}
                  setRemixIdea={setRemixIdea}
                  remixScriptFile={remixScriptFile}
                  setRemixScriptFile={setRemixScriptFile}
                  onRemix={handleRemixStoryboard}
                  onRefine={handleRefineRemix}
                  isRemixing={isRemixing}
                  isRefining={isRefining}
                  onGenerateRemixImages={handleGenerateRemixImages}
                  isGeneratingRemixImages={isGeneratingRemixImages}
                  selectedFrameIds={selectedFrameIds}
                  onToggleSelect={toggleFrameSelection}
                  onSelectAll={handleSelectAll}
                  chatHistory={remixChatHistory}
              />
            </motion.div>
          ) : (
            <motion.div 
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-[1800px] mx-auto w-full flex flex-col p-6 space-y-12"
            >
              {/* Settings Panel - Brutalist Slide */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-[#0a0a0a] border-l-4 border-neon"
                  >
                    <div className="p-8 grid md:grid-cols-2 gap-12 border border-white/5">
                      <div className="space-y-8">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-neon uppercase tracking-widest flex items-center gap-2">
                             01. Sampling Interval
                          </label>
                          <div className="flex items-center gap-6">
                            <input 
                              type="range" min="1" max="10" step="1"
                              value={settings.samplingInterval}
                              onChange={(e) => setSettings({...settings, samplingInterval: parseInt(e.target.value)})}
                              className="flex-grow accent-neon"
                            />
                            <span className="text-2xl font-black font-display text-white w-16">{settings.samplingInterval}s</span>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-neon uppercase tracking-widest flex items-center gap-2">
                             02. Custom Directives
                          </label>
                          <textarea
                            className="w-full h-32 bg-transparent border border-white/10 p-4 text-sm text-white/80 focus:border-neon outline-none resize-none font-mono tracking-tight"
                            placeholder="Injection rules here..."
                            value={settings.customInstructions}
                            onChange={(e) => setSettings({...settings, customInstructions: e.target.value})}
                          />
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-neon uppercase tracking-widest flex items-center gap-2">
                             03. Grok Vision / Text Model
                          </label>
                          <input
                            type="text"
                            className="w-full bg-transparent border border-white/10 p-4 text-sm text-white/80 focus:border-neon outline-none font-mono"
                            value={settings.xaiModel}
                            onChange={(e) => setSettings({ ...settings, xaiModel: e.target.value })}
                            placeholder="grok-4.5"
                          />
                          <p className="text-[9px] text-white/30 font-mono uppercase tracking-wider">
                            Must support image understanding for frame analysis
                          </p>
                        </div>
                      </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-neon uppercase tracking-widest flex items-center gap-2">
                             04. Prompt Template Engine
                          </label>
                          <div className="border border-white/10 bg-black/40 relative">
                            <div className="flex flex-wrap gap-2 p-3 border-b border-white/10">
                              {TEMPLATE_VARIABLES.map(v => (
                                <button 
                                  key={v.name}
                                  onClick={() => insertVariable(v.name)}
                                  className="text-[9px] font-bold font-mono px-2 py-1 bg-white/5 hover:bg-neon hover:text-black transition-colors rounded uppercase"
                                >
                                  {v.name}
                                </button>
                              ))}
                            </div>
                            <textarea
                              ref={templateTextareaRef}
                              className="w-full h-40 bg-transparent p-4 text-sm font-mono text-white/70 outline-none resize-none leading-relaxed"
                              value={settings.promptTemplate}
                              onChange={handleTemplateChange}
                              onKeyDown={handleTemplateKeyDown}
                              onBlur={() => setTimeout(() => setSuggestionState(prev => ({ ...prev, show: false })), 200)}
                            />

                            {/* Auto-suggestion Dropdown */}
                            <AnimatePresence>
                              {suggestionState.show && (
                                <motion.div 
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 5 }}
                                  className="absolute z-50 left-4 top-24 w-56 bg-[#1a1a1a] border border-white/20 shadow-2xl overflow-hidden"
                                >
                                  <div className="bg-white/5 px-3 py-2 border-b border-white/10 flex items-center justify-between">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Variables</span>
                                    <Tag className="w-3 h-3 text-neon" />
                                  </div>
                                  <div className="max-h-48 overflow-y-auto scrollbar-hide">
                                    {TEMPLATE_VARIABLES.filter(v => v.name.toLowerCase().includes(suggestionState.filter.toLowerCase())).length > 0 ? (
                                      TEMPLATE_VARIABLES.filter(v => v.name.toLowerCase().includes(suggestionState.filter.toLowerCase())).map((v, idx) => (
                                        <button
                                          key={v.name}
                                          className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
                                            suggestionState.selectedIndex === idx ? 'bg-neon text-black' : 'hover:bg-white/5 text-white/70'
                                          }`}
                                          onClick={() => insertVariableAtCursor(v.name)}
                                          onMouseEnter={() => setSuggestionState(prev => ({ ...prev, selectedIndex: idx }))}
                                        >
                                          <span className="text-[10px] font-bold font-mono uppercase tracking-widest">
                                            {v.name}
                                          </span>
                                          <span className={`text-[8px] font-medium uppercase opacity-50 ${suggestionState.selectedIndex === idx ? 'text-black' : 'text-white'}`}>
                                            {v.description}
                                          </span>
                                        </button>
                                      ))
                                    ) : (
                                      <div className="px-3 py-4 text-[9px] font-mono text-white/30 text-center uppercase tracking-widest leading-loose">
                                        No variables found matching "{suggestionState.filter}"
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Upload & Dashboard Section */}
              {!videoUrl ? (
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="flex flex-col items-center justify-center py-32 space-y-12"
                >
                  <div className="text-center space-y-2">
                    <h2 className="text-7xl font-black font-display uppercase tracking-tight text-white leading-none">
                      Cinematic <span className="text-neon">Intelligence</span>
                    </h2>
                    <p className="text-white/40 font-mono text-xs uppercase tracking-[0.3em]">
                      Deconstruct video into generative architecture
                    </p>
                  </div>
                  <div className="w-full max-w-xl p-2 bg-white/5 border border-white/10 rounded-[2rem]">
                    <VideoUploader onVideoSelected={handleVideoSelected} disabled={false} />
                  </div>
                </motion.div>
              ) : (
                        <div className="grid lg:grid-cols-[1fr_460px] gap-12">
                          {/* Left Column: Results & Interactive Display */}
                          <div className="space-y-12">
                    {/* Hero Display */}
                    <div className="relative group">
                      <div className="bg-black border border-white/10 rounded-3xl overflow-hidden aspect-video shadow-2xl shadow-neon/5">
                        <video 
                          src={videoUrl} 
                          controls 
                          crossOrigin={videoUrl.startsWith('blob:') ? undefined : 'anonymous'}
                          className="w-full h-full object-contain" 
                          onError={(e) => {
                            const mediaError = e.currentTarget.error;
                            console.error("Video loading error:", {
                              code: mediaError?.code,
                              message: mediaError?.message
                            });
                            setGlobalError("Access Denied: The source server (CORS) or the video format is incompatible with analysis. Direct links to .mp4 or .mov files from open hosts work best.");
                            setStatus(AnalysisStatus.ERROR);
                          }}
                        />
                      </div>
                      
                      {status === AnalysisStatus.ERROR && (
                        <div className="mt-4 flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl min-w-0 w-full">
                          <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-1">System_Fault</div>
                            <div className="text-xs text-red-200/70 font-mono leading-relaxed mb-3 break-words whitespace-normal">
                              {globalError || "Unknown processing error"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Try_Working_Links:</span>
                              {SAMPLE_VIDEOS.slice(0, 2).map(sample => (
                                <button
                                  key={sample.name}
                                  onClick={() => handleVideoSelected(null, proxyVideoUrl(sample.url))}
                                  className="text-[9px] font-mono text-neon/60 hover:text-neon underline underline-offset-4"
                                >
                                  {sample.name === 'Bunny_Test' ? 'Sample_1' : 'Sample_2'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={handleReset}
                            className="shrink-0 w-full sm:w-auto px-6 py-3 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors rounded-xl"
                          >
                            Abort_&_Reset
                          </button>
                        </div>
                      )}

                      {status !== AnalysisStatus.ERROR && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 w-full max-w-full bg-brutal border border-white/10 p-2 rounded-2xl shadow-2xl">
                        {status === AnalysisStatus.IDLE && (
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <button
                              onClick={startAnalysis}
                              className="flex items-center gap-3 px-8 py-4 bg-neon text-black font-black uppercase tracking-tighter hover:scale-105 transition-transform"
                            >
                              <Play className="w-5 h-5 fill-current" /> Deconstruct Video
                            </button>
                            <button
                              onClick={handleReset}
                              className="p-4 text-white/40 hover:text-red-500 transition-colors border border-white/10 hover:border-red-500/30"
                              title="Clear video and go back"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                        
                        {(status === AnalysisStatus.EXTRACTING || status === AnalysisStatus.ANALYZING) && (
                          <div className="flex flex-wrap items-center justify-center gap-4 px-4 py-4 bg-white/5 min-w-0 w-full">
                            <div className="flex items-center gap-3">
                              <Loader2 className="w-5 h-5 animate-spin text-neon" />
                              <span className="text-[10px] font-black uppercase tracking-widest text-neon">
                                {status === AnalysisStatus.EXTRACTING ? 'Splitting' : 'Analyzing'}
                              </span>
                            </div>
                            <div className="w-32 sm:w-48 h-2 bg-white/10 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                className="h-full bg-neon shadow-[0_0_15px_rgba(0,255,0,0.5)]"
                              />
                            </div>
                            <span className="text-xs font-black font-mono text-white">{progress}%</span>
                          </div>
                        )}

                        {status === AnalysisStatus.COMPLETED && (
                          <div className="flex flex-wrap items-center justify-center gap-2">
                             <button
                              onClick={handleGenerateAllImages}
                              disabled={isBulkGeneratingImages}
                              className="flex items-center gap-3 px-6 py-4 bg-white text-black font-black uppercase tracking-tighter hover:bg-neon transition-colors disabled:opacity-50"
                            >
                              {isBulkGeneratingImages ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              Gen Imagery
                            </button>
                            <button
                              onClick={handleCreateStoryboard}
                              disabled={isGeneratingScript}
                              className="flex items-center gap-3 px-6 py-4 border border-white/10 text-white font-black uppercase tracking-tighter hover:bg-white/5 transition-colors"
                            >
                              {isGeneratingScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                              Build Story
                            </button>
                             <button
                               onClick={handleReset}
                               className="p-4 text-white/40 hover:text-red-500 transition-colors"
                             >
                               <Trash2 className="w-5 h-5" />
                             </button>
                          </div>
                        )}
                      </div>
                      )}
                    </div>

                    {/* Prompts Section */}
                    {frames.length > 0 && (
                      <div className="pt-12 space-y-8">
                        <div className="flex items-center justify-between border-b border-white/10 pb-6">
                           <div className="space-y-1">
                             <h3 className="text-4xl font-black font-display uppercase tracking-tight">Extracted <span className="text-neon">Assets</span></h3>
                             <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono">Temporal segmentation & descriptive logic</p>
                           </div>
                           
                           <div className="flex items-center gap-4">
                              <select 
                                value={sortBy} 
                                onChange={(e) => setSortBy(e.target.value as SortOption)}
                                className="bg-transparent border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/60 px-4 py-2 outline-none focus:border-neon transition-colors"
                              >
                                <option value="time-asc">Time 0-1</option>
                                <option value="time-desc">Time 1-0</option>
                                <option value="prompt-asc">Min Len</option>
                                <option value="prompt-desc">Max Len</option>
                              </select>
                              <button onClick={handleSelectAll} className="invisible sm:visible text-[10px] font-bold text-white/40 uppercase tracking-widest hover:text-neon transition-colors">
                                {selectedFrameIds.size === frames.length ? 'Drop All' : 'Select All'}
                              </button>
                           </div>
                        </div>

                        <motion.div 
                          layout
                          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                        >
                          {sortedFrames.map((frame, idx) => (
                            <motion.div
                              key={frame.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                            >
                              <FrameCard 
                                frame={frame} 
                                onRetry={handleRetryFrame}
                                isSelected={selectedFrameIds.has(frame.id)}
                                onToggleSelect={toggleFrameSelection}
                                onGenerateImage={handleGenerateImage}
                                onUpscaleImage={handleUpscaleImage}
                                onUpdatePrompt={handleUpdatePrompt}
                              />
                            </motion.div>
                          ))}
                        </motion.div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Console / Side Intelligence */}
                  <div className="hidden lg:block w-[460px] shrink-0">
                    <div className="sticky top-28 space-y-6">
                       {/* Integrated Intelligence Core */}
                       <div className="bg-[#080808] border border-white/10 rounded-none overflow-hidden shadow-2xl">
                          {/* Core Header */}
                          <div className="px-6 py-4 bg-white/[0.03] border-b border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 bg-neon rounded-full" />
                              <span className="text-[11px] font-black uppercase tracking-[0.4em] text-white">Analysis_Core</span>
                            </div>
                            <span className="text-[9px] font-mono text-neon/40 uppercase font-black">v1.2.0_STABLE</span>
                          </div>

                          {/* Metrics Grid - Technical & Precise */}
                          <div className="grid grid-cols-2 gap-px bg-white/5 border-b border-white/5">
                             <div className="bg-black p-6 space-y-2">
                                <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] font-black">Total_Segments</p>
                                <p className="text-4xl font-black font-display italic text-white leading-none">{frames.length}</p>
                             </div>
                             <div className="bg-black p-6 space-y-2">
                                <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] font-black">Semantic_Nodes</p>
                                <p className="text-4xl font-black font-display italic text-neon leading-none">
                                  {frames.filter(f => f.prompt).length}
                                </p>
                             </div>
                          </div>

                          {/* Operational Log */}
                          <div className="bg-black/20 px-6 py-3 border-b border-white/5 flex items-center justify-between">
                             <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">System_Activity_Log</span>
                             <div className="h-[1px] w-24 bg-white/10" />
                          </div>
                          <div className="bg-black p-6 h-[420px] overflow-y-auto space-y-4 font-mono text-[10px] leading-relaxed scrollbar-hide">
                            {[...frames].reverse().filter(f => f.prompt).slice(0, 15).map(f => (
                              <div key={f.id} className="flex gap-4 group/log">
                                <span className="text-white/10 group-hover:text-neon transition-colors">[{f.timestamp.toFixed(2)}s]</span>
                                <span className="text-white/40 group-hover:text-white/80 transition-colors uppercase tracking-widest">LOG_EXTRACTED: UNIT_{f.id.substring(0,4)}</span>
                              </div>
                            ))}
                            
                            {frames.length === 0 && !videoUrl && (
                              <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-10 py-20 text-center">
                                <Terminal className="w-12 h-12" />
                                <p className="uppercase tracking-[0.5em] text-[10px]">Awaiting Uplink Stream...</p>
                              </div>
                            )}
                          </div>

                          {/* Sub-Diagnostics */}
                          <div className="px-6 py-4 bg-white/[0.02] border-t border-white/10 grid grid-cols-2 gap-8 items-center">
                             <div className="space-y-1">
                               <div className="text-[8px] font-black uppercase text-white/20 tracking-widest">Neural_Load</div>
                               <div className="h-1 bg-white/5 rounded-none overflow-hidden">
                                 <div className="h-full w-[14%] bg-neon" />
                               </div>
                             </div>
                             <div className="space-y-1">
                               <div className="text-[8px] font-black uppercase text-white/20 tracking-widest">Cache_Status</div>
                               <div className="text-[10px] font-mono text-neon font-black">VOLATILE_OK</div>
                             </div>
                          </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {actionNotice && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed bottom-6 right-6 z-[120] max-w-sm px-4 py-3 bg-black border border-neon/40 text-[10px] font-mono uppercase tracking-widest text-neon shadow-[6px_6px_0_rgba(0,255,0,0.12)]"
          >
            {actionNotice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Menu - Simplified and brutalist */}
      <AnimatePresence>
        {!isStoryboardMode && selectedFrameIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, x: '-50%' }}
            animate={{ y: 0, x: '-50%' }}
            exit={{ y: 100, x: '-50%' }}
            className="fixed bottom-10 left-1/2 bg-black border-2 border-white p-2 rounded-none flex items-center gap-1 z-[100] shadow-[10px_10px_0_rgba(255,255,255,0.1)]"
          >
            <div className="px-4 text-[10px] font-black uppercase tracking-widest border-r border-white/20 mr-2">
              {selectedFrameIds.size} Units
            </div>
            
            <button onClick={handleBulkRegenerate} className="px-4 py-3 hover:bg-neon hover:text-black transition-all flex items-center gap-2 group">
              <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">Regen</span>
            </button>

            <button onClick={handleBulkGenerateImages} className="px-4 py-3 hover:bg-neon hover:text-black transition-all flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">Synth</span>
            </button>
            
            <button onClick={handleBulkDelete} className="px-4 py-3 hover:bg-red-500 hover:text-white transition-all transition-colors flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">Axe</span>
            </button>
            
            <button 
              onClick={() => setSelectedFrameIds(new Set<string>())} 
              className="p-3 hover:bg-white hover:text-black transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Graphic elements */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.02]">
        <div className="absolute top-0 left-10 w-[1px] h-full bg-white" />
        <div className="absolute top-0 right-10 w-[1px] h-full bg-white" />
        <div className="absolute bottom-10 left-0 w-full h-[1px] bg-white" />
      </div>
    </div>
  );
};

export default App;
