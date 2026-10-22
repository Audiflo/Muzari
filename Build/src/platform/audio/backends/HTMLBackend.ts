import { BaseAudioBackend } from "./BaseBackend";
import { AudioGraph } from "../graph";
import { clampRate, clampVolume } from "../clamp";
import { createLogger, describeError } from "../../../helpers/logger";

const logger = createLogger("htmlBackend");

const SEEK_SETTLE_TOLERANCE = 0.25;

export class HTMLAudioBackend extends BaseAudioBackend {
  private audio: HTMLAudioElement;
  private graph: AudioGraph;
  private ownsGraph: boolean;
  private outputGain: GainNode | null = null;
  private boundOnEnded: () => void;
  private boundOnError: () => void;
  private boundOnLoadedMetadata: () => void;
  private boundOnSeeked: () => void;
  private boundOnDurationChange: () => void;
  private duration = 0;
  private pendingSeek: number | null = null;
  private pendingLoadCleanup: (() => void) | null = null;

  constructor(graph?: AudioGraph) {
    super();
    this.graph = graph ?? new AudioGraph();
    this.ownsGraph = !graph;

    this.audio = this.graph.mediaElementPool.acquire();

    this.routeAudioElement();

    this.boundOnEnded = this.handleEnded.bind(this);
    this.boundOnError = this.handleError.bind(this);
    this.boundOnLoadedMetadata = this.handleLoadedMetadata.bind(this);
    this.boundOnSeeked = this.handleSeeked.bind(this);
    this.boundOnDurationChange = this.handleDurationChange.bind(this);

    this.audio.addEventListener("ended", this.boundOnEnded);
    this.audio.addEventListener("error", this.boundOnError);
    this.audio.addEventListener("loadedmetadata", this.boundOnLoadedMetadata);
    this.audio.addEventListener("seeked", this.boundOnSeeked);
    this.audio.addEventListener("durationchange", this.boundOnDurationChange);
  }

  async load(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingSeek = 0;

      const cleanup = () => {
        this.audio.removeEventListener("canplaythrough", onCanPlayThrough);
        this.audio.removeEventListener("error", onError);
        this.pendingLoadCleanup = null;
      };

      const onCanPlayThrough = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load audio: ${url}`));
      };

      this.pendingLoadCleanup = cleanup;
      this.audio.addEventListener("canplaythrough", onCanPlayThrough);
      this.audio.addEventListener("error", onError);

      this.audio.src = url;
      this.audio.load();
    });
  }

  async play(): Promise<void> {
    this.graph.resume();
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (error) {
        logger.warn("HTML audio playback rejected", {
          error: describeError(error),
        });
        throw new Error(`Play failed: ${(error as Error).message}`);
      }
    }
  }

  pause(): void {
    if (!this.audio.paused) {
      this.audio.pause();
    }
  }

  stop(): void {
    this.audio.pause();
    this.pendingSeek = 0;
    this.audio.currentTime = 0;
  }

  seek(time: number): void {
    const wasPlaying = !this.audio.paused;
    const target = this.clampToSeekable(Math.max(0, time));
    this.pendingSeek = target;
    this.audio.currentTime = target;
    if (wasPlaying) {
      this.audio.play().catch(() => {});
    }
  }

  setVolume(volume: number): void {
    if (this.outputGain) {
      this.graph.setVolume(volume);
      return;
    }
    this.audio.volume = clampVolume(volume);
  }

  setOutputGain(value: number): void {
    if (this.outputGain) {
      this.outputGain.gain.value = value;
    }
  }

  canSetOutputGain(): boolean {
    return this.outputGain !== null;
  }

  setPlaybackRate(rate: number): void {
    this.audio.playbackRate = clampRate(rate);
  }

  getCurrentTime(): number {
    if (this.pendingSeek !== null) {
      if (
        Math.abs(this.audio.currentTime - this.pendingSeek) <
        SEEK_SETTLE_TOLERANCE
      ) {
        this.pendingSeek = null;
      } else {
        return this.pendingSeek;
      }
    }
    return this.audio.currentTime;
  }

  getAnalyser(): AnalyserNode | null {
    return this.graph.getAnalyser();
  }

  getDuration(): number {
    return this.duration || this.audio.duration || 0;
  }

  dispose(): void {
    this.pendingLoadCleanup?.();
    this.audio.removeEventListener("ended", this.boundOnEnded);
    this.audio.removeEventListener("error", this.boundOnError);
    this.audio.removeEventListener(
      "loadedmetadata",
      this.boundOnLoadedMetadata,
    );
    this.audio.removeEventListener("seeked", this.boundOnSeeked);
    this.audio.removeEventListener(
      "durationchange",
      this.boundOnDurationChange,
    );

    this.audio.pause();
    this.audio.src = "";
    this.audio.load();
    this.graph.mediaElementPool.release(this.audio);

    if (this.ownsGraph) {
      this.graph.dispose();
    }
    super.dispose();
  }

  private routeAudioElement(): void {
    try {
      this.outputGain = this.graph.createSlot();
      this.graph.connectMediaElement(this.audio, this.outputGain);
    } catch (error) {
      this.outputGain = null;
      logger.warn("Media element routing failed; output gain unavailable", {
        error: describeError(error),
      });
    }
  }

  private handleEnded(): void {
    this.emitEnded();
  }

  private handleError(): void {
    const error = this.audio.error;
    this.emitError(new Error(error?.message ?? "Unknown audio error"));
  }

  private handleLoadedMetadata(): void {
    this.duration = this.audio.duration;
    this.emitDurationChange(this.getDuration());
  }

  private handleDurationChange(): void {
    this.duration = this.audio.duration;
    this.emitDurationChange(this.getDuration());
  }

  private handleSeeked(): void {
    this.pendingSeek = null;
  }

  private clampToSeekable(time: number): number {
    const { seekable } = this.audio;
    if (!seekable || seekable.length === 0) return time;

    let nearest = time;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < seekable.length; index += 1) {
      const start = seekable.start(index);
      const end = seekable.end(index);
      if (time >= start && time <= end) return time;

      const startDistance = Math.abs(time - start);
      if (startDistance < nearestDistance) {
        nearest = start;
        nearestDistance = startDistance;
      }
      const endDistance = Math.abs(time - end);
      if (endDistance < nearestDistance) {
        nearest = end;
        nearestDistance = endDistance;
      }
    }
    return nearest;
  }
}
