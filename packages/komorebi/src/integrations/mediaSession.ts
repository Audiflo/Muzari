import type { Track } from "../engine/types";

export type MediaPlaybackState = "playing" | "paused" | "none";

export interface MediaActionHandlers {
  play(): void | Promise<void>;
  pause(): void;
  next(): void | Promise<void>;
  previous(): void | Promise<void>;
  stop(): void;
  seek(time: number): void;
}

export interface MediaSessionAdapter {
  initialize(): void | Promise<void>;
  dispose(): void;
  setActionHandlers(handlers: MediaActionHandlers): void;
  updateMetadata(track: Track | null): void | Promise<void>;
  setPlaybackState(state: MediaPlaybackState): void;
  setPositionState(duration: number, position: number, playbackRate?: number): void;
}
