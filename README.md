# Soccer Pucks

HaxBall-inspired 3D arcade ball game in the browser, built without Unity.
Uses the original project's assets (stadium, heroes, ball) exported from the `.blend`
sources to glTF.

## Stack

- [Three.js](https://threejs.org/) loaded from CDN via import maps, with no build step
- Browser WebRTC data channels with PeerJS signaling for peer-to-peer online play
- Custom planar physics (circles + walls, HaxBall-style)
- Plain ES modules

## Run

The game must be served over HTTP because GLB and texture loading does not work from
`file://`. Any static server works from this folder.

Normal local run:

```powershell
.\serve.ps1 -Port 8000
```

Then open http://localhost:8000

If port 8000 is stuck or broken:

```powershell
.\stop-server.bat
```

Codex Desktop note: if asked to start the server from the managed Codex
environment, use the bundled workspace Python runtime when `python`/`node` are not
on PATH:

```powershell
<bundled-python.exe> -m http.server 8000 --bind 127.0.0.1
```

Use `codex_app.load_workspace_dependencies` to find `<bundled-python.exe>`.
If the process needs to keep running after the tool call exits, start it outside
the sandbox. Then verify with:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/ -UseBasicParsing
```

## AI evaluation lab

The **AI sim tests** link on the main menu opens a focused scenario lab. Unlike a full 1v1 or
2v2 match, each scenario starts the ball and heroes in a deliberate position and stops as soon as
its success, failure, or timeout condition is reached.

The catalog covers advantageous Tesla power use, power restraint, passing under pressure, creating
and taking a shooting lane, and defending a goal-bound shot. Version 2 scenarios are staged tactical
sequences rather than instant action checks: cards preview the journey, the live HUD follows the
current tactical stage, and the review shows the opportunities, measurements, and decision changes
that led to the result. After a stadium run ends, the reviewer scores decision quality, timing,
execution, and credibility from 1–5 and can add notes.

Scores are stored locally in the browser with the selected difficulty and an AI revision label.
The Results tab keeps automatic success rate, human averages, per-criterion averages, recent
trend, and run history scoped to the currently selected revision and difficulty, so unlike test
configurations are never blended. If durable browser storage is unavailable, the lab explicitly warns
that the score will last only for the current session. Results can be exported as JSON before changing
the AI or tuning. The standalone [ai-sim-test.html](ai-sim-test.html) page runs the same catalog
headlessly at a fixed 60 Hz and prints stage transitions, opportunity windows, probes, and action
transitions when available. These tests are intentionally challenging. A failure or timeout is not
necessarily a broken harness; its tactical trace is evidence about where the current AI needs work.

Scenario definitions live in `src/ai-scenarios.js`; condition evaluation and structured event
tracking live in `src/ai-scenario-runtime.js`.

## Play online

**https://napcosta.github.io/SoccerPucks/**

Pushes to `main` deploy automatically via GitHub Actions.

## Online multiplayer

The online mode is peer-to-peer with a short lobby code:

- Create Room creates a six-character room code.
- Up to three other players choose Join Room and enter that room code.
- Each player can enter a nickname and pick a hero before joining.
- Players choose a team or spectator role, and the host can rebalance the lobby.
- The match can start once both red and blue have at least one player.
- If a guest leaves during a match, their slot is replaced by AI so play can continue.

The host simulates the match authoritatively. Guests send inputs and receive
state snapshots over WebRTC. PeerJS handles only the lightweight signaling needed
to find the room; gameplay data still flows peer-to-peer. Online matches support
two to four total players.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move |
| Space | Shoot |
| Shift | Hero power (Sam: dash, Tesla: magnet) |
| Esc | Open the game menu |
| Top-right sound control | Mute or adjust sound-effect volume |

Gameplay requires a keyboard. Touch-only devices show a keyboard requirement notice before play.

## Gameplay

- Solo 1v1 or 2v2 vs AI, or online peer-to-peer with two to four players
- First pick a hero (Sam or Tesla)
- 3 minute matches, first to 3 goals
- Red defends the left goal, blue defends the right

## Asset pipeline

Models are exported from the Unity project's `.blend` files with
`tools/export_glb.py` (run via Blender CLI). Pass the `apply` flag so modifiers
(for example Mirror) are baked. Otherwise mirrored meshes export as only half:

```powershell
& "<blender.exe>" -b "<source.blend>" --python "tools\export_glb.py" -- "<output.glb>" apply
```

The Shaggy Slider is generated in Meshy AI instead (static fused mesh). Its
expression shape keys and the Idle / Celebrate / Sad / Angry clips are baked by
`tools/animate_shaggy_slider.py`, which classifies the mouth and eyes by
sampling the baked texture through the UVs:

```powershell
& "<blender.exe>" -b "<meshy_source.blend>" --python "tools\animate_shaggy_slider.py" -- "assets\shaggy_slider.glb" ["<preview_dir>"]
```

| GLB | Source |
| --- | --- |
| `assets/stadium.glb` | `Assets/Models/stadium_full.blend` |
| `assets/ball.glb` | `Assets/Resources/Heroes/Ball/BallCleanup.blend` |
| `assets/sam.glb` | `Assets/Resources/Heroes/Sam/Sam.blend` |
| `assets/tesla.glb` | `Assets/Resources/Heroes/Tesla/TeslaBlend.blend` |
| `assets/shaggy_slider.glb` | Meshy AI `.blend` animated by `tools/animate_shaggy_slider.py` |
| `assets/goal.glb` | `Assets/Models/goal.blend` |
