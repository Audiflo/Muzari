import type { Track } from "../core/engine/types";

declare global {
  interface WallpaperProps {
    currentSong: Track | null;
    playbackState: {
      analyserNode?: AnalyserNode | null;
      isPlaying?: boolean;
    } | null;
  }
}

declare module "muzari/wallpaper" {
  export type { WallpaperProps };
}
