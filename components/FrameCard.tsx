import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, Loader2, RefreshCw, Image as ImageIcon, Eye, Film, Download, ChevronDown, CheckCircle, Edit2, Save, X, Sparkles, ArrowUp, Zap, Box, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { FrameData } from '../types';

interface FrameCardProps {
  frame: FrameData;
  onRetry: (frameId: string) => void;
  isSelected: boolean;
  onToggleSelect: (frameId: string) => void;
  onGenerateImage: (frameId: string, referenceImageUrl?: string) => void;
  onUpscaleImage: (frameId: string, size: "2K") => void;
  onUpdatePrompt: (frameId: string, newPrompt: string) => void;
}

type DownloadQuality = 'original' | '2K' | '4K';

const FrameCard: React.FC<FrameCardProps> = ({ 
  frame, 
  onRetry, 
  isSelected, 
  onToggleSelect,
  onGenerateImage,
  onUpscaleImage,
  onUpdatePrompt
}) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'original' | 'generated'>('original');
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  
  // Download Quality State
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>(() => {
    return (localStorage.getItem('frameflow-download-quality') as DownloadQuality) || 'original';
  });
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showUpscaleMenu, setShowUpscaleMenu] = useState(false);
  const [isProcessingDownload, setIsProcessingDownload] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const upscaleMenuRef = useRef<HTMLDivElement>(null);

  const handleQualityChange = (quality: DownloadQuality) => {
    setDownloadQuality(quality);
    localStorage.setItem('frameflow-download-quality', quality);
    setShowQualityMenu(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowQualityMenu(false);
      }
      if (upscaleMenuRef.current && !upscaleMenuRef.current.contains(event.target as Node)) {
        setShowUpscaleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = async () => {
    if (frame.prompt) {
      await navigator.clipboard.writeText(frame.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStartEdit = () => {
    setEditPrompt(frame.prompt || '');
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editPrompt?.trim() !== frame.prompt) {
      onUpdatePrompt(frame.id, editPrompt?.trim() || '');
    }
    setIsEditing(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (frame.generatedImage && !frame.isGeneratingImage && !frame.isUpscaling) {
      setViewMode('generated');
    }
  }, [frame.generatedImage, frame.isGeneratingImage, frame.isUpscaling]);

  const activeImage = viewMode === 'generated' && frame.generatedImage ? frame.generatedImage : frame.imageUrl;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessingDownload) return;
    
    setIsProcessingDownload(true);
    try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = activeImage;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const canvas = document.createElement('canvas');
        
        let targetWidth = img.width;
        let targetHeight = img.height;
        
        // Quality scaling
        if (downloadQuality === '2K') {
          const scale = 2048 / Math.max(img.width, img.height);
          if (scale > 1) { // Only scale up if requested
             targetWidth = img.width * scale;
             targetHeight = img.height * scale;
          }
        } else if (downloadQuality === '4K') {
          const scale = 4096 / Math.max(img.width, img.height);
          if (scale > 1) {
            targetWidth = img.width * scale;
            targetHeight = img.height * scale;
          }
        }

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        
        const link = document.createElement('a');
        link.href = jpgDataUrl;
        const prefix = viewMode === 'generated' ? 'ai-gen' : 'frame';
        const qualitySuffix = downloadQuality !== 'original' ? `-${downloadQuality}` : '';
        link.download = `ff-${prefix}-${Math.floor(frame.timestamp)}${qualitySuffix}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Download failed", error);
    } finally {
        setIsProcessingDownload(false);
    }
  };

  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className={`group relative flex flex-col bg-black border transition-all duration-300 h-full ${
        isSelected ? 'border-neon ring-0 shadow-[4px_4px_0_rgba(0,255,0,0.1)]' : 'border-white/10 hover:border-white/30'
      }`}
    >
      {/* Top Banner - Frame Status */}
      <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
        <div className="flex items-center gap-2">
           <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(frame.id)}
            className="w-3 h-3 accent-neon bg-black border-white/20 rounded-none cursor-pointer"
          />
          <span className="text-[9px] font-mono font-bold text-white/40 uppercase tracking-widest">
            Unit_{frame.id.substring(0, 4).toUpperCase()}
          </span>
        </div>
        <div className="text-[9px] font-mono font-bold text-neon uppercase tracking-widest bg-neon/10 px-2 py-0.5">
          {formatTime(frame.timestamp)}
        </div>
      </div>

      {/* Visual Section */}
      <div className="relative aspect-video overflow-hidden bg-black group-hover:scale-105 transition-transform duration-700">
        <motion.img 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          src={activeImage} 
          alt="Frame display"
          className="w-full h-full object-contain"
        />

        {/* Dynamic Mode Toggles */}
        <AnimatePresence>
          {frame.generatedImage && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-3 left-3 right-3 flex gap-1 p-1 bg-black/80 backdrop-blur-md rounded-none border border-white/10 z-10"
            >
              <button
                onClick={() => setViewMode('original')}
                className={`flex-1 flex items-center justify-center gap-2 py-1 text-[9px] font-black uppercase tracking-tighter transition-all ${
                  viewMode === 'original' ? 'bg-white text-black' : 'text-white/40 hover:text-white'
                }`}
              >
                <Film className="w-3 h-3" /> Raw
              </button>
              <button
                onClick={() => setViewMode('generated')}
                className={`flex-1 flex items-center justify-center gap-2 py-1 text-[9px] font-black uppercase tracking-tighter transition-all ${
                  viewMode === 'generated' ? 'bg-neon text-black' : 'text-white/40 hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" /> Synth
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading Overlays */}
        {(frame.isGeneratingImage || frame.isUpscaling || frame.isAnalyzing) && (
            <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                <div className="relative">
                   <div className="w-12 h-12 border-2 border-neon border-t-transparent rounded-full animate-spin" />
                   <Box className="w-4 h-4 text-neon absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                </div>
                <div className="mt-4 text-[9px] font-black text-neon uppercase tracking-[0.3em]">
                   {frame.isAnalyzing ? 'Decoding' : frame.isUpscaling ? 'Enhancing' : 'Synthesizing'}
                </div>
            </div>
        )}
      </div>

      {/* Narrative Section */}
      <div className="p-5 flex flex-col flex-grow bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex-grow space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5 flex-wrap">
              {frame.isEdited && (
                <div className="text-[8px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 border border-amber-500/20">Edited</div>
              )}
              {frame.generatedImage && !frame.isUpscaling && (
                <div className="text-[8px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-400/10 px-2 py-0.5 border border-indigo-400/20">HD_Asset</div>
              )}
              {frame.metadata?.shotType && (
                <div className="text-[8px] font-black uppercase tracking-widest text-neon/60 bg-neon/5 px-2 py-0.5 border border-neon/10">{frame.metadata.shotType}</div>
              )}
              {frame.metadata?.cameraAngle && (
                <div className="text-[8px] font-black uppercase tracking-widest text-white/40 bg-white/5 px-2 py-0.5 border border-white/10">{frame.metadata.cameraAngle}</div>
              )}
            </div>
            <button
               onClick={handleCopy}
               className={`p-1.5 transition-colors ${copied ? 'text-neon' : 'text-white/20 hover:text-white'}`}
            >
               {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          {isEditing ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                className="w-full h-32 bg-black border border-neon p-3 text-xs text-white/90 outline-none resize-none font-mono"
                autoFocus
              />
              <div className="flex gap-1">
                <button onClick={handleSaveEdit} className="flex-1 py-2 bg-neon text-black text-[9px] font-black uppercase">Commit</button>
                <button onClick={() => setIsEditing(false)} className="flex-1 py-2 bg-white/5 text-white/40 text-[9px] font-black uppercase">Abort</button>
              </div>
            </motion.div>
          ) : (
            <div className="relative group/prompt">
              <div className="text-xs text-white/70 font-mono leading-relaxed tracking-tight line-clamp-4 group-hover/prompt:line-clamp-none transition-all markdown-content">
                {frame.prompt ? (
                  <Markdown>{frame.prompt}</Markdown>
                ) : (
                  frame.error ? <span className="text-red-500/50 italic">Error: {frame.error}</span> : <span className="text-white/20 italic">No interpretation...</span>
                )}
              </div>
              {!frame.isAnalyzing && !frame.error && (
                <button 
                  onClick={handleStartEdit}
                  className="absolute -top-1 -right-1 p-2 bg-black opacity-0 group-hover/prompt:opacity-100 transition-opacity text-white/40 hover:text-neon"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions - Sensational Buttons */}
        {frame.prompt && !isEditing && (
          <div className="mt-6 flex flex-col gap-2">
             <div className="flex gap-2">
                {frame.generatedImage && (
                  <button
                    onClick={() => setViewMode(viewMode === 'original' ? 'generated' : 'original')}
                    className="flex-none p-3 border border-white/20 text-white hover:text-neon hover:border-neon transition-all"
                    title={viewMode === 'original' ? 'Switch to AI View' : 'Switch to Raw View'}
                  >
                    {viewMode === 'original' ? <Sparkles className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                  </button>
                )}
                <button
                  onClick={handleDownload}
                  className="flex-none p-3 border border-white/20 text-white hover:text-neon hover:border-neon transition-all"
                  title="Download JPG"
                >
                  <Download className="w-4 h-4" />
                </button>
               <button
                  onClick={() => onGenerateImage(frame.id)}
                  disabled={frame.isGeneratingImage || frame.isUpscaling}
                  className="flex-1 flex items-center justify-center gap-2 py-3 border border-white text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all disabled:opacity-30"
                >
                  {frame.generatedImage ? 'Resynth' : 'Synth Image'}
                </button>
                
                {frame.generatedImage && !frame.isUpscaling && (
                   <div className="relative" ref={upscaleMenuRef}>
                      <button
                        onClick={() => setShowUpscaleMenu(!showUpscaleMenu)}
                        className="aspect-square flex items-center justify-center border border-neon text-neon hover:bg-neon hover:text-black transition-all"
                        title="Upscale Engine"
                      >
                        <Zap className={`w-4 h-4 fill-current ${showUpscaleMenu ? 'animate-pulse' : ''}`} />
                      </button>

                      <AnimatePresence>
                        {showUpscaleMenu && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute bottom-full right-0 mb-2 w-48 bg-black border border-neon z-50 shadow-[8px_8px_0_rgba(0,255,0,0.1)] overflow-hidden"
                          >
                            <div className="bg-neon px-3 py-1.5 flex items-center justify-between">
                              <span className="text-[9px] font-black uppercase text-black">Upscale_Matrix</span>
                              <Sparkles className="w-3 h-3 text-black" />
                            </div>
                            <div className="p-1 space-y-1">
                              {(['2K'] as const).map((q) => (
                                <button
                                  key={q}
                                  onClick={() => {
                                    onUpscaleImage(frame.id, q);
                                    setShowUpscaleMenu(false);
                                  }}
                                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neon hover:text-black transition-colors group"
                                >
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest">{q} Enhancement</span>
                                    <span className="text-[8px] opacity-50 uppercase">Grok Imagine enhancement</span>
                                  </div>
                                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                   </div>
                )}
             </div>

             <div className="relative w-full" ref={menuRef}>
                <div className="flex gap-[1px] border-t border-white/5 mt-2">
                   <button
                    onClick={handleDownload}
                    className="flex-grow flex items-center justify-center gap-2 py-3 text-[8px] font-bold text-white/30 uppercase tracking-[0.3em] hover:text-white transition-colors"
                  >
                    <Download className="w-3 h-3" /> Download JPG
                  </button>
                  <button 
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="px-4 flex items-center justify-center text-white/20 hover:text-neon border-l border-white/5 transition-colors"
                  >
                    <span className="text-[7px] font-mono mr-1">{downloadQuality.toUpperCase()}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showQualityMenu ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                <AnimatePresence>
                  {showQualityMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-0 right-0 mb-1 bg-black border border-white/10 z-50 backdrop-blur-xl"
                    >
                      <div className="px-3 py-2 bg-white/5 border-b border-white/5">
                        <span className="text-[8px] font-black uppercase text-white/40 tracking-widest">Download Quality</span>
                      </div>
                      {(['original', '2K', '4K'] as const).map(q => (
                        <button
                          key={q}
                          onClick={() => handleQualityChange(q)}
                          className={`w-full text-left px-4 py-2 text-[9px] font-bold uppercase tracking-widest flex items-center justify-between hover:bg-white/5 ${downloadQuality === q ? 'text-neon' : 'text-white/60'}`}
                        >
                          {q}
                          {downloadQuality === q && <CheckCircle className="w-3 h-3" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
          </div>
        )}

        {frame.error && (
          <button 
            onClick={() => onRetry(frame.id)}
            className="w-full py-4 border border-red-500/30 text-[9px] font-black uppercase text-red-500 hover:bg-red-500/10 transition-colors mt-4"
          >
            Reconnect Vision Engine
          </button>
        )}
      </div>

      {/* Decorative Index */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rotate-90 text-[8px] font-mono text-white/5 uppercase tracking-widest pointer-events-none">
        0x{frame.id.substring(0, 4)}
      </div>
    </motion.div>
  );
};

export default FrameCard;
