# Komorebi

Reusable audio playback infrastructure for web and desktop applications.

Komorebi is the reusable playback core from [Muzari](https://github.com/Audiflo/Muzari). It handles playback, queues, track transitions, scheduling, format detection, and audio-related interfaces. Applications provide their own audio backend and platform integrations.

## Features

- `KomorebiEngine` for loading, playing, pausing, seeking, stopping, and switching tracks.
- Queue and playlist management, including shuffle and repeat modes.
- Gapless playback and equal-power crossfades.
- Playback state, events, validation, and default settings.
- Audio format detection using file extensions, MIME types, and codec hints.
- Interfaces for decoders, streaming, audio effects, Media Session, and audio sessions.
- Track preloading and equalizer models.
- ReplayGain parsing and conversion.
- Injectable logging, with [Satori](https://github.com/Nisoku/Satori) as the default logger.

## Installation

```sh
npm install @audiflo/komorebi
```

## How it fits together

Komorebi handles playback logic. The application handles the actual audio output and platform-specific functionality.

```text
Your application (e.g. Muzari)
├── Audio backend and decoder
├── Audio effects
├── Storage and track URL resolution
├── Media Session integration
└── UI and application state
        |
        ▼
@audiflo/komorebi
├── Playback engine
├── Queue and scheduling
├── Format detection
├── Decoder and streaming interfaces
└── Audio models and utilities
```

Komorebi does not depend on a particular audio implementation. Applications can use HTML audio, Web Audio, WASM decoders, native audio APIs, or their own implementations.

## Imports

Most functionality is available from the package root:

```ts
import {
  KomorebiEngine,
  DecoderRegistry,
  identifyFormat,
  type IAudioBackend,
} from "@audiflo/komorebi";
```

Individual modules can also be imported directly:

```ts
import { identifyFormat } from "@audiflo/komorebi/formats";
import { DecoderRegistry } from "@audiflo/komorebi/audio/streaming";
import { clampPitch } from "@audiflo/komorebi/audio/effects";
import type { MediaSessionAdapter } from
  "@audiflo/komorebi/integrations/media-session";
```

To use `KomorebiEngine`, provide an implementation of `IAudioBackend`. It handles media loading and audio output, while Komorebi manages playback state and behavior.

## Development

Run these commands from `packages/komorebi`:

```sh
npm install
npm run typecheck
npm run build
npm pack --dry-run
```

The package is bundled with [tsdown](https://tsdown.dev/) and emits ESM
JavaScript, source maps, and declaration files for the public entry points.

## Used by Muzari

[Muzari](https://github.com/Audiflo/Muzari) is the first application to use Komorebi.

Muzari provides the browser-specific implementations, including HTML audio, WASM decoders, Web Audio, Tone.js, Media Session, storage, and its React/Zustand application layer.

Komorebi is maintained as a separate package and can be used without Muzari.

## License

MPL-2.0. See [LICENSE](./LICENSE) for details.
