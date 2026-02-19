import React from 'react';
import { AudioTrack } from '../types';
import { Trash2, GripVertical, Music, ArrowUp, ArrowDown, Volume2, VolumeX, Wand2, Loader2 } from 'lucide-react';

interface TrackListProps {
  tracks: AudioTrack[];
  onRemove: (id: string) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onVolumeChange: (id: string, volume: number) => void;
  onAutoLevel: (track: AudioTrack) => void;
  analyzingTrackId: string | null;
}

const formatDuration = (seconds?: number) => {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const TrackList: React.FC<TrackListProps> = ({ tracks, onRemove, onMove, onVolumeChange, onAutoLevel, analyzingTrackId }) => {
  if (tracks.length === 0) return null;

  return (
    <div className="w-full space-y-2 mt-6">
      <h3 className="text-lg font-semibold text-slate-200 mb-3 flex justify-between items-center">
        <span>Tracce Selezionate ({tracks.length})</span>
      </h3>
      <div className="space-y-2">
        {tracks.map((track, index) => (
          <div 
            key={track.id} 
            className="group flex flex-col md:flex-row items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded-lg hover:border-indigo-500 transition-colors gap-3"
          >
            {/* Left: Drag, Icon, Name */}
            <div className="flex items-center space-x-3 w-full md:w-auto overflow-hidden">
              <div className="cursor-grab text-slate-500 hover:text-slate-300 flex-shrink-0">
                <GripVertical size={20} />
              </div>
              <div className="p-2 bg-indigo-900/50 rounded-full text-indigo-400 flex-shrink-0">
                <Music size={18} />
              </div>
              <div className="truncate min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">
                  {track.file.name}
                </p>
                <div className="flex items-center space-x-2 text-xs text-slate-400">
                   <span>{formatDuration(track.duration)}</span>
                   <span>•</span>
                   <span>{(track.file.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>
            </div>

            {/* Middle: Volume Control */}
            <div className="flex items-center space-x-2 w-full md:w-56 px-2 md:px-4 border-t md:border-t-0 md:border-l border-slate-700 pt-2 md:pt-0">
                
                {/* Auto Level Button */}
                <button
                   onClick={() => onAutoLevel(track)}
                   disabled={analyzingTrackId === track.id}
                   className={`p-1.5 rounded transition-all ${
                       analyzingTrackId === track.id 
                       ? 'text-indigo-400 bg-indigo-900/20' 
                       : 'text-indigo-400 hover:text-white hover:bg-indigo-600'
                   }`}
                   title="Normalizza volume automaticamente"
                >
                    {analyzingTrackId === track.id ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Wand2 size={16} />
                    )}
                </button>

                <button 
                  onClick={() => onVolumeChange(track.id, track.volume === 0 ? 1 : 0)}
                  className="text-slate-400 hover:text-white"
                  title={track.volume === 0 ? "Riattiva audio" : "Silenzia"}
                >
                  {track.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={track.volume}
                  onChange={(e) => onVolumeChange(track.id, parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                />
                <span className="text-xs font-mono text-slate-400 w-9 text-right">
                  {Math.round(track.volume * 100)}%
                </span>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center space-x-1 flex-shrink-0 ml-auto md:ml-0">
              <button 
                onClick={() => onMove(index, 'up')}
                disabled={index === 0}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 hover:bg-slate-700 rounded"
                title="Sposta su"
              >
                <ArrowUp size={16} />
              </button>
              <button 
                onClick={() => onMove(index, 'down')}
                disabled={index === tracks.length - 1}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 hover:bg-slate-700 rounded"
                title="Sposta giù"
              >
                <ArrowDown size={16} />
              </button>
              <button 
                onClick={() => onRemove(track.id)}
                className="ml-2 p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                title="Rimuovi"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};