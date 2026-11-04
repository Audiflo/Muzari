import type { Track } from "@audiflo/komorebi";

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
