# Soccer Pucks

HaxBall-inspired 3D arcade ball game in the browser, built without Unity.
Uses the original project's assets (stadium, heroes, ball) exported from the `.blend` sources to glTF.

## Stack

- [Three.js](https://threejs.org/) (loaded from CDN via import maps — no build step, no npm)
- Custom planar physics (circles + walls, HaxBall-style)
- Plain ES modules

## Run

The game must be served over HTTP (GLB/texture loading doesn't work from `file://`).
Any static server works, from this folder:

```powershell
# with Python
python -m http.server 8000

# or with Node
npx serve .

# or with Blender's bundled Python (no other tools needed)
& "C:\Program Files\Blender Foundation\Blender 5.0\5.0\python\bin\python.exe" -m http.server 8000
```

Then open http://localhost:8000

## Play online

After pushing to GitHub, the game deploys automatically to GitHub Pages on every push to `main`.

Live URL: `https://<your-github-username>.github.io/SoccerPucks/`

First-time setup:

```powershell
gh auth login
cd "c:\Users\nuno_\OneDrive\Desktop\SoccerPucks"
gh repo create SoccerPucks --public --source=. --remote=origin --push --description "HaxBall-inspired 3D arcade ball game in the browser"
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions** (if it is not already selected). The included workflow publishes the site on the next push.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move |
| Space | Shoot |
| Shift | Hero power (Sam: dash, Tesla: magnet) |

## Gameplay

- Local 1v1 vs AI: first pick a hero (Sam or Tesla)
- 100 second matches, golden goal on a draw
- Red defends the left goal, blue the right

## Asset pipeline

Models are exported from the Unity project's `.blend` files with
`tools/export_glb.py` (run via Blender CLI):

```powershell
& "<blender.exe>" -b "<source.blend>" --python "tools\export_glb.py" -- "<output.glb>"
```

| GLB | Source |
| --- | --- |
| `assets/stadium.glb` | `Assets/Models/stadium_full.blend` |
| `assets/ball.glb` | `Assets/Resources/Heroes/Ball/BallCleanup.blend` |
| `assets/sam.glb` | `Assets/Resources/Heroes/Sam/Sam.blend` |
| `assets/tesla.glb` | `Assets/Resources/Heroes/Tesla/TeslaBlend.blend` |
| `assets/goal.glb` | `Assets/Models/goal.blend` |
