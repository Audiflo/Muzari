import { BaseAudioBackend } from "./BaseBackend";
import { HTMLAudioBackend } from "./HTMLBackend";
import { StreamingDecoderBackend } from "./StreamingDecoderBackend";
import { AudioGraph } from "../graph";
import { isSafari } from "../../utils/safari";
import { chooseBackendFor, identifyFormat, type BackendKind } from "../formats";
import { sniffAudioFailure, trackCodecFailure } from "../playability";
import type { CrossfadeSource, IAudioBackend } from "../index";
import type { Track } from "../../../core/engine/types";
import { createLogger, describeError } from "../../../helpers/logger";

const logger = createLogger("backendRouter");

export interface BackendRouterBackends {
  html: IAudioBackend;
  flo: IAudioBackend;
  symphonia: IAudioBackend;
  createPartner?: (kind: BackendKind) => IAudioBackend | null;
}

export type { BackendKind };

export function chooseBackendKind(track?: Track, url?: string): BackendKind {
  if (!track) {
    return url?.includes(".flo") ? "flo" : "html";
  }

  const nameHint = track.fileName || track.url || track.title;
  const format = identifyFormat(
    nameHint,
    track.mimeType ?? "",
    track.encoding?.codec,
  );

  return chooseBackendFor(format, {
    hasStoredAudio: track.hasStoredAudio === true,
    isSafariRuntime: isSafari(),
  });
}

export function crossfadePartnerKinds(
  track: Track | undefined,
  url: string | undefined,
  currentKind: BackendKind,
): BackendKind[] {
  const mappedKind = chooseBackendKind(track, url);
  return [...new Set<BackendKind>([mappedKind, currentKind, "html"])];
}

export class BackendRouter extends BaseAudioBackend {
  readonly graph: AudioGraph;
  private htmlBackend: IAudioBackend;
  private floBackend: IAudioBackend;
  private symphoniaBackend: IAudioBackend;
  private current: IAudioBackend;
  private volume = 1;
  private playbackRate = 1;
  private pitch = 0;
  private replayGain: number | null = null;

  private pendingCrossfade: {
    source: CrossfadeSource;
    partner: IAudioBackend;
    kind: BackendKind;
    outgoing: IAudioBackend;
  } | null = null;
  private crossfadeGeneration = 0;
  private readonly partnerFactory?: (
    kind: BackendKind,
  ) => IAudioBackend | null;

  constructor(graph?: AudioGraph, backends?: Partial<BackendRouterBackends>) {
    super();
    this.graph = graph ?? new AudioGraph();

    this.htmlBackend = backends?.html ?? new HTMLAudioBackend(this.graph);
    this.floBackend =
      backends?.flo ?? new StreamingDecoderBackend(this.graph, "flo");
    this.symphoniaBackend =
      backends?.symphonia ??
      new StreamingDecoderBackend(this.graph, "symphonia");
    this.current = this.htmlBackend;
    this.partnerFactory = backends?.createPartner;
    this.subscribe(this.current);
  }

  async load(url: string, track?: Track): Promise<void> {
    this.discardPendingCrossfade();

    switch (chooseBackendKind(track, url)) {
      case "flo":
        await this.switchTo(this.floBackend, url, track);
        break;
      case "symphonia":
        try {
          await this.switchTo(this.symphoniaBackend, url, track);
        } catch (symphoniaError) {
          logger.warn("Symphonia backend rejected the track", {
            kind: "symphonia",
            track: track?.title,
            error: describeError(symphoniaError),
          });
          try {
            await this.assertHtmlPlayable(url, track);
            await this.switchTo(this.htmlBackend, url, track);
          } catch (htmlError) {
            throw new Error(
              `backend load failed: symphonia rejected the track, then html failed: ${String(htmlError)}`,
              { cause: symphoniaError },
            );
          }
        }
        break;
      case "html":
        await this.assertHtmlPlayable(url, track);
        await this.switchTo(this.htmlBackend, url, track);
        break;
    }
  }

  async play(): Promise<void> {
    await this.current.play();
  }

  pause(): void {
    this.current.pause();
  }

  stop(): void {
    this.discardPendingCrossfade();
    this.current.stop();
  }

  seek(time: number): void {
    this.discardPendingCrossfade();
    this.current.seek(time);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.current.setVolume(volume);
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    this.current.setPlaybackRate(rate);
  }

  setOutputGain(value: number): void {
    this.current.setOutputGain?.(value);
  }

  canSetOutputGain(): boolean {
    return this.supportsOutputGain(this.current);
  }

  setPitch(semitones: number): void {
    this.pitch = semitones;
    void this.graph.setPitch(semitones);
  }

  setReplayGain(gainDb: number | null): void {
    this.replayGain = gainDb;
    this.graph.setReplayGain(gainDb);
  }

  async createCrossfadeSource(
    url: string,
    track?: Track,
  ): Promise<CrossfadeSource | null> {
    this.discardPendingCrossfade();
    const generation = this.crossfadeGeneration;

    const outgoing = this.current;
    const kinds = crossfadePartnerKinds(track, url, this.currentKind());
    if (!this.supportsOutputGain(outgoing)) {
      logger.warn("Crossfade declined", { kinds, currentHasOutputGain: false });
      return null;
    }

    outgoing.offEnded(this.forwardEnded);

    for (const kind of kinds) {
      const partner = this.createPartner(kind);
      if (!partner) continue;
      if (!this.supportsOutputGain(partner)) {
        partner.dispose();
        continue;
      }

      this.configurePartner(partner);
      try {
        await partner.load(url, track);
        if (this.crossfadeGeneration !== generation) {
          partner.dispose();
          break;
        }
        partner.seek(0);
        partner.setOutputGain?.(0);
        await partner.play();
        if (this.crossfadeGeneration !== generation) {
          partner.dispose();
          break;
        }
      } catch (error) {
        logger.warn("Crossfade partner load/play failed", {
          kind,
          error: String(error),
        });
        partner.dispose();
        continue;
      }

      const source: CrossfadeSource = {
        setOutputGain: (value) => partner.setOutputGain?.(value),
        getCurrentTime: () => partner.getCurrentTime(),
        getDuration: () => partner.getDuration(),
        dispose: () => this.discardPendingCrossfade(),
      };
      this.pendingCrossfade = { source, partner, kind, outgoing };
      logger.debug("Crossfade engaged", { kind });
      return source;
    }

    outgoing.onEnded(this.forwardEnded);
    logger.warn("Crossfade failed, no partner available", { kinds });
    return null;
  }

  commitCrossfadeSource(source: CrossfadeSource): void {
    const pending = this.pendingCrossfade;
    if (!pending || pending.source !== source) return;
    this.pendingCrossfade = null;

    const { partner, kind, outgoing } = pending;
    this.unsubscribe(outgoing);
    this.subscribe(partner);
    partner.setOutputGain?.(1);
    outgoing.setOutputGain?.(0);
    this.current = partner;
    this.replacePrimary(kind, partner);
    logger.debug("Using backend", {
      kind: this.kindOf(partner),
      switched: true,
      via: "crossfade",
    });
    outgoing.dispose();
  }

  private discardPendingCrossfade(): void {
    this.crossfadeGeneration += 1;

    const pending = this.pendingCrossfade;
    if (!pending) return;
    this.pendingCrossfade = null;

    const { partner, outgoing } = pending;
    partner.dispose();
    outgoing.setOutputGain?.(1);
    outgoing.onEnded(this.forwardEnded);
  }

  private configurePartner(target: IAudioBackend): void {
    target.setVolume(this.volume);
    target.setPlaybackRate(this.playbackRate);
    target.setPitch?.(this.pitch);
    target.setReplayGain?.(this.replayGain);
    target.setOutputGain?.(0);
  }

  getEqualizer(): import("../equalizer").Equalizer {
    return this.graph.getEqualizer();
  }

  setEqualizer(enabled: boolean): void {
    this.graph.setEqualizer(enabled);
  }

  updateEqualizer(): void {
    this.graph.updateEqualizer();
  }

  getCurrentTime(): number {
    return this.current.getCurrentTime();
  }

  getDuration(): number {
    return this.current.getDuration();
  }

  getAnalyser(): AnalyserNode | null {
    return this.graph.getAnalyser();
  }

  private readonly forwardDurationChange = (duration: number) => {
    this.emitDurationChange(duration);
  };

  private subscribe(backend: IAudioBackend): void {
    backend.onEnded(this.forwardEnded);
    backend.onError(this.forwardError);
    backend.onDurationChange?.(this.forwardDurationChange);
  }

  private unsubscribe(backend: IAudioBackend): void {
    backend.offEnded(this.forwardEnded);
    backend.offError(this.forwardError);
    backend.offDurationChange?.(this.forwardDurationChange);
  }

  private async assertHtmlPlayable(url: string, track?: Track): Promise<void> {
    const failure =
      (track ? trackCodecFailure(track) : null) ??
      (await sniffAudioFailure(url, {
        hasStoredAudio: track?.hasStoredAudio === true,
      }));
    if (failure) {
      throw new Error(
        `Cannot play "${track?.title ?? "this track"}": ${failure.codecName} is not supported by ${failure.browser}. Convert the file to FLAC, MP3, or AAC, or use Safari.`,
      );
    }
  }

  private kindOf(backend: IAudioBackend): BackendKind {
    if (backend === this.htmlBackend) return "html";
    if (backend === this.floBackend) return "flo";
    if (backend === this.symphoniaBackend) return "symphonia";
    return "html";
  }

  private supportsOutputGain(backend: IAudioBackend): boolean {
    return backend.canSetOutputGain?.() ?? Boolean(backend.setOutputGain);
  }

  private currentKind(): BackendKind {
    return this.kindOf(this.current);
  }

  private createPartner(kind: BackendKind): IAudioBackend | null {
    if (this.partnerFactory) return this.partnerFactory(kind);
    if (kind === "flo") {
      if (this.floBackend instanceof StreamingDecoderBackend) {
        return new StreamingDecoderBackend(this.graph, "flo");
      }
    } else if (kind === "symphonia") {
      if (this.symphoniaBackend instanceof StreamingDecoderBackend) {
        return new StreamingDecoderBackend(this.graph, "symphonia");
      }
    } else if (
      kind === "html" &&
      this.htmlBackend instanceof HTMLAudioBackend
    ) {
      return new HTMLAudioBackend(this.graph);
    }
    return null;
  }

  private replacePrimary(kind: BackendKind, backend: IAudioBackend): void {
    switch (kind) {
      case "flo":
        this.floBackend = backend;
        break;
      case "symphonia":
        this.symphoniaBackend = backend;
        break;
      case "html":
        this.htmlBackend = backend;
        break;
    }
  }
  private readonly forwardEnded = () => {
    this.emitEnded();
  };
  private readonly forwardError = (error: Error) => {
    this.emitError(error);
  };

  private async switchTo(
    backend: IAudioBackend,
    url: string,
    track?: Track,
  ): Promise<void> {
    const kind = this.kindOf(backend);
    const switched = backend !== this.current;
    if (switched) {
      this.activate(backend);
    }

    backend.setVolume(this.volume);
    backend.setPlaybackRate(this.playbackRate);
    backend.setPitch?.(this.pitch);
    backend.setReplayGain?.(this.replayGain);

    logger.debug("Using backend", {
      kind,
      switched,
      track: track?.title,
      url,
    });

    await backend.load(url, track);
  }

  private activate(backend: IAudioBackend): void {
    const previous = this.current;
    this.unsubscribe(previous);
    this.safeStop(previous);

    for (const sink of this.primaries()) {
      if (sink !== backend && sink !== previous) {
        this.safeStop(sink);
      }
    }

    this.current = backend;
    this.subscribe(backend);
  }

  private primaries(): IAudioBackend[] {
    return [this.htmlBackend, this.floBackend, this.symphoniaBackend];
  }

  private safeStop(backend: IAudioBackend): void {
    try {
      backend.stop();
    } catch (error) {
      logger.warn("Backend stop failed during switch", {
        kind: this.kindOf(backend),
        error: describeError(error),
      });
    }
  }

  dispose(): void {
    this.discardPendingCrossfade();
    this.htmlBackend.dispose();
    this.floBackend.dispose();
    this.symphoniaBackend.dispose();
    this.graph.dispose();
    this.current = this.htmlBackend;
    super.dispose();
  }
}
