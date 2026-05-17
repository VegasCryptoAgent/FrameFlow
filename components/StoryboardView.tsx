import React, { useState, useRef } from 'react';
import { ArrowLeft, Printer, Clock, FileText, Image as ImageIcon, Download, Loader2, Sparkles, Film, RefreshCw, CheckSquare, Square, Zap, Layers, Share2, CornerRightDown, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { FrameData } from '../types';

interface StoryboardViewProps {
  frames: FrameData[];
  script: string;
  remixScript: string;
  onBack: () => void;
  remixIdea: string;
  setRemixIdea: (idea: string) => void;
  remixScriptFile: File | null;
  setRemixScriptFile: (file: File | null) => void;
  onRemix: () => void;
  onRefine: (feedback: string) => void;
  isRemixing: boolean;
  isRefining: boolean;
  onGenerateRemixImages: () => void;
  isGeneratingRemixImages: boolean;
  selectedFrameIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  chatHistory: {role: 'user' | 'assistant', content: string}[];
}

const StoryboardView: React.FC<StoryboardViewProps> = ({ 
  frames, 
  script, 
  remixScript,
  onBack,
  remixIdea,
  setRemixIdea,
  remixScriptFile,
  setRemixScriptFile,
  onRemix,
  onRefine,
  isRemixing,
  isRefining,
  onGenerateRemixImages,
  isGeneratingRemixImages,
  selectedFrameIds,
  onToggleSelect,
  onSelectAll,
  chatHistory
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [viewMode, setViewMode] = useState<'original' | 'remix' | 'comparison'>('original');
  const [refineFeedback, setRefineFeedback] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll chat
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = () => {
    if (!contentRef.current) return;
    
    setIsExporting(true);

    setTimeout(() => {
        const element = contentRef.current;
        const opt = {
            margin: [0.3, 0.3],
            filename: 'ff-storyboard.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2, 
                useCORS: true, 
                scrollY: 0,
                onclone: (clonedDoc: Document) => {
                    // html2canvas 1.x doesn't support modern color functions like oklab/oklch used by Tailwind v4
                    // We inject a style override to force standard colors for the export
                    const style = clonedDoc.createElement('style');
                    style.innerHTML = `
                        /* Global reset for modern color space features that crash html2canvas */
                        * {
                            color-interpolation-filters: sRGB !important;
                        }
                        
                        /* Force standard color overrides for elements during export */
                        .bg-white { background-color: #ffffff !important; }
                        .text-black { color: #000000 !important; }
                        .bg-black { background-color: #000000 !important; }
                        .text-white { color: #ffffff !important; }
                        .text-neon { color: #00ff00 !important; }
                        .bg-neon { background-color: #00ff00 !important; }
                        
                        /* Sanitize any modern color functions in existing style tags */
                        /* (This still works for dev mode style tags) */
                    `;
                    clonedDoc.head.appendChild(style);

                    const styles = clonedDoc.getElementsByTagName('style');
                    for (let i = 0; i < styles.length; i++) {
                        let css = styles[i].innerHTML;
                        if (css.includes('oklch') || css.includes('oklab') || css.includes('color-mix')) {
                            css = css.replace(/(oklch|oklab|color-mix)\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/g, '#888888');
                            styles[i].innerHTML = css;
                        }
                    }

                    // Handle inline styles
                    const elementsWithStyle = clonedDoc.querySelectorAll('[style]');
                    elementsWithStyle.forEach(el => {
                        let style = el.getAttribute('style') || '';
                        if (style.includes('oklch') || style.includes('oklab') || style.includes('color-mix')) {
                            style = style.replace(/(oklch|oklab|color-mix)\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/g, '#888888');
                            el.setAttribute('style', style);
                        }
                    });

                    // Force specific elements to be readable if they rely on problematic classes
                    const narrative = clonedDoc.querySelector('.font-syne');
                    if (narrative) (narrative as HTMLElement).style.color = '#000000';
                }
            },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        // @ts-ignore
        if (window.html2pdf) {
            // @ts-ignore
            window.html2pdf().set(opt).from(element).save().then(() => {
                setIsExporting(false);
            }).catch((err: any) => {
                console.error("PDF Export failed", err);
                setIsExporting(false);
            });
        } else {
            setIsExporting(false);
            alert("Library not found. Try Printing.");
        }
    }, 100);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 md:p-10 space-y-12 animate-fadeIn pb-32 ${isExporting ? 'bg-white text-black' : ''}`}>
      
      {/* Top Controller */}
      {!isExporting && (
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky top-24 z-50 flex flex-col md:flex-row gap-4 items-center justify-between p-4 bg-black border border-white/20 shadow-[8px_8px_0_rgba(255,255,255,0.05)]"
          data-html2canvas-ignore
        >
          <div className="flex items-center gap-6">
            <button 
              onClick={onBack}
              className="group flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              Return
            </button>
            <div className="h-4 w-[1px] bg-white/10 hidden md:block" />
            <div className="flex bg-white/5 p-1">
              <button 
                onClick={() => setViewMode('original')}
                className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-tighter transition-all ${viewMode === 'original' ? 'bg-neon text-black' : 'text-white/40 hover:text-white'}`}
              >
                Native
              </button>
              <button 
                onClick={() => setViewMode('remix')}
                className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-tighter transition-all ${viewMode === 'remix' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
              >
                Remix
              </button>
              <button 
                onClick={() => setViewMode('comparison')}
                className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-tighter transition-all ${viewMode === 'comparison' ? 'bg-neon text-black border-l border-black/10' : 'text-white/40 hover:text-white border-l border-white/5'}`}
              >
                Split
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={handleExportPDF}
              disabled={isExporting}
              className="px-6 py-2 bg-black border border-white text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all flex items-center gap-2"
            >
              {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
              Export Asset
            </button>
            <button 
              onClick={handlePrint}
              className="p-2 border border-white/10 text-white/40 hover:text-white transition-colors"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* Main Board */}
      <div ref={contentRef} className="space-y-40 relative">
        
         {/* Floating Progress Tracker - Cinematic Rail */}
         {!isExporting && (
           <div className="fixed left-6 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col gap-6 items-center">
              <div className="w-[1px] h-32 bg-gradient-to-t from-neon to-transparent" />
              {sortedFrames.map((_, i) => (
                <div key={i} className="group relative flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white/10 rounded-full group-hover:bg-neon transition-colors" />
                  <span className="absolute left-6 text-[8px] font-black text-white/0 group-hover:text-white/40 transition-all uppercase tracking-widest whitespace-nowrap">Beat_{i+1}</span>
                </div>
              ))}
              <div className="w-[1px] h-32 bg-gradient-to-b from-neon to-transparent" />
           </div>
         )}
        
        {/* Remix Interaction Wing */}
        {!isExporting && viewMode === 'remix' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-10 bg-black border-[4px] border-white shadow-[16px_16px_0_rgba(255,255,255,0.05)] space-y-8 relative overflow-hidden"
            data-html2canvas-ignore
          >
             <div className="absolute top-0 right-0 p-4 opacity-5">
                <Zap className="w-48 h-48 rotate-12" />
             </div>

             <div className="flex items-center gap-4 relative z-10">
               <div className="w-12 h-12 bg-white flex items-center justify-center text-black">
                 <Zap className="w-6 h-6 fill-current" />
               </div>
               <div className="flex flex-col">
                 <h2 className="text-4xl font-anton uppercase tracking-tighter leading-none">Hyper-Remix Engine</h2>
                 <span className="text-[10px] font-black text-neon uppercase tracking-[0.4em] mt-1">Experimental Narrative Mutation</span>
               </div>
             </div>

             <div className="grid lg:grid-cols-[1fr_300px] gap-10 relative z-10">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Scenario_Seed_Input</label>
                      <div className="h-[1px] flex-grow mx-4 bg-white/5" />
                    </div>
                    <textarea 
                      placeholder="Describe the mutation... (e.g. Cyberpunk Noir, Wes Anderson, Horror)"
                      value={remixIdea}
                      onChange={(e) => setRemixIdea(e.target.value)}
                      className="w-full h-40 bg-white/2 border border-white/10 p-6 text-base font-mono text-white outline-none focus:border-neon transition-all focus:bg-white/5"
                    />
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                     <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-4 border border-dashed border-white/20 text-[10px] font-black uppercase tracking-widest hover:border-white transition-colors flex items-center justify-center gap-2"
                     >
                       <FileText className="w-4 h-4" />
                       {remixScriptFile ? remixScriptFile.name : 'UPLOAD_BLUEPRINT_SCRIPT'}
                     </button>
                     <input type="file" ref={fileInputRef} onChange={(e) => setRemixScriptFile(e.target.files?.[0] || null)} hidden accept=".pdf,.txt" />
                  </div>
                </div>

                <div className="flex flex-col gap-4 justify-start">
                   <button
                      onClick={onRemix}
                      disabled={isRemixing || (!remixIdea?.trim() && !remixScriptFile)}
                      className="w-full py-10 bg-neon text-black text-sm font-black uppercase tracking-[0.4em] hover:scale-[1.02] active:scale-95 transition-all shadow-[8px_8px_0_rgba(0,255,0,0.2)] disabled:opacity-20"
                   >
                     {isRemixing ? 'REMIXING...' : 'MUTATE_NOW'}
                   </button>
                   {frames.some(f => f.remixPrompt && !f.remixImage) && (
                      <button
                        onClick={onGenerateRemixImages}
                        disabled={isGeneratingRemixImages}
                        className="w-full py-5 border-[3px] border-white text-white text-[10px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all"
                      >
                         {isGeneratingRemixImages ? 'RENDERING...' : 'SYNTHESIZE_VISUALS'}
                      </button>
                   )}
                </div>
             </div>
          </motion.div>
        )}

        {/* Narrative / Script Display - Editorial Style */}
        <div className="relative group">
          <div className="absolute -top-12 -left-12 text-[120px] font-anton text-white/[0.03] select-none pointer-events-none uppercase">
            Story
          </div>
          
          <div className="grid lg:grid-cols-[1fr_350px] gap-16 items-start">
            <div className="relative p-12 bg-black border-l-[8px] border-white shadow-2xl">
              <div className="absolute -top-4 -right-4 bg-white p-3 text-black">
                 <FileText className="w-6 h-6" />
              </div>
              
              <h3 className="text-[12px] font-black uppercase tracking-[0.6em] text-white/20 mb-12 flex items-center gap-4">
                 Narrative_Log <div className="h-[1px] flex-grow bg-white/5" />
              </h3>
              
              <div className="markdown-content">
                <Markdown>
                  {viewMode === 'remix' ? (remixScript || 'SYSTEM_WAITING: Pending synthesis input...') : script}
                </Markdown>
              </div>

              {!isExporting && viewMode === 'remix' && remixScript && (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="mt-16 pt-12 border-t border-white/10 space-y-8"
                 >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-neon">
                         <Zap className={`w-4 h-4 ${isRefining ? 'animate-pulse' : ''}`} />
                         <span className="text-[11px] font-black uppercase tracking-[0.5em]">Neural_Proxy_Chat</span>
                      </div>
                      <div className="text-[8px] font-mono text-white/20 uppercase">Connected_Session</div>
                    </div>

                    {/* Chat History Thread */}
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-4 scrollbar-hide flex flex-col">
                          {[...chatHistory].map((msg, i) => (
                            <motion.div 
                              key={i}
                              initial={{ opacity: 0, x: msg.role === 'user' ? 10 : -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                               <div className={`max-w-[85%] p-4 ${
                                 msg.role === 'user' 
                                   ? 'bg-neon/10 border border-neon/30 text-neon' 
                                   : 'bg-white/5 border border-white/10 text-white/80'
                               } rounded-none font-mono text-xs leading-relaxed shadow-xl`}>
                                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/5">
                                     <span className="text-[8px] font-black uppercase tracking-widest opacity-40">
                                       {msg.role === 'user' ? 'Director_Input' : 'AI_Synthesizer'}
                                     </span>
                                     <span className="text-[8px] opacity-20">TRANSMISSION_{i.toString().padStart(3, '0')}</span>
                                  </div>
                                  <div className="whitespace-pre-wrap">{msg.content}</div>
                               </div>
                            </motion.div>
                          ))}
                          <div ref={chatEndRef} />
                          {chatHistory.length === 0 && (
                            <div className="py-20 text-center space-y-4 opacity-10">
                              <BookOpen className="w-12 h-12 mx-auto" />
                              <p className="text-[10px] font-black uppercase tracking-[0.4em]">Awaiting direct manipulation instructions...</p>
                            </div>
                          )}
                    </div>

                    <div className="relative group">
                       <div className="absolute -inset-1 bg-neon/10 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                       <div className="relative flex gap-3 bg-black border border-white/20 p-2">
                          <input 
                            type="text"
                            value={refineFeedback}
                            onChange={(e) => setRefineFeedback(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && refineFeedback.trim() && !isRefining) {
                                onRefine(refineFeedback);
                                setRefineFeedback('');
                              }
                            }}
                            placeholder="DIRECTOR_NOTES: Instruct changes to script & shot list..."
                            className="flex-grow bg-transparent px-4 py-3 text-sm font-mono text-white outline-none placeholder:text-white/20"
                          />
                          <button 
                            onClick={() => {
                               if (refineFeedback.trim() && !isRefining) {
                                 onRefine(refineFeedback);
                                 setRefineFeedback('');
                               }
                            }}
                            disabled={isRefining || !refineFeedback.trim()}
                            className="px-8 bg-neon text-black text-[11px] font-black uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-20 flex items-center gap-3 shrink-0"
                          >
                             {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : 'TRANSMIT'}
                          </button>
                       </div>
                    </div>
                 </motion.div>
              )}
            </div>

            <div className="space-y-12 py-6">
               <div className="space-y-4">
                 <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Continuity_Matrix</span>
                 <div className="grid grid-cols-2 gap-4">
                   <div className="p-4 border border-white/10 rounded-none">
                      <span className="block text-2xl font-anton text-white">0{sortedFrames.length}</span>
                      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Total_Beats</span>
                   </div>
                   <div className="p-4 border border-white/10 rounded-none">
                      <span className="block text-2xl font-anton text-white">{viewMode.toUpperCase()}</span>
                      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Profile_Version</span>
                   </div>
                 </div>
               </div>

               <div className="p-8 border border-white/10 bg-white/[0.01] relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <BookOpen className="w-12 h-12" />
                  </div>
                  <p className="text-xs font-mono text-white/40 uppercase leading-relaxed tracking-tight">
                    Each shot is a discrete logic unit within the temporal architecture. 
                    Synthesized imagery maintains visual coherence across frames.
                  </p>
               </div>
            </div>
          </div>
        </div>

        {/* Shot Sequence - Alternating Editorial Layout */}
        <div className="space-y-40 relative">
          {/* Temporal Anchor Line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-gradient-to-b from-white/20 via-white/5 to-transparent hidden xl:block -translate-x-1/2 z-0" />

          <div className="flex items-center justify-between border-b-[4px] border-white pb-10 relative z-10">
            <div className="flex items-center gap-8">
              <div className="w-14 h-14 bg-neon text-black flex items-center justify-center rotate-3">
                <Layers className="w-7 h-7" />
              </div>
              <div className="flex flex-col relative">
                <div className="absolute -top-3 -right-6 animate-pulse px-1.5 py-0.5 bg-red-600 text-white text-[7px] font-black uppercase tracking-widest">Live_Seq</div>
                <h3 className="text-5xl font-anton uppercase tracking-tighter leading-none">
                  Visual_Matrix <span className="text-white/20">v2.1</span>
                </h3>
                <span className="text-[10px] font-black font-mono text-neon uppercase tracking-[0.5em] mt-2">Sequential Asset Processing Unit</span>
              </div>
            </div>
            
            {!isExporting && (
              <button 
                onClick={onSelectAll}
                className="group flex items-center gap-4 text-[11px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all bg-white/5 px-6 py-3 border border-white/10 hover:border-neon"
              >
                <div className={`transition-colors ${selectedFrameIds.size === frames.length ? 'text-neon' : 'text-white/20'}`}>
                   {selectedFrameIds.size === frames.length ? <CheckSquare className="w-4 h-4 text-neon" /> : <Square className="w-4 h-4" />}
                </div>
                Toggle_Universal_Sync
              </button>
            )}
          </div>

          <div className="space-y-64 relative">
            {sortedFrames.map((frame, index) => {
              const isRemix = viewMode === 'remix';
              const isComparison = viewMode === 'comparison';
              const displayImage = isRemix ? (frame.remixImage || frame.imageUrl) : (frame.generatedImage || frame.imageUrl);
              const isAiImage = isRemix ? !!frame.remixImage : !!frame.generatedImage;
              const displayPrompt = isRemix ? (frame.remixPrompt || 'REMIX_STATUS: Log entry missing...') : frame.prompt;
              const isGenerating = isRemix ? frame.isGeneratingRemixImage : frame.isGeneratingImage;
              const isSelected = selectedFrameIds.has(frame.id);

              const isEven = index % 2 === 0;

              return (
                <div key={frame.id} className="space-y-16 group/scene px-4 md:px-0">
                  {/* Scene Separator Rule - Magazine Flush */}
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b-2 border-white pb-6 relative z-10 transition-colors group-hover/scene:border-neon">
                    <div className="flex items-baseline gap-6">
                      <span className="text-6xl font-anton text-white tracking-widest leading-none">
                        S{(index + 1).toString().padStart(2, '0')}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.5em] text-white/40">Sequence_ID</span>
                        <span className="text-xs font-mono text-neon font-black uppercase tracking-widest leading-none">Beat_Transmission_{formatTime(frame.timestamp).replace(':', '_')}</span>
                      </div>
                    </div>
                    <div className="flex gap-10 text-[9px] font-black uppercase tracking-[0.3em] text-white/30 font-mono">
                      <div className="flex flex-col items-end">
                        <span className="text-white/10 italic font-black uppercase">Reference</span>
                        <span>{frame.id.substring(0, 8)}</span>
                      </div>
                      <div className="flex flex-col items-end border-l border-white/10 pl-6">
                        <span className="text-white/10 italic font-black uppercase">Temporal</span>
                        <span>0:00:00:{(index * 24).toString().padStart(2, '0')}</span>
                      </div>
                    </div>
                  </div>

                  <motion.div 
                    initial={{ opacity: 0, y: 60 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex flex-col xl:flex-row gap-16 items-center xl:items-start group relative ${
                      isEven ? '' : 'xl:flex-row-reverse'
                    } ${isSelected ? 'opacity-100' : 'opacity-20 hover:opacity-100 transition-opacity duration-700'}`}
                  >
                    {/* Visual Node - Cinematic Reveal */}
                    <div className={`w-full ${isComparison ? 'xl:w-full' : 'xl:w-[60%]'} relative`}>
                      <div className={`bg-black p-1 border border-white/5 group-hover:border-neon/50 transition-all duration-1000 relative overflow-hidden shadow-2xl ${isComparison ? 'grid grid-cols-2 gap-px' : ''}`}>
                         {isComparison ? (
                           <>
                             {/* Original Side */}
                             <div className="aspect-video relative overflow-hidden bg-neutral-900 border-r border-white/10">
                                <img src={frame.generatedImage || frame.imageUrl} className="w-full h-full object-cover" alt="Original" referrerPolicy="no-referrer" />
                                <div className="absolute top-4 left-4 bg-black/80 px-2 py-1 text-[8px] font-black uppercase text-white/40">NATIVE_SOURCE</div>
                             </div>
                             {/* Remix Side */}
                             <div className="aspect-video relative overflow-hidden bg-neutral-900">
                                {frame.isGeneratingRemixImage ? (
                                  <div className="w-full h-full flex items-center justify-center bg-black">
                                     <Loader2 className="w-6 h-6 animate-spin text-neon" />
                                  </div>
                                ) : (
                                  <img src={frame.remixImage || frame.imageUrl} className="w-full h-full object-cover" alt="Remix" referrerPolicy="no-referrer" />
                                )}
                                <div className="absolute top-4 right-4 bg-neon/80 px-2 py-1 text-[8px] font-black uppercase text-black">SYNTH_REMIX</div>
                             </div>
                           </>
                         ) : (
                           <div className="aspect-video bg-neutral-900 flex items-center justify-center relative z-10 overflow-hidden">
                              {/* Cinematic Texture Overlays */}
                              <div className="absolute inset-0 pointer-events-none z-20 opacity-20 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
                              <div className="absolute inset-0 pointer-events-none z-20 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

                              {isGenerating ? (
                                 <div className="w-full h-full flex flex-col items-center justify-center bg-black/95">
                                    <div className="w-16 h-16 border-2 border-neon border-t-white/10 rounded-full animate-spin mb-8" />
                                    <span className="text-[11px] font-black uppercase tracking-[0.6em] text-neon animate-pulse">Scanning_Spatial_Parameters...</span>
                                 </div>
                              ) : (
                                 <div className="relative w-full h-full overflow-hidden group-hover:scale-[1.01] transition-transform duration-[3s] ease-out">
                                   <img 
                                     src={displayImage} 
                                     className="w-full h-full object-contain"
                                     alt="Temporal Frame"
                                     referrerPolicy="no-referrer"
                                   />
                                   {/* Scanline Effect */}
                                   <div className="absolute inset-x-0 h-[1000%] top-[-450%] bg-[linear-gradient(to_bottom,transparent_0%,rgba(255,255,255,0.02)_50%,transparent_100%)] bg-[length:100%_4px] animate-[scanline_20s_linear_infinite] pointer-events-none" />
                                 </div>
                              )}
                           </div>
                         )}

                        {/* Technical Overlays */}
                        {!isComparison && (
                          <div className={`absolute top-6 ${isEven ? 'right-6' : 'left-6'} z-20 flex flex-col gap-2`}>
                            <div className="bg-black/60 backdrop-blur-xl px-4 py-2 border border-white/10 text-[9px] font-black uppercase tracking-widest flex items-center gap-3">
                              <div className="w-1.5 h-1.5 bg-neon rounded-full animate-pulse" />
                              {isAiImage ? 'Synthetic' : 'Feed'}
                            </div>
                          </div>
                        )}

                        {/* Perspective Overlay - Magazine Grid */}
                        <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                           <div className="flex gap-2">
                              <div className="w-4 h-4 border-l border-b border-white/40" />
                              <div className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Safe_Zone_Active</div>
                              {frame.metadata?.shotType && (
                                <div className="text-[8px] font-mono text-neon uppercase tracking-[0.2em]">{frame.metadata.shotType}</div>
                              )}
                           </div>
                           <div className="flex items-center gap-4">
                              {frame.metadata?.cameraAngle && (
                                <div className="text-[8px] font-mono text-white/40 uppercase tracking-[0.2em]">{frame.metadata.cameraAngle}</div>
                              )}
                              <div className="w-4 h-4 border-r border-b border-white/40" />
                           </div>
                        </div>
                      </div>
                    </div>

                    {/* Content Node - Technical Ledger */}
                    <div className={`w-full ${isComparison ? 'xl:w-full' : 'xl:w-[40%]'} space-y-10 py-4 relative z-10 ${isEven ? 'xl:pl-12' : 'xl:pr-12'}`}>
                       <div className={`flex items-center gap-6 ${isEven ? '' : 'xl:flex-row-reverse'}`}>
                          <div className="flex flex-col">
                             <h4 className="text-5xl font-anton text-white tracking-[0.1em] leading-none mb-2">VISION_{ (index + 1).toString().padStart(2, '0') }</h4>
                             <div className="flex items-center gap-3">
                               <div className="h-[1px] w-12 bg-neon" />
                               <span className="text-[9px] font-black text-neon uppercase tracking-[0.6em]">Manifest_Output</span>
                             </div>
                          </div>
                          <div className="flex-grow" />
                          {!isExporting && (
                            <button 
                              onClick={() => onToggleSelect(frame.id)}
                              className={`p-4 transition-all duration-500 rounded-none ${isSelected ? 'bg-neon text-black border-neon' : 'bg-white/5 text-white/20 hover:text-white border border-white/10 hover:border-white'}`}
                            >
                               <CheckSquare className="w-6 h-6" />
                            </button>
                          )}
                       </div>

                       {/* The Ledger - Magazine Containment */}
                       <div className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-10 group/ledger border-l border-white/5 pl-8">
                          <div className="col-span-2 space-y-4">
                             <div className="flex items-center gap-3">
                               <div className="w-1.5 h-1.5 bg-white/20 rotate-45" />
                               <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30">Primary_Directive</span>
                             </div>
                             <p className="text-xl md:text-2xl font-syne font-medium italic leading-[1.3] text-white/90 tracking-tight">
                                "{displayPrompt}"
                             </p>
                          </div>
                          
                          {isRemix && frame.prompt && (
                             <div className="col-span-2 p-6 bg-white/[0.02] border border-white/5 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-3 opacity-10">
                                  <RefreshCw className="w-10 h-10 -rotate-12" />
                                </div>
                                <div className="flex items-center gap-3 mb-4">
                                   <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Source_DNA_Reference</span>
                                   <div className="h-[1px] flex-grow bg-white/5" />
                                </div>
                                <p className="text-xs font-mono text-white/20 italic leading-relaxed">
                                  {frame.prompt}
                                </p>
                             </div>
                          )}

                          <div className="space-y-4">
                             <div className="text-[8px] font-black uppercase tracking-[0.3em] text-white/20">Lens_Profile</div>
                             <div className="font-mono text-[10px] text-white/60">
                                {frame.metadata?.shotType ? `${frame.metadata.shotType.toUpperCase().replace(/\s/g, '_')}_OPTIC` : '35MM_PRIME_v2'}
                             </div>
                          </div>
                          <div className="space-y-4 border-l border-white/5 pl-8">
                             <div className="text-[8px] font-black uppercase tracking-[0.3em] text-white/20">Color_Space</div>
                             <div className="font-mono text-[10px] text-neon uppercase">
                                {frame.metadata?.lighting || 'STUDIO_BALANCED'}
                             </div>
                          </div>
                       </div>

                       <div className="pt-6 flex items-center gap-6 opacity-20 group-hover:opacity-100 transition-opacity">
                         <div className="text-[8px] font-black uppercase tracking-[0.5em] text-white/40">Technical_Spec_A41_0</div>
                         <div className="h-[1px] flex-grow bg-white/5" />
                         <div className="flex gap-3">
                           <div className="w-1.5 h-1.5 border border-white/20" />
                           <div className="w-1.5 h-1.5 border border-white/20" />
                           <div className="w-1.5 h-1.5 bg-neon" />
                         </div>
                       </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Index */}
        <div className="py-32 border-t border-white/5 flex flex-col items-center text-center space-y-8">
           <div className="relative">
             <Share2 className="w-12 h-12 text-white/5" />
             <div className="absolute inset-0 animate-ping bg-neon/10 rounded-full" />
           </div>
           <div className="space-y-2">
             <div className="text-[11px] font-black uppercase tracking-[1em] text-white/10">
                End_Of_Transmission
             </div>
             <div className="text-[8px] font-mono text-white/5 uppercase tracking-[0.4em]">
                {new Date().toISOString()} // LOG_CLOSED
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default StoryboardView;