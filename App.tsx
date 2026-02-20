import React, { useState, useEffect, useRef } from 'react';
import { Upload, Music, Download, Wand2, AudioWaveform, Loader2, Sliders, FileText, Image as ImageIcon, PlayCircle, Video, Copy, ExternalLink, Trash2, RefreshCw, CloudRain, X } from 'lucide-react';
import { AudioTrack, MergeStatus, AiMetadata } from './types';
import { TrackList } from './components/TrackList';
import { mergeAudioTracks, calculateOptimalVolume } from './services/audioService';
import { generateMixMetadata, regenerateMixText, regenerateMixImage } from './services/geminiService';
import { SOUND_TYPES, SoundType, generateSoundEffect } from './services/soundGenerator';

const App: React.FC = () => {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [status, setStatus] = useState<MergeStatus>(MergeStatus.IDLE);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AiMetadata | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isRegeneratingText, setIsRegeneratingText] = useState(false);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [analyzingTrackId, setAnalyzingTrackId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  
  // Ambient Effect Modal State
  const [showEffectModal, setShowEffectModal] = useState(false);
  const [selectedEffect, setSelectedEffect] = useState<SoundType>('rain_light');
  const [effectDuration, setEffectDuration] = useState<number>(60);
  const [isGeneratingEffect, setIsGeneratingEffect] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
     // Cleanup preview audio when modal closes or component unmounts
     return () => {
        if (previewAudioRef.current) {
           previewAudioRef.current.pause();
           previewAudioRef.current = null;
        }
     };
  }, [showEffectModal]);

  const handlePreviewEffect = async () => {
     if (isPlayingPreview) {
        if (previewAudioRef.current) {
           previewAudioRef.current.pause();
           previewAudioRef.current = null;
        }
        setIsPlayingPreview(false);
        return;
     }

     setIsPlayingPreview(true);
     try {
        // Generate a short 5-second preview
        const file = await generateSoundEffect(selectedEffect, 5);
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        
        audio.onended = () => {
           setIsPlayingPreview(false);
           URL.revokeObjectURL(url);
        };
        
        audio.onerror = () => {
           setIsPlayingPreview(false);
           URL.revokeObjectURL(url);
           console.error("Error playing preview");
        };

        audio.play();
        previewAudioRef.current = audio;
     } catch (e) {
        console.error("Failed to generate preview", e);
        setIsPlayingPreview(false);
     }
  };

  // Crossfade state (default 3 seconds)
  const [crossfade, setCrossfade] = useState<number>(3);

  // Cleanup preview URL on unmount or when it changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      addFilesToTracks(files);
    }
  };

  const addFilesToTracks = (files: File[]) => {
      const newTracks: AudioTrack[] = files.map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        name: file.name,
        duration: 0,
        volume: 1.0 // Default volume
      }));
      
      setTracks(prev => [...prev, ...newTracks]);
      
      // Reset state on new upload
      setMergedBlob(null);
      setPreviewUrl(null);
      setStatus(MergeStatus.IDLE);
      setProgress(0);

      // Calculate duration for each track asynchronously
      newTracks.forEach(async (track) => {
        try {
          const duration = await new Promise<number>((resolve) => {
            const audio = new Audio(URL.createObjectURL(track.file));
            audio.onloadedmetadata = () => {
              URL.revokeObjectURL(audio.src);
              resolve(audio.duration);
            };
            audio.onerror = () => {
              URL.revokeObjectURL(audio.src);
              resolve(0);
            };
          });
          
          setTracks(prev => prev.map(t => t.id === track.id ? { ...t, duration } : t));
        } catch (error) {
          console.error("Error calculating duration", error);
        }
      });
  };

  const handleAddEffect = async () => {
      setIsGeneratingEffect(true);
      try {
          const file = await generateSoundEffect(selectedEffect, effectDuration);
          addFilesToTracks([file]);
          setShowEffectModal(false);
      } catch (e) {
          console.error("Failed to generate effect", e);
          setErrorMsg("Errore nella generazione dell'effetto audio.");
      } finally {
          setIsGeneratingEffect(false);
      }
  };

  const removeTrack = (id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
    // Reset merge status if tracks change
    if (status === MergeStatus.COMPLETED) {
        setStatus(MergeStatus.IDLE);
        setMergedBlob(null);
        setPreviewUrl(null);
        setProgress(0);
    }
  };
  
  const clearAllTracks = () => {
      if (confirm('Sei sicuro di voler rimuovere tutte le tracce?')) {
          setTracks([]);
          setMergedBlob(null);
          setPreviewUrl(null);
          setStatus(MergeStatus.IDLE);
          setAiMetadata(null);
          setErrorMsg(null);
          setProgress(0);
      }
  };

  const updateTrackVolume = (id: string, volume: number) => {
      setTracks(prev => prev.map(t => t.id === id ? { ...t, volume } : t));
      // Invalidate current mix if volumes change
      if (status === MergeStatus.COMPLETED) {
          setStatus(MergeStatus.IDLE);
          setMergedBlob(null);
          setPreviewUrl(null);
      }
  };

  const handleAutoLevel = async (track: AudioTrack) => {
      setAnalyzingTrackId(track.id);
      try {
          const optimalVolume = await calculateOptimalVolume(track.file);
          updateTrackVolume(track.id, optimalVolume);
      } catch (e) {
          console.error("Auto level failed", e);
      } finally {
          setAnalyzingTrackId(null);
      }
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    setTracks(prev => {
      const newTracks = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      [newTracks[index], newTracks[targetIndex]] = [newTracks[targetIndex], newTracks[index]];
      return newTracks;
    });
  };

  const handleMerge = async () => {
    if (tracks.length < 2) {
      setErrorMsg("Seleziona almeno 2 file da unire.");
      return;
    }
    
    // Create controller BEFORE setting status to ensure it's ready
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setErrorMsg(null);
    setStatus(MergeStatus.PROCESSING);
    setProgress(0);
    
    try {
      const blob = await mergeAudioTracks(tracks, crossfade, (percent) => {
          setProgress(Math.round(percent));
      }, controller.signal);
      
      setMergedBlob(blob);
      
      // Create preview URL
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      
      setStatus(MergeStatus.COMPLETED);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Operation cancelled') {
          console.log("Merge cancelled by user");
          setStatus(MergeStatus.IDLE);
          setProgress(0);
      } else {
          console.error("Merge error:", err);
          setErrorMsg("Errore durante l'unione: " + (err.message || "Errore sconosciuto"));
          setStatus(MergeStatus.ERROR);
      }
    } finally {
        abortControllerRef.current = null;
    }
  };

  const handleCancel = (e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      setShowCancelModal(true);
  };

  const confirmCancel = () => {
      if (abortControllerRef.current) {
          console.log("Aborting operation via modal...");
          abortControllerRef.current.abort();
      }
      setShowCancelModal(false);
  };

  const handleAiGeneration = async () => {
    if (tracks.length === 0) return;
    setIsAiLoading(true);
    try {
      const names = tracks.map(t => t.name);
      const metadata = await generateMixMetadata(names);
      setAiMetadata(metadata);
    } catch (err) {
      console.error("AI Generation failed", err);
      // Don't block UI, just log
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleRegenerateText = async () => {
    if (tracks.length === 0) return;
    setIsRegeneratingText(true);
    try {
      const names = tracks.map(t => t.name);
      const newTextData = await regenerateMixText(names);
      
      setAiMetadata(prev => prev ? {
        ...prev,
        title: newTextData.title,
        description: newTextData.description,
        videoSearchPrompt: newTextData.videoSearchPrompt,
        coverArtPrompt: newTextData.coverArtPrompt // Update prompt for future image gen
      } : newTextData);
    } catch (err) {
      console.error("Text Regeneration failed", err);
    } finally {
      setIsRegeneratingText(false);
    }
  };

  const handleRegenerateImage = async () => {
    if (!aiMetadata?.coverArtPrompt) return;
    setIsRegeneratingImage(true);
    try {
      const base64 = await regenerateMixImage(aiMetadata.coverArtPrompt);
      if (base64) {
        setAiMetadata(prev => prev ? { ...prev, coverImageBase64: base64 } : null);
      }
    } catch (err) {
      console.error("Image Regeneration failed", err);
    } finally {
      setIsRegeneratingImage(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    if (!mergedBlob) return;
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = aiMetadata?.title ? `${aiMetadata.title}.mp3` : 'merged-audio.mp3';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Calculate estimates
  const estimates = React.useMemo(() => {
    if (tracks.length === 0) return { duration: 0, size: 0 };
    
    const totalRawDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const overlaps = Math.max(0, tracks.length - 1);
    const totalOverlapDuration = overlaps * crossfade;
    const finalDuration = Math.max(0, totalRawDuration - totalOverlapDuration);
    
    // 128kbps = 16KB/s
    const sizeBytes = finalDuration * 16000;
    const sizeMB = sizeBytes / (1024 * 1024);
    
    return {
      duration: finalDuration,
      size: sizeMB
    };
  }, [tracks, crossfade]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <header className="mb-10 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/20">
              <AudioWaveform size={40} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 mb-2">
            AudioFusion IT
          </h1>
          <p className="text-slate-400 text-lg">
            Unisci i tuoi file MP3 in un'unica traccia perfetta
          </p>
        </header>

        {/* Main Interface */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
          
          {/* Upload Area */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1 border-2 border-dashed border-slate-600 rounded-xl p-8 text-center hover:border-indigo-500 hover:bg-slate-800 transition-all group cursor-pointer">
              <input 
                type="file" 
                multiple 
                accept=".mp3,audio/mpeg" 
                onChange={handleFileUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center pointer-events-none">
                <div className="p-3 bg-slate-700 rounded-full text-slate-300 mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <Upload size={24} />
                </div>
                <p className="text-lg font-medium text-slate-200">
                  Clicca o trascina i file MP3 qui
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Supporta file MP3 multipli
                </p>
              </div>
            </div>

            <button 
              onClick={() => setShowEffectModal(true)}
              className="flex-shrink-0 md:w-48 border-2 border-dashed border-slate-600 rounded-xl p-4 flex flex-col items-center justify-center hover:border-emerald-500 hover:bg-slate-800 transition-all group"
            >
               <div className="p-3 bg-slate-700 rounded-full text-slate-300 mb-2 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <CloudRain size={24} />
               </div>
               <span className="font-medium text-slate-200">Aggiungi Effetto</span>
               <span className="text-xs text-slate-500 mt-1">Pioggia, Tuoni, ecc.</span>
            </button>
          </div>

          {/* Cancel Confirmation Modal */}
          {showCancelModal && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
                   <div className="flex justify-center mb-4">
                      <div className="p-3 bg-red-900/30 rounded-full text-red-400">
                         <X size={32} />
                      </div>
                   </div>
                   <h3 className="text-xl font-bold text-white mb-2">Annullare l'elaborazione?</h3>
                   <p className="text-slate-400 mb-6">
                      Sei sicuro di voler interrompere l'unione dei file? Il progresso attuale andrà perso.
                   </p>
                   
                   <div className="flex gap-3">
                      <button
                         onClick={() => setShowCancelModal(false)}
                         className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
                      >
                         No, continua
                      </button>
                      <button
                         onClick={confirmCancel}
                         className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl transition-colors"
                      >
                         Sì, annulla
                      </button>
                   </div>
                </div>
             </div>
          )}

          {/* Effect Modal */}
          {showEffectModal && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                   <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                         <CloudRain size={20} className="text-emerald-400" />
                         Genera Effetto Ambiente
                      </h3>
                      <button onClick={() => setShowEffectModal(false)} className="text-slate-400 hover:text-white">
                         <X size={20} />
                      </button>
                   </div>
                   
                   <div className="space-y-4">
                      <div>
                         <label className="block text-sm font-medium text-slate-300 mb-1">Tipo di Suono</label>
                         <div className="flex gap-2">
                            <select 
                               value={selectedEffect}
                               onChange={(e) => setSelectedEffect(e.target.value as SoundType)}
                               className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                            >
                               {SOUND_TYPES.map(type => (
                                  <option key={type.id} value={type.id}>{type.label}</option>
                               ))}
                            </select>
                            <button
                               onClick={handlePreviewEffect}
                               className={`p-2.5 rounded-lg border transition-colors ${isPlayingPreview ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                               title={isPlayingPreview ? "Stop Anteprima" : "Ascolta Anteprima (5s)"}
                            >
                               {isPlayingPreview ? <Loader2 className="animate-spin" size={20} /> : <PlayCircle size={20} />}
                            </button>
                         </div>
                      </div>
                      
                      <div>
                         <label className="block text-sm font-medium text-slate-300 mb-1">Durata (secondi)</label>
                         <div className="flex items-center gap-3">
                            <input 
                               type="range" 
                               min="10" 
                               max="300" 
                               step="10"
                               value={effectDuration}
                               onChange={(e) => setEffectDuration(parseInt(e.target.value))}
                               className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                            <span className="text-sm font-mono text-emerald-400 w-12 text-right">{effectDuration}s</span>
                         </div>
                      </div>

                      <button
                         onClick={handleAddEffect}
                         disabled={isGeneratingEffect}
                         className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                         {isGeneratingEffect ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
                         {isGeneratingEffect ? 'Generazione...' : 'Aggiungi alla Playlist'}
                      </button>
                   </div>
                </div>
             </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-800 text-red-300 rounded-lg text-sm text-center">
              {errorMsg}
            </div>
          )}

          {/* Track List Header Actions */}
          {tracks.length > 0 && (
              <div className="flex justify-end mt-6 -mb-4">
                  <button 
                    onClick={clearAllTracks}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 hover:underline px-2"
                  >
                      <Trash2 size={12} /> Svuota tutto
                  </button>
              </div>
          )}

          {/* Track List */}
          <TrackList 
            tracks={tracks} 
            onRemove={removeTrack} 
            onMove={moveTrack} 
            onVolumeChange={updateTrackVolume}
            onAutoLevel={handleAutoLevel}
            analyzingTrackId={analyzingTrackId}
          />

          {/* Mix Controls (Crossfade) */}
          {tracks.length > 1 && (
             <div className="mt-8 p-5 bg-slate-800 rounded-xl border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                   <div className="flex items-center gap-2">
                      <Sliders size={20} className="text-indigo-400"/>
                      <span className="font-semibold text-slate-200">Mix & Sfumatura</span>
                   </div>
                   <span className="text-sm font-mono text-indigo-300 bg-indigo-900/40 px-2 py-1 rounded">
                      {crossfade} secondi
                   </span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="12" 
                  step="0.5"
                  value={crossfade}
                  onChange={(e) => setCrossfade(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <p className="text-xs text-slate-400 mt-2">
                   Regola la sovrapposizione tra le tracce. Un valore più alto crea una transizione più dolce.
                </p>
                
                {/* Estimates Display */}
                <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between items-center text-sm">
                    <div className="text-slate-400">
                        Stima finale:
                    </div>
                    <div className="flex gap-4 font-mono text-slate-200">
                        <span>
                            ⏱️ {formatDuration(estimates.duration)}
                        </span>
                        <span>
                            💾 ~{estimates.size.toFixed(2)} MB
                        </span>
                    </div>
                </div>
             </div>
          )}

          {/* AI Magic Section - Only show if tracks exist */}
          {tracks.length > 0 && (
            <div className="mt-6 p-4 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
               <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-300">
                    <Wand2 size={20} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-indigo-100">AI Assistant</h4>
                    <p className="text-xs text-indigo-300">Genera titolo YouTube, copertina 16:9 e SEO</p>
                  </div>
               </div>
               <button 
                onClick={handleAiGeneration}
                disabled={isAiLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {isAiLoading ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                 {isAiLoading ? 'Generando...' : 'Genera con AI'}
               </button>
            </div>
          )}

          {/* AI Result Display */}
          {aiMetadata && (
             <div className="mt-6 bg-slate-800/80 p-6 rounded-xl border border-indigo-500/30 relative overflow-hidden">
                {/* Background glow effect */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                <div className="flex flex-col md:flex-row gap-6 relative z-10">
                  <div className="flex-shrink-0 flex flex-col gap-2">
                    {aiMetadata.coverImageBase64 ? (
                      <div className="group relative w-full md:w-72 md:aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-700 shadow-xl">
                          <img 
                            src={`data:image/jpeg;base64,${aiMetadata.coverImageBase64}`} 
                            alt="Cover Art" 
                            className={`w-full h-full object-cover transition-opacity ${isRegeneratingImage ? 'opacity-50' : 'opacity-100'}`}
                          />
                          {isRegeneratingImage && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                  <Loader2 className="animate-spin text-white" size={32} />
                              </div>
                          )}
                          
                          {/* Overlay buttons */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = `data:image/jpeg;base64,${aiMetadata.coverImageBase64}`;
                                  link.download = `${aiMetadata.title.replace(/[^a-z0-9]/gi, '_')}_thumbnail.jpg`;
                                  link.click();
                                }}
                                className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white backdrop-blur-sm transition-colors"
                                title="Scarica immagine"
                              >
                                 <Download size={20} />
                              </button>
                              
                              <button
                                onClick={handleRegenerateImage}
                                disabled={isRegeneratingImage}
                                className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white backdrop-blur-sm transition-colors"
                                title="Rigenera immagine"
                              >
                                 <RefreshCw size={20} className={isRegeneratingImage ? 'animate-spin' : ''} />
                              </button>
                          </div>
                      </div>
                    ) : (
                       <div className="w-full md:w-72 md:aspect-video bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center">
                          {isRegeneratingImage ? <Loader2 className="animate-spin text-slate-400" /> : <ImageIcon className="text-slate-600" size={32} />}
                       </div>
                    )}
                    
                    {/* Explicit Regenerate Button if overlay is missed */}
                    <button 
                       onClick={handleRegenerateImage}
                       disabled={isRegeneratingImage || !aiMetadata.coverArtPrompt}
                       className="md:hidden w-full py-2 bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 rounded flex items-center justify-center gap-2"
                    >
                       <RefreshCw size={12} className={isRegeneratingImage ? 'animate-spin' : ''} />
                       Rigenera Copertina
                    </button>
                  </div>
                  
                  <div className="flex flex-col justify-between flex-grow min-w-0">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                           <div className="flex items-center gap-2">
                             <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">AI GENERATED</span>
                           </div>
                           <button 
                             onClick={handleRegenerateText}
                             disabled={isRegeneratingText}
                             className="text-xs text-indigo-300 hover:text-white flex items-center gap-1.5 transition-colors px-2 py-1 rounded hover:bg-indigo-500/20"
                           >
                             <RefreshCw size={12} className={isRegeneratingText ? 'animate-spin' : ''} />
                             Rigenera Testi
                           </button>
                        </div>
                        
                        {isRegeneratingText ? (
                          <div className="animate-pulse space-y-3 mb-4">
                             <div className="h-8 bg-slate-700 rounded w-3/4"></div>
                             <div className="h-4 bg-slate-700 rounded w-full"></div>
                             <div className="h-4 bg-slate-700 rounded w-5/6"></div>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-2xl font-bold text-white mb-2 leading-tight">{aiMetadata.title}</h3>
                            <p className="text-slate-300 text-sm leading-relaxed mb-4 whitespace-pre-line">{aiMetadata.description}</p>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        {aiMetadata.coverImageBase64 && (
                          <button
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = `data:image/jpeg;base64,${aiMetadata.coverImageBase64}`;
                              link.download = `${aiMetadata.title.replace(/[^a-z0-9]/gi, '_')}_thumbnail.jpg`;
                              link.click();
                            }}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 border border-slate-600"
                          >
                            <ImageIcon size={14} />
                            Scarica Thumbnail (16:9)
                          </button>
                        )}
                        
                        <button
                          onClick={() => {
                            const text = `Titolo: ${aiMetadata.title}\n\nDescrizione:\n${aiMetadata.description}\n\nVideo Background Search:\n${aiMetadata.videoSearchPrompt || ''}`;
                            const blob = new Blob([text], { type: 'text/plain' });
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `${aiMetadata.title.replace(/[^a-z0-9]/gi, '_')}_info.txt`;
                            link.click();
                          }}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 border border-slate-600"
                        >
                          <FileText size={14} />
                          Scarica Info
                        </button>
                      </div>

                      {/* Video Prompt Section */}
                      {aiMetadata.videoSearchPrompt && !isRegeneratingText && (
                        <div className="mt-4 pt-4 border-t border-slate-700/50">
                          <div className="flex items-center gap-2 mb-2">
                             <Video size={16} className="text-indigo-400" />
                             <span className="text-xs font-semibold text-slate-400 uppercase">Suggerimento Video Background</span>
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                             <div className="flex-1 bg-slate-900/60 border border-slate-700 rounded px-3 py-2 text-sm text-slate-300 font-mono truncate min-w-0">
                                {aiMetadata.videoSearchPrompt}
                             </div>
                             <button 
                                onClick={() => copyToClipboard(aiMetadata.videoSearchPrompt || '')} 
                                className={`p-2 rounded flex-shrink-0 transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`} 
                                title="Copia prompt"
                             >
                                <Copy size={16} />
                             </button>
                             <a 
                                href={`https://www.pexels.com/search/videos/${aiMetadata.videoSearchPrompt}`} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors flex-shrink-0" 
                                title="Cerca su Pexels"
                             >
                                <ExternalLink size={16} />
                             </a>
                          </div>
                        </div>
                      )}

                  </div>
                </div>
             </div>
          )}

          {/* Action Buttons & Preview */}
          <div className="mt-8">
            
            {/* Audio Preview Player */}
            {status === MergeStatus.COMPLETED && previewUrl && (
              <div className="mb-6 p-4 bg-slate-900 rounded-xl border border-slate-700 flex flex-col gap-3">
                 <div className="flex items-center gap-2 text-emerald-400 mb-1">
                    <PlayCircle size={20} />
                    <span className="font-semibold text-sm">Anteprima Risultato</span>
                 </div>
                 <audio 
                    controls 
                    src={previewUrl} 
                    className="w-full h-10 block rounded-lg mix-blend-screen"
                    style={{ filter: "invert(1) hue-rotate(180deg)" }} 
                 />
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-end items-center">
              
              {/* Progress Bar (Visible during processing) */}
              {status === MergeStatus.PROCESSING && (
                <div className="flex-1 w-full mr-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Elaborazione in corso...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300 ease-out" 
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={(e) => {
                    if (status === MergeStatus.PROCESSING) {
                        handleCancel(e);
                    } else {
                        handleMerge();
                    }
                }}
                disabled={tracks.length < 2}
                className={`flex-1 sm:flex-none px-6 py-3 rounded-xl font-semibold flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  status === MergeStatus.PROCESSING
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                }`}
              >
                {status === MergeStatus.PROCESSING ? (
                  <>
                    <X size={20} />
                    <span>Annulla ({progress}%)</span>
                  </>
                ) : (
                  <>
                    <Music size={20} />
                    <span>Unisci {tracks.length} Tracce</span>
                  </>
                )}
              </button>

              {status === MergeStatus.COMPLETED && (
                <button
                  onClick={downloadFile}
                  className="flex-1 sm:flex-none px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20 transition-all"
                >
                  <Download size={20} />
                  <span>Scarica MP3</span>
                </button>
              )}
            </div>
          </div>
          
          {status === MergeStatus.COMPLETED && (
             <p className="mt-3 text-center text-sm text-emerald-400">
                Processo completato con successo! Ascolta l'anteprima o scarica il file.
             </p>
          )}

        </div>
        
        <p className="mt-8 text-center text-slate-600 text-sm">
           Elaborazione audio locale sicura. I tuoi file non lasciano il tuo dispositivo per l'unione.
           <br/>
           L'assistente AI richiede l'accesso API per generare metadati.
        </p>
      </div>
    </div>
  );
};

export default App;
