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
`file://`. Any static server works from this folder:

```powershell
# PowerShell (no install needed)
.\serve.ps1 -Port 8000

# Stuck/broken server on port 8000?
.\stop-server.bat
```

Then open http://localhost:8000

## Play online

**https://napcosta.github.io/SoccerPucks/**

Pushes to `main` deploy automatically via GitHub Actions.

## Online multiplayer

The online mode is peer-to-peer with a short lobby code:

- Host Online creates a six-character room code.
- The other player chooses Join Online and enters that room code.
- The match starts when the peer-to-peer data channel opens.

The host simulates the match authoritatively. The guest sends inputs and receives
state snapshots over WebRTC. PeerJS handles only the lightweight signaling needed
to find the room; gameplay data still flows peer-to-peer.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move |
| Space | Shoot |
| Shift | Hero power (Sam: dash, Tesla: magnet) |

## Gameplay

- Local 1v1 vs AI, or online 1v1 peer-to-peer
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
| `assets/goal.glb` | `Assets/Models/goal.blend` |
