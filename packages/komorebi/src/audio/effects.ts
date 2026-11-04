import type { Equalizer, EqualizerState } from "../engine/equalizer";

export const MAX_PITCH_SEMITONES = 48;
export const MAX_CROSSFADE_SECONDS = 10;

export function clampPitch(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(-MAX_PITCH_SEMITONES, Math.min(MAX_PITCH_SEMITONES, semitones));
}

export function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampRate(value: number): number {
  return Math.max(0.25, Math.min(4, value));
}

export function clampCrossfade(value: number): number {
  return Math.max(0, Math.min(MAX_CROSSFADE_SECONDS, value));
}

export interface AudioEffects {
  setVolume(volume: number): void;
  getVolume(): number;
  setReplayGain(gainDb: number | null): void;
  getReplayGain(): number | null;
  setPitch(semitones: number): void | Promise<void>;
  getPitch(): number;
  setEqualizer(enabled: boolean): void;
  updateEqualizer(): void;
  getEqualizer(): Equalizer;
  applyEqualizer?(state: EqualizerState): void;
  getAnalyser?(): unknown;
  resume?(): void | Promise<void>;
  dispose(): void;
}
