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

## Play online

**https://napcosta.github.io/SoccerPucks/**

Pushes to `main` deploy automatically via GitHub Actions.

## Online multiplayer

The online mode is peer-to-peer with a short lobby code:

- Host Online creates a six-character room code.
- Up to three other players choose Join Online and enter that room code.
- Each player can enter a nickname and pick a hero before joining.
- The host sees each player's nickname and hero, chooses red or blue team for
  every player, then starts the match once both teams have at least one player.
- Guests can see the current lobby roster and team choices, but only the host can
  change teams.

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

## Gameplay

- Local 1v1 or 2v2 vs AI, or online peer-to-peer with two to four players
- First pick a hero (Sam or Tesla)
- 100 second matches, golden goal on a draw
- Red defends the left goal, blue defends the right

## Asset pipeline

Models are exported from the Unity project's `.blend` files with
`tools/export_glb.py` (run via Blender CLI). Pass the `apply` flag so modifiers
(for example Mirror) are baked. Otherwise mirrored meshes export as only half:

```powershell
& "<blender.exe>" -b "<source.blend>" --python "tools\export_glb.py" -- "<output.glb>" apply
```

| GLB | Source |
| --- | --- |
| `assets/stadium.glb` | `Assets/Models/stadium_full.blend` |
| `assets/ball.glb` | `Assets/Resources/Heroes/Ball/BallCleanup.blend` |
| `assets/sam.glb` | `Assets/Resources/Heroes/Sam/Sam.blend` |
| `assets/tesla.glb` | `Assets/Resources/Heroes/Tesla/TeslaBlend.blend` |
| `assets/shaggy_slider.glb` | `tools/create_shaggy_slider.py` procedural concept-art model |
| `assets/goal.glb` | `Assets/Models/goal.blend` |
