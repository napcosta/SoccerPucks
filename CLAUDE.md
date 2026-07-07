# CLAUDE.md

Guidance for working in this codebase. See [README.md](README.md) for gameplay, controls, and the asset pipeline — not repeated here.

## Stack constraints

- Plain ES modules, no build step, no bundler, no npm scripts. Three.js loads from CDN via import maps in `index.html`.
- Must be served over HTTP (`.\serve.ps1 -Port 8000`) — GLB/texture loading fails on `file://`.
- Don't introduce TypeScript, a bundler, or a package.json-driven build unless explicitly asked.

## Architecture: host-authoritative P2P

Online matches are peer-to-peer (`online.js`, PeerJS for signaling only). The **host** simulates
physics and AI authoritatively; guests only send input and render state snapshots the host sends
back. When touching `game.js`, `ai.js`, or `physics.js`, keep simulation logic host-only — guests
must stay dumb renderers of the host's state, not run their own physics/AI.

## File map (`src/`)

- `main.js` — entry point, wires renderer/scene/game/input together, render loop
- `game.js` — match state machine: kickoff, scoring, timer, per-frame update
- `ai.js` — team AI (roles: striker/etc., decision logic)
- `physics.js` — circle/wall collision, integration (HaxBall-style planar physics)
- `constants.js` — pitch/player/ball/goal dimensions and match config
- `tuning.js` — runtime-adjustable gameplay constants (paired with `debug.js` sliders)
- `debug.js` — debug overlay / tuning sliders
- `heroes.js` — hero classes (Sam, Tesla, Shaggy) and their powers
- `scene.js` — Three.js scene/camera/renderer setup, stadium build
- `assets.js` — GLB loading, skeleton cloning, material setup
- `toon.js` — toon shading (gradient map, outline handling)
- `effects.js` — particle/smoke effects
- `scoreboard.js` — canvas-texture scoreboard rendering
- `input.js` — keyboard input polling
- `online.js` — PeerJS signaling, room codes, host/guest message protocol

## AI sim harness

`ai-sim-test.mjs` runs headless AI-vs-AI match scenarios against `physics.js`/`ai.js` without
Three.js. Open `ai-sim-test.html` through the dev server (not `node ai-sim-test.mjs` directly —
it's structured as a browser module) to see `runAllScenarios()` output. Use this to sanity-check
AI behavior changes before testing in the full game.
