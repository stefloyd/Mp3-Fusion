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
  
  for (let i = 0; i < samplesLeft.length; i += sampleBlockSize) {
    const leftChunk = samplesLeft.subarray(i, i + sampleBlockSize);
    const rightChunk = samplesRight.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }
  
  self.postMessage({ mp3Data });
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

export const mergeAudioTracks = async (tracks: AudioTrack[], crossfadeDuration: number = 0): Promise<Blob> => {
  if (tracks.length === 0) throw new Error("No tracks to merge");

  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContext();

  // 1. Decode all files
  const audioBuffers: AudioBuffer[] = [];
  for (const track of tracks) {
    const arrayBuffer = await track.file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioBuffers.push(audioBuffer);
  }

  // 2. Calculate total duration with overlap
  // Total = Sum(Durations) - (Count-1 * Crossfade)
  const totalRawDuration = audioBuffers.reduce((acc, buf) => acc + buf.duration, 0);
  const totalOverlap = Math.max(0, (audioBuffers.length - 1) * crossfadeDuration);
  const finalDuration = Math.max(totalRawDuration - totalOverlap, 1); // Ensure at least 1s
  
  const sampleRate = 44100;

  // 3. Create OfflineContext
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * finalDuration), sampleRate);
  
  let currentStartTime = 0;

  audioBuffers.forEach((buffer, index) => {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    // Create a GainNode for volume automation (fading)
    const gainNode = offlineCtx.createGain();
    
    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    
    // Get the volume for this specific track (default to 1 if undefined)
    const trackVolume = tracks[index].volume ?? 1.0;

    // Determine actual fade duration for this specific track
    // (cannot be longer than half the track to avoid conflict between fade-in and fade-out)
    const actualFade = Math.min(crossfadeDuration, buffer.duration / 2);

    // Apply Fade In (if not the first track)
    if (index > 0 && actualFade > 0) {
      gainNode.gain.setValueAtTime(0, currentStartTime);
      // Ramp to the specific track volume, not just 1
      gainNode.gain.linearRampToValueAtTime(trackVolume, currentStartTime + actualFade);
    } else {
      // Start at track volume
      gainNode.gain.setValueAtTime(trackVolume, currentStartTime);
    }

    // Apply Fade Out (if not the last track)
    if (index < audioBuffers.length - 1 && actualFade > 0) {
      const fadeOutStart = currentStartTime + buffer.duration - actualFade;
      const fadeOutEnd = currentStartTime + buffer.duration;
      
      // We need to schedule the fade out
      // Ensure we are at the correct volume before fading out
      gainNode.gain.setValueAtTime(trackVolume, fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, fadeOutEnd);
    } else {
      // If no fade out (last track), ensure volume stays constant until end (implicit)
      // Just to be safe for the "middle" of the track if no fades are happening
      gainNode.gain.setValueAtTime(trackVolume, currentStartTime + actualFade); 
    }

    source.start(currentStartTime);

    // Update cursor: The next track starts BEFORE this one ends (by the crossfade amount)
    currentStartTime += (buffer.duration - crossfadeDuration);
    
    // Security check: ensure time doesn't go negative if crossfade is huge
    if (currentStartTime < 0) currentStartTime = 0; 
  });

  const renderedBuffer = await offlineCtx.startRendering();

  // 4. Encode to MP3 using Worker
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      worker.onmessage = (e) => {
        const { mp3Data } = e.data;
        const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
        resolve(mp3Blob);
        worker.terminate();
      };

      worker.onerror = (e) => {
        reject(new Error("Encoding failed: " + e.message));
        worker.terminate();
      };

      // Extract channels for worker
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
    }
  });
};