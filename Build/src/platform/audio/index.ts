import type {
  CrossfadeSource as KomorebiCrossfadeSource,
  IAudioBackend as KomorebiAudioBackend,
} from "@audiflo/komorebi";

export type CrossfadeSource = KomorebiCrossfadeSource;

export interface IAudioBackend extends KomorebiAudioBackend {
  /**
   * @param url Playable source (blob or http url) for the track.
   * @param track The track being loaded, when the caller knows it. Backends
   *   use it to make routing/decoding decisions (e.g. native flo) without
   *   having to infer the format from the url, which is often a blob url.
   */
  canSetOutputGain?(): boolean;
  onDurationChange?(callback: (duration: number) => void): void;
  offDurationChange?(callback: (duration: number) => void): void;
  offEnded(callback: () => void): void;
  offError(callback: (error: Error) => void): void;
}
