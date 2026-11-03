import type { Track } from "../engine/types";
import type { MediaActionHandlers } from "../engine/adapters";

export type MediaPlaybackState = "playing" | "paused" | "none";

export interface MediaSessionAdapter {
  initialize(): void | Promise<void>;
  dispose(): void;
  setActionHandlers(handlers: MediaActionHandlers): void;
  updateMetadata(track: Track | null): void | Promise<void>;
  setPlaybackState(state: MediaPlaybackState): void;
  setPositionState(duration: number, position: number, playbackRate?: number): void;
}
