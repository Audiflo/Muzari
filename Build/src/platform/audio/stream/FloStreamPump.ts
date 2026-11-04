import initFlo, { WasmStreamingDecoder } from "@audiflo/libflo";
import type { AudioStream, StreamChunk, StreamInfo } from "@audiflo/komorebi";

export interface FloStreamInfo {
  sample_rate: number;
  channels: number;
  bit_depth: number;
  total_samples?: bigint;
}

export interface FloStreamDecoderProtocol {
  feed(chunk: Uint8Array): boolean;
  get_info(): FloStreamInfo | null;
  has_error(): boolean;
  next_frame(): Float32Array | null;
  is_finished(): boolean;
  free(): void;
  end_of_input?(): void;
  error_message?(): string | null;
}

export interface FloStreamResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export type FloStreamFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<FloStreamResponse>;

export interface FloStreamPumpEvents {
  onInfo?(info: FloStreamInfo): void;
  onChunk?(chunk: Float32Array): void;
  onEnd?(): void;
  onError?(error: Error): void;
  onStreamInfo?(info: StreamInfo): void;
  onStreamChunk?(chunk: StreamChunk): void;
}

const DECODER_ERROR_MESSAGE = "decoder reported an error";

const MAX_STALLED_DRAIN_ROUNDS = 64;

const defaultFetcher: FloStreamFetcher = (url, signal) =>
  fetch(url, { signal }) as Promise<FloStreamResponse>;

export class FloStreamPump implements AudioStream {
  private readonly url: string;
  private readonly events: FloStreamPumpEvents;
  private readonly decoder: FloStreamDecoderProtocol;
  private readonly fetcher: FloStreamFetcher;
  private readonly controller = new AbortController();
  private cancelledState = false;
  private framesDecodedState = 0;
  private channels = 0;
  private skipping = false;
  private skipTarget = 0;
  private failure: Error | null = null;
  private firstAudioReady: (() => void) | null = null;
  private paused = false;
  private stalledDrainRounds = 0;
  private resumeSignal: (() => void) | null = null;

  constructor(options: {
    url: string;
    decoder: FloStreamDecoderProtocol;
    events?: FloStreamPumpEvents;
    fetcher?: FloStreamFetcher;
  }) {
    this.url = options.url;
    this.decoder = options.decoder;
    this.events = options.events ?? {};
    this.fetcher = options.fetcher ?? defaultFetcher;
  }

  start(skipToFrames = 0): Promise<void> {
    this.skipping = skipToFrames > 0;
    this.skipTarget = skipToFrames;

    const firstAudio = new Promise<void>((resolve) => {
      this.firstAudioReady = resolve;
    });

    void this.run();

    return firstAudio;
  }

  get frames(): number {
    return this.framesDecodedState;
  }

  get framesDecoded(): number {
    return this.frames;
  }

  get isCancelled(): boolean {
    return this.cancelledState;
  }

  get cancelled(): boolean {
    return this.isCancelled;
  }

  cancel(): void {
    this.cancelledState = true;
    this.paused = false;
    this.resumeSignal?.();
    this.resumeSignal = null;
    this.firstAudioReady?.();
    this.controller.abort();
    this.decoder.free?.();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
  }

  private waitWhilePaused(): Promise<void> {
    if (!this.paused || this.cancelledState) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resumeSignal = resolve;
    });
  }

  private async run(): Promise<void> {
    let response: FloStreamResponse;
    try {
      response = await this.fetcher(this.url, this.controller.signal);
    } catch (error) {
      if (this.cancelledState) return;
      this.fail(error as Error);
      return;
    }

    if (!response.ok || response.body === null) {
      if (!this.cancelledState) {
        this.fail(new Error(`HTTP ${response.status}`));
      }
      return;
    }

    const reader = response.body.getReader();
    try {
      for (;;) {
        if (this.cancelledState) {
          await this.silenceReader(reader);
          return;
        }
        await this.waitWhilePaused();
        if (this.cancelledState) {
          await this.silenceReader(reader);
          return;
        }
        const { value, done } = await reader.read();
        if (this.cancelledState) {
          await this.silenceReader(reader);
          return;
        }
        if (done) break;

        if (value.length > 0) {
          this.decoder.feed(value);
          if (this.decoder.has_error()) {
            this.fail(this.decodeError());
            return;
          }
          this.drain();
        }
        await this.yieldToMain();
      }

      if (this.cancelledState) return;
      this.decoder.end_of_input?.();
      await this.drainUntilFinished();
      if (this.cancelledState) return;
      this.firstAudioReady?.();
      this.events.onEnd?.();
    } catch (error) {
      if (!this.cancelledState) {
        this.fail(error as Error);
      }
    }
  }

  private async drainUntilFinished(): Promise<void> {
    for (;;) {
      const before = this.framesDecodedState;
      await this.waitWhilePaused();
      if (this.cancelledState) return;
      this.drain();
      if (this.cancelledState) return;
      if (this.decoder.has_error()) {
        this.fail(this.decodeError());
        return;
      }
      if (this.decoder.is_finished()) return;
      if (this.framesDecodedState === before) {
        if (this.paused) {
          this.stalledDrainRounds = 0;
        } else if (++this.stalledDrainRounds >= MAX_STALLED_DRAIN_ROUNDS) {
          return;
        }
      } else {
        this.stalledDrainRounds = 0;
      }
      await this.yieldToMain();
    }
  }

  private decodeError(): Error {
    const detail = this.decoder.error_message?.();
    return new Error(detail || DECODER_ERROR_MESSAGE);
  }

  private drain(): void {
    for (;;) {
      if (this.paused || this.cancelledState) break;
      if (this.channels === 0) {
        const info = this.decoder.get_info();
        if (info && info.channels > 0) {
          this.channels = info.channels;
          this.events.onInfo?.(info);
          this.events.onStreamInfo?.({
            sampleRate: info.sample_rate,
            channels: info.channels,
            bitDepth: info.bit_depth,
            totalSamples: info.total_samples,
          });
        }
      }

      const chunk = this.decoder.next_frame();
      if (chunk == null || chunk.length === 0) break;

      if (this.channels === 0) {
        this.framesDecodedState += 1;
        continue;
      }

      const chunkFrames = Math.floor(chunk.length / this.channels);
      if (
        this.skipping &&
        this.framesDecodedState + chunkFrames < this.skipTarget
      ) {
        this.framesDecodedState += chunkFrames;
        continue;
      }

      let block = chunk;
      if (this.skipping) {
        const offset = Math.max(0, this.skipTarget - this.framesDecodedState);
        const cut = Math.min(offset, chunkFrames);
        block = chunk.subarray(cut * this.channels);
        this.framesDecodedState += chunkFrames;
        this.skipping = false;
        if (block.length === 0) continue;
      } else {
        this.framesDecodedState += chunkFrames;
      }

      this.events.onChunk?.(block);
      this.events.onStreamChunk?.({
        data: block,
        frames: Math.floor(block.length / this.channels),
        channels: this.channels,
      });
      this.firstAudioReady?.();
      this.firstAudioReady = null;
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.firstAudioReady?.();
    this.events.onError?.(error);
  }

  private async silenceReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      await reader.cancel();
    } catch {}
  }

  private async yieldToMain(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

let floWasmReady: Promise<void> | null = null;

export const ensureFloWasmLoaded = (): Promise<void> => {
  if (!floWasmReady) {
    floWasmReady = initFlo().then(
      () => undefined,
      (error) => {
        floWasmReady = null;
        throw new Error(`flo wasm init failed: ${String(error)}`);
      },
    );
  }
  return floWasmReady;
};

export const createRealStreamingDecoder = (): FloStreamDecoderProtocol => {
  if (!floWasmReady) {
    throw new Error(
      "flo wasm module not initialized; await ensureFloWasmLoaded() first",
    );
  }
  return new WasmStreamingDecoder();
};
