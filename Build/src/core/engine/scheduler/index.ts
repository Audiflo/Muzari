import type { CrossfadeConfig, GaplessConfig, Track } from "../types";
import { DEFAULT_CROSSFADE_SHAPE, DEFAULT_ENGINE_SETTINGS } from "../settings";

export class CrossfadeScheduler {
  private config: CrossfadeConfig = {
    enabled: DEFAULT_ENGINE_SETTINGS.crossfade > 0,
    duration: DEFAULT_ENGINE_SETTINGS.crossfade,
    shape: DEFAULT_CROSSFADE_SHAPE,
  };

  setConfig(config: Partial<CrossfadeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CrossfadeConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled && this.config.duration > 0;
  }

  calculateTriggerTime(trackDuration: number): number | null {
    if (!this.isEnabled()) return null;

    const durationSeconds = this.config.duration;
    if (trackDuration <= durationSeconds) return null;

    return trackDuration - durationSeconds;
  }

  shouldTrigger(currentTime: number, trackDuration: number): boolean {
    if (!this.isEnabled()) return false;

    const triggerPoint = this.calculateTriggerTime(trackDuration);
    if (triggerPoint === null) return false;

    return currentTime >= triggerPoint;
  }

  calculateVolumes(progress: number): { fromVolume: number; toVolume: number } {
    const p = Math.max(0, Math.min(1, progress));
    if (this.config.shape === "equalpower") {
      return {
        fromVolume: Math.cos((p * Math.PI) / 2),
        toVolume: Math.sin((p * Math.PI) / 2),
      };
    }
    return { fromVolume: 1 - p, toVolume: p };
  }
}

export class GaplessScheduler {
  private config: GaplessConfig = {
    enabled: DEFAULT_ENGINE_SETTINGS.gaplessPlayback,
    startOffset: 0,
    endOffset: 0,
  };

  setConfig(config: Partial<GaplessConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): GaplessConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private samplesToSeconds(
    samples: number | undefined,
    fallback: number,
    sampleRate: number | undefined,
  ): number {
    if (typeof samples !== "number" || !Number.isFinite(samples)) {
      return fallback;
    }
    if (
      typeof sampleRate !== "number" ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      return fallback;
    }
    return samples / sampleRate;
  }

  getStartOffset(track: Track): number {
    return this.samplesToSeconds(
      track.gapless?.encoderDelay,
      this.config.startOffset,
      track.encoding?.sampleRate,
    );
  }

  getEndOffset(track: Track): number {
    return this.samplesToSeconds(
      track.gapless?.encoderPadding,
      this.config.endOffset,
      track.encoding?.sampleRate,
    );
  }

  shouldPreload(currentTime: number, duration: number): boolean {
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const preloadTime = 10;
    return duration - currentTime <= preloadTime;
  }

  calculatePlayEnd(track: Track): number {
    const offset = this.getEndOffset(track);
    return track.duration - offset;
  }

  shouldTransition(currentTime: number, track: Track): boolean {
    if (!Number.isFinite(track.duration) || track.duration <= 0) return false;
    const playEnd = this.calculatePlayEnd(track);
    const threshold = 0.1;
    return currentTime >= playEnd - threshold;
  }
}

export class Scheduler {
  private crossfade: CrossfadeScheduler;
  private gapless: GaplessScheduler;
  private currentMode: "crossfade" | "gapless" | "none" = "none";

  constructor() {
    this.crossfade = new CrossfadeScheduler();
    this.gapless = new GaplessScheduler();
  }

  setCrossfadeConfig(config: Partial<CrossfadeConfig>): void {
    this.crossfade.setConfig(config);
    this.updateMode();
  }

  setGaplessConfig(config: Partial<GaplessConfig>): void {
    this.gapless.setConfig(config);
    this.updateMode();
  }

  private updateMode(): void {
    if (this.crossfade.isEnabled()) {
      this.currentMode = "crossfade";
    } else if (this.gapless.isEnabled() && this.gapless.getConfig().enabled) {
      this.currentMode = "gapless";
    } else {
      this.currentMode = "none";
    }
  }

  getMode(): "crossfade" | "gapless" | "none" {
    return this.currentMode;
  }

  shouldPreload(currentTime: number, duration: number): boolean {
    return this.gapless.shouldPreload(currentTime, duration);
  }

  shouldTriggerTransition(currentTime: number, track: Track): boolean {
    switch (this.currentMode) {
      case "crossfade":
        return this.crossfade.shouldTrigger(currentTime, track.duration);
      case "gapless":
        return this.gapless.shouldTransition(currentTime, track);
      default:
        return false;
    }
  }

  getCrossfade(): CrossfadeScheduler {
    return this.crossfade;
  }

  getGapless(): GaplessScheduler {
    return this.gapless;
  }
}
