import type { Track } from "./types";
import type { PreloadAdapter } from "./adapters";

export interface PreloadConfig {
  preloadCount: number;
  maxCacheSize: number;
  ttl: number;
}

export interface PreloadOptions {
  resolveTrack?: (track: Track) => Promise<Track>;
}

interface CachedTrack {
  url: string;
  loadedAt: number;
}

const DEFAULT_CONFIG: PreloadConfig = {
  preloadCount: 2,
  maxCacheSize: 5,
  ttl: 5 * 60 * 1000,
};

export class PreloadManager implements PreloadAdapter {
  private readonly cache = new Map<string, CachedTrack>();
  private readonly loading = new Set<string>();
  private readonly config: PreloadConfig;
  private readonly resolveTrack?: (track: Track) => Promise<Track>;

  constructor(
    config: Partial<PreloadConfig> = {},
    options: PreloadOptions = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.resolveTrack = options.resolveTrack;
  }

  getUrl(trackId: string): string | null {
    const cached = this.cache.get(trackId);
    if (!cached || Date.now() - cached.loadedAt > this.config.ttl) {
      return null;
    }
    return cached.url;
  }

  preloadNext(tracks: Track[], currentIndex: number): void {
    for (let offset = 1; offset <= this.config.preloadCount; offset += 1) {
      const track = tracks[(currentIndex + offset) % tracks.length];
      if (track && !this.getUrl(track.id) && !this.loading.has(track.id)) {
        void this.preload(track);
      }
    }
  }

  private async preload(track: Track): Promise<void> {
    this.loading.add(track.id);
    try {
      const source = this.resolveTrack ? await this.resolveTrack(track) : track;
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Preload failed with status ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      this.cache.set(track.id, { url, loadedAt: Date.now() });
      while (this.cache.size > this.config.maxCacheSize) {
        const oldest = [...this.cache.entries()].sort(
          ([, left], [, right]) => left.loadedAt - right.loadedAt,
        )[0];
        if (!oldest) break;
        URL.revokeObjectURL(oldest[1].url);
        this.cache.delete(oldest[0]);
      }
    } finally {
      this.loading.delete(track.id);
    }
  }
}
