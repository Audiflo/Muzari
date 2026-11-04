import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/engine/index.ts",
    "src/formats/index.ts",
    "src/audio/streaming.ts",
    "src/audio/effects.ts",
    "src/integrations/mediaSession.ts",
    "src/integrations/audioSession.ts",
  ],
  outDir: "dist",
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2020",
  platform: "neutral",
  sourcemap: true,
});
