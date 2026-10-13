import type {
  Track,
  Playlist,
  EngineSettings,
  EngineState,
  PlayerState,
  EngineEventMap,
  EngineError,
  RepeatMode,
  ReplayGainMode,
  CrossfadeShape,
} from "./types";
import { KomorebiEvents } from "./events";
import { StateMachine } from "./state";
import {
  QueueManager,
  type WeightedRandomizer,
  type ShuffleMode,
} from "./queue";
import { Scheduler } from "./scheduler";
import { AsyncOp } from "./asyncOp";
import { assertNever } from "./invariants";
import type { CrossfadeSource, IAudioBackend } from "../../platform/audio";
import { PreloadManager } from "../../platform/audio/preloader";
import { MAX_REPLAY_GAIN_DB } from "../../platform/audio/replayGain";
import {
  createMediaSessionIntegration,
  type MediaSessionIntegration,
} from "../../platform/integrations/mediaSession";
import type { Equalizer, EqualizerState } from "../../platform/audio/equalizer";
import {
  clampCrossfade as clampCrossfadeSeconds,
  clampRate,
  clampVolume,
} from "../../platform/audio/clamp";
import { createLogger } from "../../helpers/logger";
import { DEFAULT_CROSSFADE_SHAPE, DEFAULT_ENGINE_SETTINGS } from "./settings";

export { DEFAULT_CROSSFADE_SHAPE, DEFAULT_ENGINE_SETTINGS };

const logger = createLogger("engine");

export interface IAudioEngineConfig {
  crossfade?: {
    duration: number;
    shape: CrossfadeShape;
  };
  gapless?: {
    enabled: boolean;
  };
  smartShuffle?: boolean;
  autoPlayNext?: boolean;
  trackResolver?: (track: Track) => Promise<Track>;
}

const SECONDS_TO_MS = 1000;

export class KomorebiEngine {
  private events = new KomorebiEvents();
  private stateMachine = new StateMachine();
  private queue = new QueueManager();
  private scheduler = new Scheduler();

  private backend: IAudioBackend;
  private settings: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS };
  private crossfadeShape: CrossfadeShape = DEFAULT_CROSSFADE_SHAPE;
  private currentTime = 0;
  private duration = 0;
  private currentError: EngineError | null = null;
  private currentPlaylist: Playlist | null = null;

  private timeUpdateInterval: number | null = null;
  private scheduledTransitionId: number | null = null;
  private crossfadeTimer: number | null = null;
  private crossfadeSource: CrossfadeSource | null = null;
  private crossfadeFinish: (() => void) | null = null;

  private readonly loadOp = new AsyncOp();
  private readonly trackResolver:
    ((track: Track) => Promise<Track>) | undefined;
  private readonly preloadManager: PreloadManager | null;
  private readonly mediaSession: MediaSessionIntegration | null;
  private prefetchSentinel = false;

  constructor(backend: IAudioBackend, config?: Partial<IAudioEngineConfig>) {
    this.backend = backend;
    this.trackResolver = config?.trackResolver;
    this.preloadManager = config?.trackResolver
      ? new PreloadManager({}, { resolveTrack: config.trackResolver })
      : null;
    this.backend.onEnded(() => {
      this.handleTrackEnded();
    });
    this.backend.onError((error) => {
      this.handleError(error);
    });
    this.backend.onDurationChange?.((duration) => {
      this.handleDurationChange(duration);
    });

    if (config?.crossfade) {
      this.settings.crossfade = config.crossfade.duration;
      this.crossfadeShape = config.crossfade.shape;
    }

    if (config?.gapless) {
      this.settings.gaplessPlayback = config.gapless.enabled;
    }

    if (config?.smartShuffle !== undefined) {
      this.settings.smartShuffle = config.smartShuffle;
    }

    if (config?.autoPlayNext !== undefined) {
      this.settings.autoPlayNext = config.autoPlayNext;
    }

    this.applySchedulerSettings();

    this.mediaSession =
      typeof navigator !== "undefined" && "mediaSession" in navigator
        ? createMediaSessionIntegration()
        : null;
    if (this.mediaSession) {
      void this.mediaSession.initialize();
      this.mediaSession.setActionHandlers({
        play: () => void this.play(),
        pause: () => this.pause(),
        next: () => void this.next(),
        previous: () => void this.previous(),
        stop: () => this.stop(),
        seek: (time) => this.seek(time),
      });
      this.on("statechange", this.syncMediaSession);
      this.on("durationchange", this.syncMediaSession);
      this.on("timeupdate", this.syncMediaSession);
      this.on("trackchange", this.handleMediaTrackChange);
      void this.mediaSession.updateMetadata(this.queue.getCurrentTrack());
      this.syncMediaSession();
    }
  }

  setWeightedRandomizer(randomizer: WeightedRandomizer | null): void {
    this.queue.setWeightedRandomizer(randomizer);
    if (this.settings.smartShuffle) {
      this.queue.setShuffleMode("smart");
    }
  }

  setShuffleMode(mode: ShuffleMode): void {
    this.queue.setShuffleMode(mode);
    this.settings.smartShuffle = mode === "smart";
    this.events.emit("settingschange", {
      settings: { smartShuffle: this.settings.smartShuffle },
    });
  }

  getShuffleMode(): ShuffleMode {
    return this.queue.getShuffleMode();
  }

  async load(track: Track, playlist?: Playlist): Promise<void> {
    if (playlist) {
      this.queue.setPlaylist(playlist);
      this.currentPlaylist = playlist;
    } else if (this.queue.getTracks().findIndex((t) => t.id === track.id) < 0) {
      const solo: Playlist = {
        id: `solo:${track.id}`,
        name: track.title,
        songs: [track],
      };
      this.queue.setPlaylist(solo);
      this.currentPlaylist = solo;
    }

    const previousTrack = this.queue.getCurrentTrack();

    const trackIndex = this.queue
      .getTracks()
      .findIndex((t) => t.id === track.id);
    this.queue.jumpToIndex(trackIndex >= 0 ? trackIndex : null);
    this.emitTrackChange(previousTrack, track);

    this.cancelScheduledTransition();
    this.stateMachine.transition("loading");
    this.currentError = null;
    this.events.emit("loading", { track });

    const generation = this.loadOp.next();

    let target: Track;
    try {
      target = await this.resolveSource(track);
    } catch (error) {
      if (this.loadOp.isCurrent(generation)) {
        this.emitError(
          "LOAD_SOURCE_ERROR",
          `resolve source: ${String(error)}`,
          track,
        );
      }
      return;
    }

    return new Promise<void>((resolve) => {
      if (!this.loadOp.isCurrent(generation)) {
        resolve();
        return;
      }

      if (typeof target.url !== "string" || target.url.length === 0) {
        this.emitError(
          "LOAD_SOURCE_ERROR",
          `no playable source (url=${String(target.url)})`,
          track,
        );
        resolve();
        return;
      }

      this.backend
        .load(target.url, target)
        .then(() => {
          if (!this.loadOp.isCurrent(generation)) {
            resolve();
            return;
          }
          this.prefetchSentinel = false;
          this.backend.setReplayGain?.(this.replayGainForTrack(target));
          this.duration = this.backend.getDuration() ?? track.duration;
          this.stateMachine.transition("ready");
          this.events.emit("durationchange", { duration: this.duration });
          this.events.emit("ready", { track });
          this.emitStateChange();
          this.prefetchUpcoming(target);
          resolve();
        })
        .catch((error) => {
          if (!this.loadOp.isCurrent(generation)) {
            resolve();
            return;
          }
          this.prefetchSentinel = false;
          this.emitError("LOAD_ERROR", error.message, track);
          resolve();
        });
    });
  }

  async play(): Promise<void> {
    try {
      const state = this.stateMachine.getState();

      if (state === "idle" || state === "error") {
        const current = this.queue.getCurrentTrack();
        if (!current) return;

        this.load(current);
        const generation = this.loadOp.peek();
        await this.waitForState("ready");
        if (!this.loadOp.isCurrent(generation)) return;
        await this.play();
        return;
      }

      if (state !== "ready" && state !== "paused") return;

      const generation = this.loadOp.peek();
      await this.backend.play();
      if (!this.loadOp.isCurrent(generation)) return;

      this.stateMachine.transition("playing");
      this.startTimeUpdates();
      this.emitStateChange();

      const track = this.queue.getCurrentTrack();
      if (track) {
        this.queue.updateHistory(track.id);
      }
    } catch (error) {
      this.emitError("PLAY_ERROR", (error as Error).message);
    }
  }

  pause(): void {
    if (this.stateMachine.isPlaying()) {
      this.crossfadeFinish?.();
      this.backend.pause();
      this.stateMachine.transition("paused");
      this.stopTimeUpdates();
      this.emitStateChange();
    }
  }

  stop(): void {
    if (this.stateMachine.isIdle()) return;
    this.loadOp.invalidate();
    this.backend.stop();
    this.backend.setReplayGain?.(null);
    this.prefetchSentinel = false;
    this.cancelScheduledTransition();
    this.stateMachine.transition("idle");
    this.currentTime = 0;
    this.currentError = null;
    this.stopTimeUpdates();
    this.emitTimeUpdate();
    this.emitStateChange();
  }

  async next(): Promise<void> {
    this.cancelScheduledTransition();

    const nextCursor = this.queue.peekNextCursor(this.settings.smartShuffle);

    switch (nextCursor.kind) {
      case "empty":
        break;
      case "active": {
        const nextTrack = this.queue.getTracks()[nextCursor.index];
        if (nextTrack === undefined) break;

        try {
          if (this.stateMachine.isPlaying()) {
            await this.loadAndPlay(nextTrack);
          } else {
            await this.load(nextTrack);
          }
        } catch (error) {
          this.emitError("NEXT_ERROR", (error as Error).message, nextTrack);
        }
        break;
      }
      default:
        assertNever(nextCursor);
    }
  }

  async previous(): Promise<void> {
    this.cancelScheduledTransition();

    if (this.currentTime > 3) {
      this.seek(0);
      return;
    }

    const prevCursor = this.queue.peekPreviousCursor(
      this.settings.smartShuffle,
    );

    switch (prevCursor.kind) {
      case "empty":
        break;
      case "active": {
        const prevTrack = this.queue.getTracks()[prevCursor.index];
        if (prevTrack === undefined) break;

        try {
          if (this.stateMachine.isPlaying()) {
            await this.loadAndPlay(prevTrack);
          } else {
            await this.load(prevTrack);
          }
        } catch (error) {
          this.emitError("PREV_ERROR", (error as Error).message, prevTrack);
        }
        break;
      }
      default:
        assertNever(prevCursor);
    }
  }

  seek(time: number): void {
    this.cancelCrossfadeLoop();
    const clampedTime = Math.max(0, Math.min(time, this.duration));
    this.backend.seek(clampedTime);
    this.currentTime = clampedTime;
    this.emitTimeUpdate();
  }

  setVolume(volume: number): void {
    const clamped = clampVolume(volume);
    this.settings.volume = clamped;

    this.backend.setVolume(clamped);

    this.events.emit("volumechange", { volume: clamped });
  }

  setTempo(tempo: number): void {
    const clamped = clampRate(tempo);
    this.settings.tempo = clamped;

    this.backend.setPlaybackRate(clamped);

    this.events.emit("settingschange", { settings: { tempo: clamped } });
  }

  setPitch(semitones: number): void {
    this.settings.pitch = semitones;
    this.events.emit("settingschange", { settings: { pitch: semitones } });

    void this.backend.setPitch?.(semitones);
  }

  toggleShuffle(): void {
    if (this.queue.isShuffled()) {
      this.queue.unshuffle();
    } else {
      this.queue.shuffle(true);
    }

    this.settings.defaultShuffle = this.queue.isShuffled();
    this.events.emit("queuechange", { queue: this.queue.getState() });
  }

  setShuffle(shuffled: boolean): void {
    if (shuffled && !this.queue.isShuffled()) {
      this.queue.shuffle(true);
    } else if (!shuffled && this.queue.isShuffled()) {
      this.queue.unshuffle();
    }

    this.settings.defaultShuffle = shuffled;
    this.events.emit("queuechange", { queue: this.queue.getState() });
  }

  setRepeat(mode: RepeatMode): void {
    this.settings.repeat = mode;
    this.events.emit("settingschange", {
      settings: { repeat: mode },
    });
  }

  setAutoPlayNext(enabled: boolean): void {
    this.settings.autoPlayNext = enabled;
    this.events.emit("settingschange", {
      settings: { autoPlayNext: enabled },
    });
  }

  toggleRepeat(): void {
    const current = this.settings.repeat;
    this.settings.repeat =
      current === "off" ? "all" : current === "all" ? "one" : "off";
    this.events.emit("settingschange", {
      settings: { repeat: this.settings.repeat },
    });
  }

  setCrossfade(durationSeconds: number): void {
    const duration = clampCrossfadeSeconds(durationSeconds);
    this.settings.crossfade = duration;
    this.applySchedulerSettings();
    this.events.emit("settingschange", { settings: { crossfade: duration } });
  }

  setGapless(enabled: boolean): void {
    this.settings.gaplessPlayback = enabled;
    this.applySchedulerSettings();
    this.events.emit("settingschange", {
      settings: { gaplessPlayback: enabled },
    });
  }

  private applySchedulerSettings(): void {
    this.scheduler.setCrossfadeConfig({
      enabled: this.settings.crossfade > 0,
      duration: this.settings.crossfade,
      shape: this.crossfadeShape,
    });
    this.scheduler.setGaplessConfig({ enabled: this.settings.gaplessPlayback });
  }

  setReplayGainEnabled(enabled: boolean): void {
    this.settings.replayGainEnabled = enabled;
    this.refreshReplayGain();
    this.events.emit("settingschange", {
      settings: { replayGainEnabled: enabled },
    });
  }

  setReplayGainPreampDb(preampDb: number): void {
    const clamped = Number.isFinite(preampDb)
      ? Math.max(-MAX_REPLAY_GAIN_DB, Math.min(MAX_REPLAY_GAIN_DB, preampDb))
      : 0;
    this.settings.replayGainPreampDb = clamped;
    this.refreshReplayGain();
    this.events.emit("settingschange", {
      settings: { replayGainPreampDb: clamped },
    });
  }

  setReplayGainMode(mode: ReplayGainMode): void {
    this.settings.replayGainMode = mode;
    this.refreshReplayGain();
    this.events.emit("settingschange", { settings: { replayGainMode: mode } });
  }

  updateSettings(newSettings: Partial<EngineSettings>): void {
    Object.assign(this.settings, newSettings);

    if (newSettings.volume !== undefined) {
      this.setVolume(newSettings.volume);
    }
    if (newSettings.tempo !== undefined) {
      this.setTempo(newSettings.tempo);
    }
    if (newSettings.crossfade !== undefined) {
      this.setCrossfade(newSettings.crossfade);
    }
    if (newSettings.gaplessPlayback !== undefined) {
      this.setGapless(newSettings.gaplessPlayback);
    }
    if (newSettings.pitch !== undefined) {
      this.setPitch(newSettings.pitch);
    }
    if (newSettings.smartShuffle !== undefined) {
      this.setShuffleMode(newSettings.smartShuffle ? "smart" : "random");
    }
    if (newSettings.repeat !== undefined) {
      this.setRepeat(newSettings.repeat);
    }
    if (newSettings.replayGainEnabled !== undefined) {
      this.setReplayGainEnabled(newSettings.replayGainEnabled);
    }
    if (newSettings.replayGainPreampDb !== undefined) {
      this.setReplayGainPreampDb(newSettings.replayGainPreampDb);
    }
    if (newSettings.replayGainMode !== undefined) {
      this.setReplayGainMode(newSettings.replayGainMode);
    }

    this.events.emit("settingschange", { settings: newSettings });
  }

  setPlaylist(playlist: Playlist): void {
    this.queue.setPlaylist(playlist, false);
    this.currentPlaylist = playlist;
    this.events.emit("queuechange", { queue: this.queue.getState() });
  }

  getState(): EngineState {
    return {
      state: this.stateMachine.getState(),
      currentTrack: this.queue.getCurrentTrack(),
      currentPlaylist: this.currentPlaylist,
      queue: this.queue.getState(),
      settings: { ...this.settings },
      currentTime: this.currentTime,
      duration: this.duration,
      volume: this.settings.volume,
      playHistory: this.queue.getAllHistory(),
      error: this.currentError,
    };
  }

  getCurrentTrack(): Track | null {
    return this.queue.getCurrentTrack();
  }

  getQueue(): QueueManager {
    return this.queue;
  }

  getAnalyser(): AnalyserNode | null {
    return this.backend.getAnalyser?.() ?? null;
  }

  getEqualizer(): Equalizer | null {
    return this.backend.getEqualizer?.() ?? null;
  }

  applyEqualizer(state: EqualizerState): void {
    const equalizer = this.backend.getEqualizer?.();
    if (!equalizer) return;

    const wasEnabled = equalizer.isEnabled();
    equalizer.setBands(state.bands);

    if (wasEnabled !== state.enabled) {
      this.backend.setEqualizer?.(state.enabled);
    } else {
      this.backend.updateEqualizer?.();
    }
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  on<E extends keyof EngineEventMap>(
    event: E,
    callback: (data: EngineEventMap[E]) => void,
  ): void {
    this.events.on(event, callback);
  }

  off<E extends keyof EngineEventMap>(
    event: E,
    callback: (data: EngineEventMap[E]) => void,
  ): void {
    this.events.off(event, callback);
  }

  dispose(): void {
    this.stopTimeUpdates();
    this.cancelScheduledTransition();
    this.mediaSession?.dispose();
    this.backend.dispose();
    this.events.removeAllListeners();
    this.stateMachine.reset();
  }

  private readonly handleMediaTrackChange = (data: {
    from: Track | null;
    to: Track | null;
  }): void => {
    void this.mediaSession?.updateMetadata(data.to);
    this.syncMediaSession();
  };

  private readonly syncMediaSession = (): void => {
    const mediaSession = this.mediaSession;
    if (!mediaSession) return;

    const state = this.stateMachine.getState();
    mediaSession.setPlaybackState(
      state === "playing" || state === "transitioning"
        ? "playing"
        : state === "paused"
          ? "paused"
          : "none",
    );

    if (this.duration > 0) {
      mediaSession.setPositionState(
        this.duration,
        this.currentTime,
        this.settings.tempo,
      );
    }
  };

  private async loadAndPlay(track: Track): Promise<void> {
    await this.load(track);
    await this.play();
  }

  private async waitForState(
    targetState: PlayerState,
    timeout = 5000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.events.off("statechange", onStateChange);
        reject(new Error(`Timeout waiting for state: ${targetState}`));
      }, timeout);

      const onStateChange = () => {
        if (settled) return;
        if (this.stateMachine.getState() === targetState) {
          settled = true;
          clearTimeout(timeoutId);
          this.events.off("statechange", onStateChange);
          resolve();
        } else if (this.stateMachine.hasError()) {
          settled = true;
          clearTimeout(timeoutId);
          this.events.off("statechange", onStateChange);
          const reason = this.currentError
            ? `Engine entered error state: ${this.currentError.code}`
            : "Engine entered error state";
          reject(new Error(reason));
        }
      };

      if (this.stateMachine.getState() === targetState) {
        onStateChange();
        return;
      }
      if (this.stateMachine.hasError()) {
        onStateChange();
        return;
      }

      this.events.on("statechange", onStateChange);
    });
  }

  private handleTimeUpdate(time: number): void {
    this.currentTime = time;

    if (this.stateMachine.isPlaying()) {
      this.checkScheduledTransition(time);
      this.maybePrefetchDuringPlayback();
    }

    this.emitTimeUpdate();
  }

  private maybePrefetchDuringPlayback(): void {
    if (this.prefetchSentinel || !this.preloadManager) return;
    if (!this.scheduler.shouldPreload(this.currentTime, this.duration)) return;

    this.prefetchSentinel = true;
    const track = this.queue.getCurrentTrack();
    if (track) {
      this.prefetchUpcoming(track);
    }
  }

  private prefetchUpcoming(track: Track): void {
    const preloadManager = this.preloadManager;
    if (!preloadManager) return;

    const tracks = this.queue.getTracks();
    const index = tracks.findIndex((candidate) => candidate.id === track.id);
    if (index < 0) return;

    preloadManager.preloadNext(tracks, index);
  }

  private async resolveSource(track: Track): Promise<Track> {
    const preloadedUrl = this.preloadManager?.getUrl(track.id);
    if (preloadedUrl) {
      return { ...track, url: preloadedUrl };
    }
    return this.trackResolver ? await this.trackResolver(track) : track;
  }

  private replayGainForTrack(track: Track): number | null {
    if (!this.settings.replayGainEnabled) return null;

    const replayGain = track.replayGain;
    if (!replayGain) return null;

    const mode = this.settings.replayGainMode;
    const gainDb =
      mode === "track"
        ? replayGain.trackGain
        : mode === "album"
          ? replayGain.albumGain
          : (replayGain.trackGain ?? replayGain.albumGain);

    if (typeof gainDb !== "number" || !Number.isFinite(gainDb)) return null;
    return gainDb + this.settings.replayGainPreampDb;
  }

  private refreshReplayGain(): void {
    const track = this.queue.getCurrentTrack();
    this.backend.setReplayGain?.(track ? this.replayGainForTrack(track) : null);
  }

  private checkScheduledTransition(currentTime: number): void {
    if (this.scheduledTransitionId !== null || this.crossfadeSource !== null) {
      return;
    }

    const track = this.queue.getCurrentTrack();
    if (!track) return;

    if (this.scheduler.shouldTriggerTransition(currentTime, track)) {
      this.scheduleTransition(track);
    }
  }

  private scheduleTransition(_track: Track): void {
    if (this.scheduledTransitionId !== null) return;

    this.stateMachine.transition("transitioning");

    const nextTrack = this.queue.getNextTrack(this.settings.smartShuffle);
    if (!nextTrack) {
      if (this.stateMachine.canTransition("ready")) {
        this.stateMachine.transition("ready");
      }
      return;
    }

    const mode = this.scheduler.getMode();
    const isCrossfade = mode === "crossfade" && this.settings.crossfade > 0;
    const delay = isCrossfade
      ? 0
      : mode === "gapless"
        ? 100
        : this.settings.crossfade * SECONDS_TO_MS;

    this.scheduledTransitionId = window.setTimeout(() => {
      this.scheduledTransitionId = null;
      void this.executeTransition(nextTrack);
    }, delay);
  }

  private async executeTransition(nextTrack: Track): Promise<void> {
    const currentTrack = this.queue.getCurrentTrack();
    const isCrossfade =
      this.scheduler.getMode() === "crossfade" &&
      this.settings.crossfade > 0 &&
      this.canCrossfade();

    if (isCrossfade) {
      const crossfaded = await this.tryCrossfade(nextTrack);
      if (crossfaded) {
        if (currentTrack) {
          this.events.emit("ended", { track: currentTrack });
        }
        if (this.stateMachine.canTransition("playing")) {
          this.stateMachine.transition("playing");
          this.emitStateChange();
        }
        return;
      }
      logger.warn("Crossfade failed, falling back to hard transition", {
        track: nextTrack.title,
      });
    } else {
      logger.debug("Hard transition scheduled", {
        mode: this.scheduler.getMode(),
        crossfade: this.settings.crossfade,
      });
    }

    await this.loadAndPlay(nextTrack);

    if (currentTrack) {
      this.events.emit("ended", { track: currentTrack });
    }

    if (this.stateMachine.canTransition("playing")) {
      this.stateMachine.transition("playing");
    }
  }

  private async tryCrossfade(nextTrack: Track): Promise<boolean> {
    const { createCrossfadeSource, commitCrossfadeSource, setOutputGain } =
      this.backend;
    if (!createCrossfadeSource || !commitCrossfadeSource || !setOutputGain) {
      return false;
    }

    let url: string;
    try {
      const target = await this.resolveSource(nextTrack);
      url = target.url;
      if (typeof url !== "string" || url.length === 0) return false;
    } catch {
      return false;
    }

    let source: CrossfadeSource | null;
    try {
      source = await createCrossfadeSource.call(this.backend, url, nextTrack);
    } catch (error) {
      logger.warn("Crossfade source creation failed", {
        error: String(error),
      });
      return false;
    }
    if (!source) return false;

    const previousTrack = this.queue.getCurrentTrack();
    const trackIndex = this.queue
      .getTracks()
      .findIndex((candidate) => candidate.id === nextTrack.id);
    this.queue.jumpToIndex(trackIndex >= 0 ? trackIndex : null);

    this.crossfadeSource = source;
    this.duration = source.getDuration?.() || nextTrack.duration;
    this.currentTime = 0;

    this.emitTrackChange(previousTrack, nextTrack);
    this.prefetchSentinel = false;
    this.events.emit("durationchange", { duration: this.duration });
    this.prefetchUpcoming(nextTrack);

    this.startCrossfadeLoop(
      source,
      commitCrossfadeSource.bind(this.backend),
      setOutputGain.bind(this.backend),
    );
    return true;
  }

  private canCrossfade(): boolean {
    return (
      this.backend.createCrossfadeSource !== undefined &&
      this.backend.commitCrossfadeSource !== undefined &&
      this.backend.setOutputGain !== undefined
    );
  }

  private startCrossfadeLoop(
    source: CrossfadeSource,
    commit: (source: CrossfadeSource) => void,
    setOutgoingGain: (value: number) => void,
  ): void {
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    const stale = this.crossfadeSource;
    if (stale && stale !== source) {
      stale.dispose();
    }
    this.crossfadeSource = source;

    const crossfader = this.scheduler.getCrossfade();
    const durationMs = Math.max(50, this.settings.crossfade * SECONDS_TO_MS);
    const startTime = performance.now();

    const finish = (): void => {
      if (this.crossfadeSource !== source) return;

      if (this.crossfadeTimer !== null) {
        clearTimeout(this.crossfadeTimer);
        this.crossfadeTimer = null;
      }
      this.crossfadeSource = null;
      this.crossfadeFinish = null;
      commit(source);

      const committedDuration = this.backend.getDuration();
      if (committedDuration > 0 && committedDuration !== this.duration) {
        this.duration = committedDuration;
        this.events.emit("durationchange", { duration: this.duration });
      }
      this.currentTime = this.backend.getCurrentTime();
      this.syncMediaSession();
    };

    this.crossfadeFinish = finish;

    const step = (): void => {
      if (this.crossfadeSource !== source) return;

      const progress = Math.min(
        1,
        (performance.now() - startTime) / durationMs,
      );
      const { fromVolume, toVolume } = crossfader.calculateVolumes(progress);
      setOutgoingGain(fromVolume);
      source.setOutputGain(toVolume);

      if (progress < 1) {
        this.crossfadeTimer = window.setTimeout(step, 16);
        return;
      }

      finish();
    };

    this.crossfadeTimer = window.setTimeout(step, 0);
  }

  private cancelCrossfadeLoop(): void {
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    const source = this.crossfadeSource;
    if (source) {
      this.crossfadeSource = null;
      source.dispose();
    }
    this.crossfadeFinish = null;
  }

  private cancelScheduledTransition(): void {
    this.cancelCrossfadeLoop();

    if (this.scheduledTransitionId !== null) {
      clearTimeout(this.scheduledTransitionId);
      this.scheduledTransitionId = null;
    }

    if (this.stateMachine.isTransitioning()) {
      this.stateMachine.transition("ready");
    }
  }

  private handleTrackEnded(): void {
    if (this.stateMachine.isTransitioning()) {
      return;
    }

    const track = this.queue.getCurrentTrack();
    if (track) {
      this.events.emit("ended", { track: track });
    }

    if (this.settings.repeat === "one") {
      this.seek(0);
      this.play();
      return;
    }

    if (this.settings.autoPlayNext) {
      this.next();
    } else if (this.stateMachine.canTransition("ready")) {
      this.stateMachine.transition("ready");
      this.emitStateChange();
    }
  }

  private handleError(error: Error): void {
    this.emitError("BACKEND_ERROR", error.message);
  }

  private handleDurationChange(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration === this.duration) return;
    this.duration = duration;
    this.events.emit("durationchange", { duration });
  }

  private startTimeUpdates(): void {
    if (this.timeUpdateInterval) return;

    this.timeUpdateInterval = window.setInterval(() => {
      const state = this.stateMachine.getState();
      if (state === "playing" || state === "transitioning") {
        this.handleTimeUpdate(this.getPlayheadTime());
      }
    }, 100);
  }

  private getPlayheadTime(): number {
    if (this.crossfadeSource) {
      return this.crossfadeSource.getCurrentTime();
    }
    return this.backend.getCurrentTime();
  }

  private stopTimeUpdates(): void {
    if (this.timeUpdateInterval !== null) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }

  private emitStateChange(): void {
    const prevState = this.stateMachine.getPreviousState();
    const newState = this.stateMachine.getState();
    this.events.emit("statechange", {
      oldState: prevState ?? "idle",
      newState,
    });
  }

  private emitTrackChange(from: Track | null, to: Track | null): void {
    this.events.emit("trackchange", { from, to });
  }

  private emitTimeUpdate(): void {
    this.events.emit("timeupdate", {
      currentTime: this.currentTime,
      duration: this.duration,
    });
  }

  private emitError(code: string, message: string, track?: Track): void {
    this.currentError = { code, message, track };
    if (this.stateMachine.canTransition("error")) {
      this.stateMachine.transition("error");
    }
    this.events.emit("error", { error: this.currentError });
    this.emitStateChange();
  }
}
