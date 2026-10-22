# Muzari

Modern local-first audio player for the browser and for desktop (via Tauri).

[![All Contributors](https://img.shields.io/github/all-contributors/Audiflo/Muzari?color=ee8449&style=flat-square)](#contributors)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)
![License](https://img.shields.io/github/license/Audiflo/Muzari?style=flat-square)
![Build Status](https://img.shields.io/github/actions/workflow/status/Audiflo/Muzari/build.yml?style=flat-square)
[![Netlify Status](https://api.netlify.com/api/v1/badges/1800e6c4-d6fd-4c7f-ad73-4593498ea6db/deploy-status)](https://app.netlify.com/projects/muzari/deploys)

![Alt](https://repobeats.axiom.co/api/embed/23a8fe715d513003067f59491f0e044f0182ed4c.svg "Repobeats analytics image")

<!-- markdownlint-disable MD033 -->
<a href="https://audiflo.github.io/Muzari">
  <picture>
    <source srcset="https://chromeos.dev/badges/en/dark.svg" media="(prefers-color-scheme: dark)">
    <img src="https://chromeos.dev/badges/en/primary.svg" alt="Add to Chromebook"/>
  </picture>
</a>

| Desktop | Custom Theme | Lyrics and Visualizer | Settings |
| --- | --- | --- | --- |
| <img width="1920" height="1080" alt="Main player UI" src="./Build/public/screenshots/MainUI.png" /> | <img width="1920" height="1080" alt="Player customized with the Nebula theme and Phosphor icons" src="./Build/public/screenshots/CustomizedUI.png" /> | <img width="1920" height="1080" alt="Lyrics and visualizer view" src="./Build/public/screenshots/LyricsandVisualizer.png" /> | <img width="1920" height="1080" alt="Settings" src="./Build/public/screenshots/Settings.png" /> |

| Mobile | Custom Theme | Lyrics and Visualizer | Settings |
| --- | --- | --- | --- |
| <img width="390" height="844" alt="Main player UI on mobile" src="./Build/public/screenshots/MainUI-Mobile.png" /> | <img width="390" height="844" alt="Player customized with the Nebula theme and Phosphor icons on mobile" src="./Build/public/screenshots/CustomizedUI-Mobile.png" /> | <img width="390" height="844" alt="Lyrics and visualizer view on mobile" src="./Build/public/screenshots/LyricsandVisualizer-Mobile.png" /> | <img width="390" height="844" alt="Settings on mobile" src="./Build/public/screenshots/Settings-Mobile.png" /> |

## Features

* **Local-first**: import your own audio and keep the whole library on your device. No account, no upload.
* Reads tags, cover art, and lyrics on import, with metadata from MusicBrainz and Discogs.
* Pluggable audio backends, including a Symphonia WASM decoder for formats the browser cannot play natively.
* Gapless playback and equal-power crossfade, plus a 10-band equalizer, ReplayGain, and tempo/pitch control.
* Playlists, folders, drag-and-drop, smart shuffle, and M3U import/export.
* 64 visualizers, 8 wallpapers, 29 color palettes, and 8 icon packs.
* Rebindable keyboard shortcuts and English/French localization.
* Runs as an installable PWA, a Tauri desktop app, or a **single** self-contained HTML file.

## Quick Start

Muzari is deployed to two places:
  - Netlify: https://muzari.netlify.app/
  - GitHub Pages: https://audiflo.github.io/Muzari

To build manually:

```bash
git clone https://github.com/Audiflo/Muzari.git
cd Muzari/Build
npm install
npm run build:wasm   # build the Symphonia decoder (once)
npm run dev:web      # or: npm run dev:desktop
```

Production builds:

```bash
npm run build:web      # web/PWA into dist/
npm run build:desktop  # native Tauri bundle
npm run build:single   # one self-contained HTML file
```

Requires Node.js 20+ and, for the WASM decoder, Rust with `wasm-pack`. See [Docs/BUILD.md](Docs/BUILD.md) for prerequisites and the full platform matrix.

## Contributing

Contributions are welcome. Fork the repo, make your changes under `Build/`, then run `npm run lint` and `npm test` before opening a PR against `main`.

> Starring the repository would be amazing, especially if you use the player!

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/TrickiyALT"><img src="https://avatars.githubusercontent.com/u/195377855?v=4?s=100" width="100px;" alt="Trickiy"/><br /><sub><b>Trickiy</b></sub></a><br /><a href="#ideas-TrickiyALT" title="Ideas, Planning, & Feedback">🤔</a> <a href="#bug-TrickiyALT" title="Bug reports">🐛</a> <a href="#design-TrickiyALT" title="Design">🎨</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT. See [LICENSE](LICENSE) for the full text.

Chromebook, ChromeOS, and the ChromeOS logo are trademarks of Google LLC.
