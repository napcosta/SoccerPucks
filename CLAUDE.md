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

`src/ai-scenarios.js` defines short, custom-positioned behavior scenarios with stable IDs,
structured completion rules, and review rubrics. `src/ai-scenario-runtime.js` runs them at a fixed
60 Hz against the production physics/AI/hero logic and emits decision, kick, power, possession,
contact, save, and goal events. `ai-sim-test.mjs` is the compatibility/report facade.

Version 2 scenarios can define ordered `phases`, opportunity windows, numeric probes, and scripted
tactical build-up. Runtime lifecycle state and tactical stage are deliberately separate: UI code
must read `progress.tacticalPhase`, never reinterpret `progress.phase`. The focused tests are meant
to expose weak decisions, so a deterministic failure can be a valid and useful regression result.

Open `ai-sim-test.html` through the dev server for the headless regression report, or use **AI sim
tests** on the game menu to watch a scenario in the stadium and record a human score. Live and
headless runs share scenario definitions and terminal conditions. Evaluation records are
versioned, stored in browser localStorage, and exportable from the Results tab.
