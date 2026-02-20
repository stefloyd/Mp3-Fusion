import { AudioTrack } from '../types';

// Worker code as a string to avoid external file dependencies in this environment
const WORKER_CODE = `
importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');

self.onmessage = function(e) {
  const { channelData, sampleRate } = e.data;
  
  // Stereo assumed
  const left = channelData[0];
  const right = channelData[1] || channelData[0]; // Fallback to mono if needed
  
  const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, 128); // 128kbps
  const samplesLeft = new Int16Array(left.length);
  const samplesRight = new Int16Array(right.length);
  
  // Convert Float32 to Int16
  for (let i = 0; i < left.length; i++) {
    samplesLeft[i] = Math.max(-1, Math.min(1, left[i])) * 32767;
    samplesRight[i] = Math.max(-1, Math.min(1, right[i])) * 32767;
  }
  
  const mp3Data = [];
  const sampleBlockSize = 1152;
  const totalSamples = samplesLeft.length;
  
  for (let i = 0; i < totalSamples; i += sampleBlockSize) {
    const leftChunk = samplesLeft.subarray(i, i + sampleBlockSize);
    const rightChunk = samplesRight.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
    
    // Report progress every ~50 chunks to avoid flooding the main thread
    if (i % (sampleBlockSize * 50) === 0) {
      self.postMessage({ 
        type: 'progress', 
        progress: i / totalSamples 
      });
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }
  
  self.postMessage({ type: 'done', mp3Data });
};
`;

/**
 * Calculates the optimal volume gain to normalize the track to a target RMS.
 * Target RMS of 0.15 is a reasonable standard for mixed audio.
 */
export const calculateOptimalVolume = async (file: File, targetRms: number = 0.15): Promise<number> => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContext();
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // Analyze the first channel (mono analysis is usually sufficient for gain matching)
    const data = audioBuffer.getChannelData(0);
    
    // Calculate RMS (Root Mean Square)
    let sum = 0;
    // Optimization: Sample every 4th point to speed up large files without losing much accuracy
    const step = 4; 
    for(let i = 0; i < data.length; i += step) {
        sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / (data.length / step));
    
    if (rms === 0) return 1.0;
    
    // Calculate gain needed to reach target
    const optimalGain = targetRms / rms;
    
    // Clamp values to avoid extreme boosting of silence or noise (max 300%, min 10%)
    return Math.min(Math.max(optimalGain, 0.1), 3.0);
  } catch (e) {
    console.error("Error calculating RMS", e);
    return 1.0;
  } finally {
    audioCtx.close();
  }
};

export const mergeAudioTracks = async (
  tracks: AudioTrack[], 
  crossfadeDuration: number = 0,
  onProgress?: (percentage: number) => void,
  signal?: AbortSignal
): Promise<Blob> => {
  if (tracks.length === 0) throw new Error("No tracks to merge");

  const updateProgress = (p: number) => {
    if (onProgress) onProgress(Math.min(100, Math.max(0, p)));
  };

  updateProgress(1); // Start

  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContext();

  // 1. Decode all files (0% - 30%)
  const audioBuffers: AudioBuffer[] = [];
  for (let i = 0; i < tracks.length; i++) {
    if (signal?.aborted) {
        audioCtx.close();
        throw new DOMException("Operation cancelled", "AbortError");
    }

    const track = tracks[i];
    const arrayBuffer = await track.file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioBuffers.push(audioBuffer);
    
    // Update progress based on how many tracks decoded
    const progressStep = 30 / tracks.length;
    updateProgress(1 + (i + 1) * progressStep);
  }

  if (signal?.aborted) {
    audioCtx.close();
    throw new DOMException("Operation cancelled", "AbortError");
  }

  // 2. Calculate total duration with overlap
  const totalRawDuration = audioBuffers.reduce((acc, buf) => acc + buf.duration, 0);
  const totalOverlap = Math.max(0, (audioBuffers.length - 1) * crossfadeDuration);
  const finalDuration = Math.max(totalRawDuration - totalOverlap, 1); 
  
  const sampleRate = 44100;

  // 3. Create OfflineContext & Setup Graph (30% - 35%)
  updateProgress(32);
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * finalDuration), sampleRate);
  
  let currentStartTime = 0;

  audioBuffers.forEach((buffer, index) => {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    const gainNode = offlineCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    
    const trackVolume = tracks[index].volume ?? 1.0;
    const actualFade = Math.min(crossfadeDuration, buffer.duration / 2);

    if (index > 0 && actualFade > 0) {
      gainNode.gain.setValueAtTime(0, currentStartTime);
      gainNode.gain.linearRampToValueAtTime(trackVolume, currentStartTime + actualFade);
    } else {
      gainNode.gain.setValueAtTime(trackVolume, currentStartTime);
    }

    if (index < audioBuffers.length - 1 && actualFade > 0) {
      const fadeOutStart = currentStartTime + buffer.duration - actualFade;
      const fadeOutEnd = currentStartTime + buffer.duration;
      gainNode.gain.setValueAtTime(trackVolume, fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, fadeOutEnd);
    } else {
      gainNode.gain.setValueAtTime(trackVolume, currentStartTime + actualFade); 
    }

    source.start(currentStartTime);
    currentStartTime += (buffer.duration - crossfadeDuration);
    if (currentStartTime < 0) currentStartTime = 0; 
  });

  // 4. Render Audio (35% - 50%)
  // Rendering is blocking/async in one go, so we jump to 50% when done
  updateProgress(35);
  
  if (signal?.aborted) {
    audioCtx.close();
    throw new DOMException("Operation cancelled", "AbortError");
  }

  const renderedBuffer = await offlineCtx.startRendering();
  updateProgress(50);

  if (signal?.aborted) {
    audioCtx.close();
    throw new DOMException("Operation cancelled", "AbortError");
  }

  // 5. Encode to MP3 using Worker (50% - 100%)
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      if (signal) {
        signal.addEventListener('abort', () => {
            worker.terminate();
            audioCtx.close();
            reject(new DOMException("Operation cancelled", "AbortError"));
        });
      }

      worker.onmessage = (e) => {
        const { type, mp3Data, progress } = e.data;
        
        if (type === 'progress') {
            // Map 0-1 from worker to 50-100 for overall progress
            updateProgress(50 + (progress * 50));
        } else if (type === 'done') {
            const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
            updateProgress(100);
            resolve(mp3Blob);
            worker.terminate();
            audioCtx.close();
        }
      };

      worker.onerror = (e) => {
        reject(new Error("Encoding failed: " + e.message));
        worker.terminate();
        audioCtx.close();
      };

      const channels = [];
      for (let i = 0; i < renderedBuffer.numberOfChannels; i++) {
        channels.push(renderedBuffer.getChannelData(i));
      }

      worker.postMessage({
        channelData: channels,
        sampleRate: renderedBuffer.sampleRate
      });

    } catch (err) {
      reject(err);
      audioCtx.close();
    }
  });
};
