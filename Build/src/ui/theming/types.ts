import type { ThemeMode } from "./events";

export interface Palette {
  name: string;
  author: string;
  description: string;
  version: string;
  cssFile: string;
}

export interface IconSet {
  id: string;
  label: string;
  themeName: string;
  path: string;
}

export interface Wallpaper {
  name: string;
  author: string;
  description: string;
  version: string;
  componentFile: string;
}

export type WallpaperComponent = React.ComponentType<WallpaperProps>;

export interface WallpaperProps {
  currentSong?: unknown;
  playbackState?: unknown;
}

export interface ThemeConfig {
  defaultPalette: string;
  defaultIconSet: string;
  defaultWallpaper: string;
  defaultMode: ThemeMode;
}

export interface ThemingState {
  palette: Palette | null;
  iconSet: IconSet | null;
  wallpaper: Wallpaper | null;
  mode: ThemeMode;
  isLoading: boolean;
  error: string | null;
}

export interface ThemingSettings {
  palette: string;
  iconSet: string;
  wallpaper: string;
  mode: ThemeMode;
}

export const DEFAULT_THEMING_SETTINGS: ThemingSettings = {
  palette: "Blue",
  iconSet: "lucide",
  wallpaper: "None",
  mode: "auto",
};
