# Third-party notices

Sky Music Studio's original source and documentation are MIT-licensed (see `LICENSE`).
The app bundles the following third-party software and user-supplied game sound
packs in `public/sound-packs/`. The MIT license for this project's original code
and documentation does not grant a license to those third-party audio recordings.

The instrument pictures in `public/instrument-icons/` come from *Sky: Children of
the Light* and remain the work of thatgamecompany. The MIT license does not cover
them.

## Runtime dependencies (shipped in the web bundle)

| Component | Version | License | Copyright / project | License text |
|---|---|---|---|---|
| React | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates — <https://github.com/facebook/react> | <https://github.com/facebook/react/blob/main/LICENSE> |
| React DOM | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates — <https://github.com/facebook/react> | <https://github.com/facebook/react/blob/main/LICENSE> |
| Zustand | 5.0.16 | MIT | Paul Henschel / contributors — <https://github.com/pmndrs/zustand> | <https://github.com/pmndrs/zustand/blob/main/LICENSE> |

## Development / test dependencies (not part of the shipped audio engine)

These are installed for building, type-checking, linting and testing:

| Component | Version | License | URL |
|---|---|---|---|
| Vite | 7.3.7 | MIT | <https://github.com/vitejs/vite> |
| @vitejs/plugin-react | 5.2.0 | MIT | <https://github.com/vitejs/vite-plugin-react> |
| TypeScript | 5.9.3 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| jsdom | 30.1.3 | MIT | <https://github.com/jsdom/jsdom> |
| ESLint | 9.39.5 | MIT | <https://github.com/eslint/eslint> |
| typescript-eslint | 8.72.1 | MIT | <https://github.com/typescript-eslint/typescript-eslint> |
| eslint-plugin-react-hooks | 7.1.1 | MIT | <https://github.com/facebook/react> |
| eslint-plugin-react-refresh | 0.4.26 | MIT | <https://github.com/ArnaudBarre/eslint-plugin-react-refresh> |
| globals | 15.15.0 | MIT | <https://github.com/sindresorhus/globals> |
| @types/react, @types/react-dom | 19.3.0 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @types/node | 22.20.5 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @tonejs/midi | 2.0.28 | MIT | <https://github.com/Tonejs/Midi> |

`@tonejs/midi` is used **only by the test suite** as an independent MIDI parser. The
application's MIDI writer is original code (`src/audio/midi.ts`).

## Research references

Facts used in the instrument manifest and mechanics documentation are attributed in
[`docs/sky-mechanics.md`](docs/sky-mechanics.md) and
[`docs/audio-sources.md`](docs/audio-sources.md). Research references are not bundled
content and no text, image, audio, or other asset was copied from them. The
`specy/genshin-music` project (AGPL-3.0) was inspected only for factual metadata such
as note counts, offsets, registers and sustain flags; no code, samples, or assets from
it are used.

## Trademarks

*Sky: Children of the Light* is a trademark of thatgamecompany. Sky Music Studio is
unofficial fan software, not affiliated with or endorsed by thatgamecompany.
