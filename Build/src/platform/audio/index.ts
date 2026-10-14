import type { Track } from "../../core/engine/types";
import type { Equalizer } from "./equalizer";

export interface CrossfadeSource {
  setOutputGain(value: number): void;
  getCurrentTime(): number;
  getDuration?(): number;
  dispose(): void;
}

export interface IAudioBackend {
  /**
   * @param url Playable source (blob or http url) for the track.
   * @param track The track being loaded, when the caller knows it. Backends
   *   use it to make routing/decoding decisions (e.g. native flo) without
   *   having to infer the format from the url, which is often a blob url.
   */
  load(url: string, track?: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  canSetOutputGain?(): boolean;
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
  offDurationChange?(callback: (duration: number) => void): void;
  onEnded(callback: () => void): void;
  offEnded(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
  offError(callback: (error: Error) => void): void;
  dispose(): void;
}
