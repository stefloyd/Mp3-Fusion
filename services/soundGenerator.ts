// Simple WAV encoder
function bufferToWav(abuffer: AudioBuffer, len: number): Blob {
  const numOfChan = abuffer.numberOfChannels;
  const length = len * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 44); // chunk length

  // write interleaved data
  for (i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while (pos < len) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      // scale to 16-bit signed int
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; 
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export type SoundType = 'rain_light' | 'rain_heavy' | 'thunder' | 'river' | 'white_noise' | 'pink_noise' | 'brown_noise';

export const SOUND_TYPES: { id: SoundType; label: string }[] = [
  { id: 'rain_light', label: 'Pioggia Leggera' },
  { id: 'rain_heavy', label: 'Pioggia Forte' },
  { id: 'thunder', label: 'Temporale (Tuoni)' },
  { id: 'river', label: 'Acqua che scorre' },
  { id: 'white_noise', label: 'Rumore Bianco' },
  { id: 'pink_noise', label: 'Rumore Rosa' },
  { id: 'brown_noise', label: 'Rumore Marrone' },
];

export const generateSoundEffect = async (type: SoundType, durationSeconds: number): Promise<File> => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContext();
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * durationSeconds;
  const buffer = ctx.createBuffer(2, bufferSize, sampleRate);

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Noise generation helpers
  const generateWhite = () => Math.random() * 2 - 1;
  
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const generatePink = () => {
    const white = generateWhite();
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    return pink * 0.11; // (roughly) compensate for gain
  };

  let lastOut = 0;
  const generateBrown = () => {
    const white = generateWhite();
    lastOut = (lastOut + (0.02 * white)) / 1.02;
    return lastOut * 3.5; // compensate for gain
  };

  // Fill buffer based on type
  for (let i = 0; i < bufferSize; i++) {
    let sampleL = 0;
    let sampleR = 0;

    switch (type) {
      case 'white_noise':
        sampleL = generateWhite();
        sampleR = generateWhite();
        break;
      case 'pink_noise':
      case 'rain_light':
      case 'rain_heavy':
        sampleL = generatePink();
        sampleR = generatePink();
        break;
      case 'brown_noise':
      case 'river':
      case 'thunder':
        sampleL = generateBrown();
        sampleR = generateBrown();
        break;
    }

    left[i] = sampleL;
    right[i] = sampleR;
  }

  // Post-processing (Filtering) using OfflineAudioContext
  // We render the generated noise through filters to shape the sound
  const offlineCtx = new OfflineAudioContext(2, bufferSize, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  const gainNode = offlineCtx.createGain();
  source.connect(gainNode);

  // Apply specific filters
  if (type === 'rain_light') {
    // Low pass to remove harsh highs
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    gainNode.connect(filter);
    filter.connect(offlineCtx.destination);
    gainNode.gain.value = 0.6;
  } else if (type === 'rain_heavy') {
    // Higher cutoff for heavier rain
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500;
    gainNode.connect(filter);
    filter.connect(offlineCtx.destination);
    gainNode.gain.value = 0.8;
  } else if (type === 'river') {
    // Bandpass for flowing water
    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1000;
    
    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 200;

    gainNode.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(offlineCtx.destination);
    gainNode.gain.value = 0.7;
  } else if (type === 'thunder') {
    // Thunder needs random bursts of volume on low freq noise
    // This is hard to do with just a static buffer and filter
    // We'll simulate it by modulating gain with a low frequency oscillator (simulated)
    // Actually, let's just do a deep rumble (Lowpass Brown Noise)
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;
    gainNode.connect(filter);
    filter.connect(offlineCtx.destination);
    gainNode.gain.value = 1.0;
    
    // Note: Real thunder is bursty. This will sound like a constant rumble/earthquake.
    // Acceptable for "Basic effects"
  } else {
    gainNode.connect(offlineCtx.destination);
    gainNode.gain.value = 0.5;
  }

  source.start();
  const renderedBuffer = await offlineCtx.startRendering();

  const blob = bufferToWav(renderedBuffer, bufferSize);
  const filename = `${SOUND_TYPES.find(t => t.id === type)?.label || 'Effect'}.wav`;
  
  return new File([blob], filename, { type: 'audio/wav' });
};
