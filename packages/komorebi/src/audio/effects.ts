import type { Equalizer, EqualizerState } from "../engine/equalizer";

export const MAX_PITCH_SEMITONES = 48;

export function clampPitch(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(-MAX_PITCH_SEMITONES, Math.min(MAX_PITCH_SEMITONES, semitones));
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
