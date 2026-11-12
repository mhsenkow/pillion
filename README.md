# PILLION // GRIDFALL 1:1

Cozy-apocalyptic tilt-shift voxel diorama survival — modular Vite + TypeScript + Three.js rewrite.

**Live:** [pillion.ibm.io](https://pillion.ibm.io)

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173/

## Deploy

Same Cloudflare Workers + custom domain pattern as loom.ibm.io / token.ibm.io:

```bash
npx wrangler login   # once
npm run deploy       # → https://pillion.ibm.io/
```

Dry-run without upload: `npm run deploy:dry`.

## Controls

| Input | Action |
|-------|--------|
| WASD / Arrows | Drive (screen-space or bike-relative) |
| Space | Drift boost |
| Mouse | Aim / fire partner weapon |
| 1 | BREACH — opens a wall column |
| 2 | TESLA SMG |
| 3 | FIREBOMB — blows a hole; the building catches fire |
| R | Field repair |
| F | Firebomb overcharge (40 scrap) |
| P | Pause |
| 0 | Clear run and return to Emmett |
| SHARE PHONE GUN | Copy a phone controller link (TV keeps the diorama) |
| M | Mute / unmute audio |
| C | Couple & Ride Customizer |
| I / F2 | Dev Model Inspector |
| H | Hide / show all HUD menus |
| Right-drag | Orbit camera |
| Scroll | Zoom |

Each HUD panel has a **−** collapse control; collapsed panels become corner chips you can reopen. **HIDE MENUS** (top center, or `H`) tucks them all away.

Touch devices get dual virtual sticks automatically.

## Features

- **Artwork couple default** — bald harnessed driver + beanie/glasses sidecar gunner on red/black striped torpedo sidecar
- **Couple & Bike Customizer** — skins, tattoos, glasses, earrings, seat swap, sidecar ↔ tandem, presets + JSON import/export
- **Dev Model Inspector** — turntable studio, 12 FPS frame stepper, part offset/scale tuners, reference art loupe, Copy TS Preset
- **80×160 GIS diorama** — Emmett MI cadastral + live Overpass OSM, sunset sky, ashen zombies, ruined cars
- **Streaming earth blocks** — each edge pulls the next OpenStreetMap chunk; Detroit / Chicago are real road + building tiles
- **Structure weapons** — BREACH opens a column; FIREBOMB collapses a hole and leaves the rest burning

## Stack

Vite · TypeScript · Three.js r170 · modular `/src/{core,art,geo,simulation,render,ui,game}`
