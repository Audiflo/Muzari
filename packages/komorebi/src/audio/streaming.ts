import type { Track } from "../engine/types";

export interface StreamInfo {
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  totalSamples?: bigint;
}

export interface StreamChunk {
  data: Float32Array;
  frames: number;
  channels: number;
}

export interface StreamEvents {
  onInfo?(info: StreamInfo): void;
  onChunk?(chunk: StreamChunk): void;
  onEnd?(): void;
  onError?(error: Error): void;
}

export interface AudioStream {
  start(skipToFrames?: number): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  readonly framesDecoded: number;
  readonly cancelled: boolean;
}

export interface StreamDecoder {
  createStream(track: Track, events: StreamEvents): AudioStream;
  dispose?(): void;
}

export interface DecoderCapability {
  id: string;
  canDecode(track: Track): boolean;
  createDecoder(track: Track): StreamDecoder | null;
}

export class DecoderRegistry {
  private readonly capabilities: DecoderCapability[] = [];

  register(capability: DecoderCapability): () => void {
    const existing = this.capabilities.findIndex(
      (candidate) => candidate.id === capability.id,
    );
    if (existing >= 0) {
      this.capabilities.splice(existing, 1);
    }
    this.capabilities.push(capability);
    return () => this.unregister(capability.id);
  }

  unregister(id: string): void {
    const index = this.capabilities.findIndex(
      (capability) => capability.id === id,
    );
    if (index >= 0) {
      this.capabilities.splice(index, 1);
    }
  }

  find(track: Track): DecoderCapability | null {
    return (
      this.capabilities.find((capability) => capability.canDecode(track)) ??
      null
    );
  }

  createStream(track: Track, events: StreamEvents): AudioStream | null {
    const capability = this.find(track);
    const decoder = capability?.createDecoder(track);
    return decoder?.createStream(track, events) ?? null;
  }
}

export interface StreamSource {
  url: string;
  track?: Track;
  signal?: AbortSignal;
}

export interface StreamingBackend {
  load(source: StreamSource): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  dispose(): void;
}
