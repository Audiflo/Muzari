import type { CrossfadeShape, EngineSettings } from "./types";

export const DEFAULT_ENGINE_SETTINGS: Readonly<EngineSettings> = Object.freeze({
  volume: 1,
  crossfade: 0,
  autoPlayNext: true,
  tempo: 1,
  pitch: 0,
  gaplessPlayback: false,
  smartShuffle: true,
  repeat: "off",
  defaultShuffle: false,
  defaultRepeat: "off",
  replayGainEnabled: true,
  replayGainPreampDb: 0,
  replayGainMode: "auto",
});

export const DEFAULT_CROSSFADE_SHAPE: CrossfadeShape = "equalpower";
