# Komorebi

Komorebi is a platform-agnostic playback core for music applications.

Applications provide their own audio backend, storage, and UI integration
around these core types and state helpers.

## Status

The package exposes `KomorebiEngine` and the reusable engine model: tracks and
playlists, queue management, shuffle, scheduling, state transitions, events,
validation, and default settings.

Applications provide an `IAudioBackend` and may optionally provide preload,
media-session, and logging adapters.

## Development

```sh
npm run typecheck
npm run build
```

continued...
