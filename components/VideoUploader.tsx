import React, { useRef, useState } from 'react';
import { Upload, Link, AlertCircle, Terminal, Zap, ShieldAlert, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface VideoUploaderProps {
  onVideoSelected: (file: File | null, url: string | null) => void;
  disabled: boolean;
}

const VideoUploader: React.FC<VideoUploaderProps> = ({ onVideoSelected, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const SAMPLES = [
    { name: 'Bunny_Test', url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    { name: 'YouTube_Sample', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
    { name: 'Vimeo_Sample', url: 'https://vimeo.com/76979871' }
  ];

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError("FILE_REJECTION: System requires raw video streams (MP4/WEBM/MOV).");
      return;
    }
    setError(null);
    onVideoSelected(file, null);
  };

  const handleUrlSubmit = async (overrideUrl?: string) => {
    let url = (overrideUrl || inputUrl)?.trim();
    if (!url) return;

    setIsVerifying(true);
    setError(null);

    // Auto-prepend protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const lowerUrl = url.toLowerCase();
    
    // Validation for search result pages which aren't videos
    if (lowerUrl.includes('youtube.com/results') || lowerUrl.includes('vimeo.com/search')) {
        setError("SOURCE_ERR: Search results provided. Please provide a direct link to a SPECIFIC video.");
        setIsVerifying(false);
        return;
    }

    const hasVideoExtension = /\.(mp4|mov|webm|mkv|m4v|avi|3gp)($|\?)/i.test(lowerUrl);

    // Instead of blocking, we'll try to resolve via our proxy
    const finalUrl = `/api/video-proxy?url=${encodeURIComponent(url)}`;

    try {
      new URL(url);
    } catch (e) {
      setError("MALFORMED_URL: Please provide a valid protocol and domain (e.g., https://example.com/video.mp4).");
      setIsVerifying(false);
      return;
    }

    setIsVerifying(false);
    onVideoSelected(null, finalUrl);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-12">
      {/* Narrative Header */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 text-white/20"
      >
        <Terminal className="w-4 h-4" />
        <div className="h-[1px] flex-grow bg-white/5" />
        <span className="text-[10px] font-black uppercase tracking-[0.4em]">Initialize_Input_Stream</span>
      </motion.div>

      {/* Main Dropzone */}
      <motion.div 
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={`relative group border-[3px] border-dashed transition-all duration-500 overflow-hidden ${
          dragActive ? 'border-neon bg-neon/5' : 'border-white/10 hover:border-white/30'
        } ${disabled ? 'opacity-20 pointer-events-none' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          accept="video/*" 
          onChange={handleChange}
          disabled={disabled}
        />
        
        <div className="flex flex-col items-center gap-6 p-16 relative z-10">
           <AnimatePresence mode="wait">
             {dragActive ? (
                <motion.div 
                  key="drag"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1.5 }}
                  exit={{ scale: 0 }}
                  className="text-neon"
                >
                   <Zap className="w-12 h-12 fill-current" />
                </motion.div>
             ) : (
                <motion.div 
                  key="idle"
                  className="w-16 h-16 bg-white/5 rounded-none flex items-center justify-center border border-white/10 transition-colors group-hover:bg-neon group-hover:border-neon group-hover:text-black"
                >
                  <Upload className="w-8 h-8" />
                </motion.div>
             )}
           </AnimatePresence>

          <div className="text-center space-y-2">
            <h3 className="text-2xl font-anton text-white uppercase tracking-tight">Drop Local Media</h3>
            <p className="text-[10px] font-black font-mono text-white/30 uppercase tracking-widest group-hover:text-white/60 transition-colors">
              Standard Bitrate / MP4 / WEBM / HEVC
            </p>
          </div>
        </div>

        {/* Decorative Grid */}
        <div className="absolute inset-0 pointer-events-none opacity-5">
           <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        </div>
      </motion.div>

      {/* URL Integration */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
           <div className="h-[1px] flex-grow bg-white/5" />
           <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.5em]">Network_Path</span>
           <div className="h-[1px] flex-grow bg-white/5" />
        </div>

        <div className={`flex gap-3 h-14 ${disabled ? 'opacity-20 pointer-events-none' : ''}`}>
          <div className="relative flex-grow h-full bg-black border border-white/10 focus-within:border-white transition-colors">
            <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input
              type="text"
              className="w-full h-full pl-12 pr-4 bg-transparent text-sm font-mono text-white outline-none placeholder:text-white/30"
              placeholder="HTTPS_SOURCE_URL..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            />
          </div>
          <button
            onClick={() => handleUrlSubmit()}
            disabled={isVerifying}
            className="px-8 h-full bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-neon transition-colors active:translate-y-1 shrink-0 disabled:opacity-50"
          >
            {isVerifying ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Fetch_File'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
           <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mr-2">Try_Samples:</span>
           {SAMPLES.map(sample => (
             <button
               key={sample.name}
               onClick={() => handleUrlSubmit(sample.url)}
               className="px-3 py-1 bg-white/5 border border-white/10 text-[9px] font-mono text-white/40 hover:text-white hover:border-white/30 transition-all rounded-full"
             >
               {sample.name}
             </button>
           ))}
        </div>
        
        <div className="flex items-start gap-3 px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl">
           <Zap className="w-3.5 h-3.5 text-neon mt-0.5 shrink-0" />
           <div className="space-y-1">
             <p className="text-[10px] font-black font-mono text-white uppercase tracking-widest">
               Neural_Proxy_Active
             </p>
             <p className="text-[9px] font-mono text-white/40 uppercase tracking-widest leading-relaxed">
               YouTube & Vimeo links are proxied through our vision engine. Ensure content is public.
             </p>
           </div>
        </div>
      </div>

      {/* Error & Warning Terminal */}
      <AnimatePresence>
        {error ? (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 p-4 border border-red-500/30 bg-red-500/5 text-red-500 text-[10px] font-mono leading-relaxed">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 bg-white/[0.01] border border-white/5 rounded-2xl space-y-4"
          >
            <div className="flex items-center gap-3 text-white/40 pb-2 border-b border-white/5">
               <AlertCircle className="w-3.5 h-3.5" />
               <span className="font-black tracking-[0.2em] text-[10px] uppercase">Engine_Protocols</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[9px] font-mono text-white/30 uppercase leading-loose">
              <div className="space-y-1">
                <p className="text-white/50 font-black">CORS_BYPASS</p>
                <p>Proxy resolves platform links. Direct files still preferred.</p>
              </div>
              <div className="space-y-1">
                <p className="text-white/50 font-black">EXTRACTION_LATENCY</p>
                <p>Large files (&gt;100MB) may experience buffer delays.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VideoUploader;