# Komorebi

Komorebi is a platform-agnostic playback core for music applications.

Applications provide their own audio backend, storage, and UI integration
around these core types and state helpers.

## Status

The package exposes `KomorebiEngine` and the reusable engine model: tracks and
playlists, queue management, shuffle, scheduling, state transitions, events,
validation, and default settings. It also owns pure audio format
identification, decoder/streaming contracts, audio-effects contracts, and
platform-neutral Media Session and audio-session contracts.

Applications provide an `IAudioBackend` and concrete platform adapters.
Browser APIs, WASM decoders, workers, AudioWorklets, storage, and UI remain
outside Komorebi. The streaming interfaces deliberately describe lifecycle
and decoded output without requiring `ReadableStream`, `Worker`, or a
particular decoder.

Muzari implements these contracts with its HTML audio, Flo, Symphonia,
Web Audio, Tone.js, and browser Media Session adapters.

## Development

```sh
npm run typecheck
npm run build
```

continued...
