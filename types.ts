export interface AudioTrack {
  id: string;
  file: File;
  name: string;
  duration?: number;
  volume: number; // 0 to 1
}

export enum MergeStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface AiMetadata {
  title: string;
  description: string;
  coverImageBase64?: string;
  videoSearchPrompt?: string;
  coverArtPrompt?: string;
}