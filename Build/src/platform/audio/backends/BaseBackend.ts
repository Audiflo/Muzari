import type { IAudioBackend } from "../../audio/index";
import type { Track } from "../../../core/engine/types";

export abstract class BaseAudioBackend implements IAudioBackend {
  protected durationChangeCallbacks: Set<(duration: number) => void> = new Set();
  protected endedCallbacks: Set<() => void> = new Set();
  protected errorCallbacks: Set<(error: Error) => void> = new Set();

  abstract load(url: string, track?: Track): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): void;
  abstract stop(): void;
  abstract seek(time: number): void;
  abstract setVolume(volume: number): void;
  abstract setPlaybackRate(rate: number): void;
  abstract getCurrentTime(): number;
  abstract getDuration(): number;

  dispose(): void {
    this.durationChangeCallbacks.clear();
    this.endedCallbacks.clear();
    this.errorCallbacks.clear();
  }

  onDurationChange(callback: (duration: number) => void): void {
    this.durationChangeCallbacks.add(callback);
  }

  offDurationChange(callback: (duration: number) => void): void {
    this.durationChangeCallbacks.delete(callback);
  }

  onEnded(callback: () => void): void {
    this.endedCallbacks.add(callback);
  }

  offEnded(callback: () => void): void {
    this.endedCallbacks.delete(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.add(callback);
  }

  offError(callback: (error: Error) => void): void {
    this.errorCallbacks.delete(callback);
  }

  protected emitDurationChange(duration: number): void {
    this.durationChangeCallbacks.forEach((cb) => cb(duration));
  }

  protected emitEnded(): void {
    this.endedCallbacks.forEach((cb) => cb());
  }

  protected emitError(error: Error): void {
    this.errorCallbacks.forEach((cb) => cb(error));
  }
}
