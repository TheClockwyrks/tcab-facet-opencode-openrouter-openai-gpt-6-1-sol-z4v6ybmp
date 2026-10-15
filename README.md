# Facet

**Pressure finds the flaw.** A browser puzzle of seven cut stones, accumulating strain, and cascading chain reactions. Match neighboring gems into lines, turn worn stones into double-scoring detonations, and earn brilliant, star, and prism cuts. Reach each level's point target; the round ends when no productive swap remains.

## Run

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. All art, effects, and audio are included locally. There is no backend or runtime network service.

## Production build

```sh
npm ci
npm run build
npm run preview
```

`dist/` is the complete static site. Serve it at an origin root or any sub-path; asset URLs are relative. The build only type-checks and bundles committed files. It never runs asset-generation tools.

## Controls

- **Mouse, pen, or touch:** hold a stone, carry it onto an orthogonal neighbor, then release. Or select a stone and press/release its neighbor. Return to the selected stone to withdraw an offer. Only a productive swap is accepted.
- **Menus:** point and click/tap; or **↑ / ↓** to choose and **Enter / Space** to confirm.
- **Pause/resume:** the on-screen **PAUSE** button, **Esc**, or **P**.
- **Sound:** **M** toggles all music and effects. Audio unlocks on the first interaction.
- **Back:** **Esc** leaves How to Play or the finished round.
- **Diagnostics:** the backtick key toggles the engine's read-only overlay.

The in-game How to Play page explains strain, special cuts, chain scoring, and level progression. There is no time limit.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests cover match closure and shortest waves, cut placement/priority, persistent strain and falls, scoring, time partitioning, menu/gesture behavior, and the full engine over a real Node canvas with the committed images and particle definitions.

## Project structure

- `src/game.ts`: the public state contract and Simple 2D lifecycle.
- `src/model.ts`: render-free immutable board rules, timing, screens, and pointer path.
- `src/debug.ts`: validated state poses and pure snapshots, available through `engine.debug` only.
- `src/presentation.ts`: produced-asset loading, live particle simulation, and canvas presentation.
- `public/assets/`: original pixel sprites, break and prism animation frames, particle systems, WAV cues, and two music scores (WAV + MIDI).
- `showcase/`: captured gameplay replay, screenshots, and player-facing description.

## Asset authorship

Every gem, damage state, overlay, and the engraved board was authored as native pixel geometry and rasterized with `draw`. Shard animations and the prism's light-catching turn were rasterized with `draw-sheet`. Four `particle-2d` systems simulate live through the supplied particle runtime; they are not baked flashes. Mechanical and pitched cues came from `sfx-synth`, a glass/debris body from `sfx-sample`, and the original eight-bar title/play pieces from `music` using the staged instrument bank.

`tools/produce.py` records the one-time production recipe. It requires the authoring binaries and sample/instrument libraries from the original production environment; **it is not a build dependency**. The ready-to-use outputs are committed, so rebuilding the published source requires only Node and `npm ci`.

`tools/capture.mjs` captures the showcase with the project's Playwright and Chromium against the Vite server on port 5173. Motion is recorded by the engine's own drawing recorder and stored as gzipped JSON, including the sprites it drew.
