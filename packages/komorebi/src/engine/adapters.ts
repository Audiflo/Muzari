import type { Track } from "./types";

export interface CrossfadeSource {
  setOutputGain(value: number): void;
  getCurrentTime(): number;
  getDuration?(): number;
  dispose(): void;
}

export interface EqualizerState {
  enabled: boolean;
  bands: readonly EqualizerBand[];
  presetName: string | null;
}

export interface EqualizerBand {
  type: string;
  frequency: number;
  gainDb: number;
  q: number;
}

export interface Equalizer {
  isEnabled(): boolean;
  setBands(bands: readonly EqualizerBand[]): void;
}

export interface IAudioBackend {
  load(url: string, track?: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  setOutputGain?(value: number): void;
  createCrossfadeSource?(
    url: string,
    track?: Track,
  ): Promise<CrossfadeSource | null>;
  commitCrossfadeSource?(source: CrossfadeSource): void;
  getAnalyser?: () => AnalyserNode | null;
  getEqualizer?(): Equalizer;
  setEqualizer?(enabled: boolean): void;
  updateEqualizer?(): void;
  setPitch?(semitones: number): void | Promise<void>;
  setReplayGain?(gainDb: number | null): void;
  getCurrentTime(): number;
  getDuration(): number;
  onDurationChange?(callback: (duration: number) => void): void;
  onEnded(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
  dispose(): void;
}

export interface PreloadAdapter {
  getUrl(trackId: string): string | null;
  preloadNext(tracks: Track[], currentIndex: number): void;
}

export interface MediaSessionIntegration {
  initialize(): void | Promise<void>;
  dispose(): void;
  setActionHandlers(handlers: MediaActionHandlers): void;
  updateMetadata(track: Track | null): void | Promise<void>;
  setPlaybackState(state: "playing" | "paused" | "none"): void;
  setPositionState(
    duration: number,
    position: number,
    playbackRate?: number,
  ): void;
}

export interface MediaActionHandlers {
  play(): void | Promise<void>;
  pause(): void;
  next(): void | Promise<void>;
  previous(): void | Promise<void>;
  stop(): void;
  seek(time: number): void;
}

export interface KomorebiLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
