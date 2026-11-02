# Bridge Buddies

A miniature 3D bridge-engineering puzzle for Little Joy Arcade.
**Build a bridge. Test it. Get your little buddies across.**

<https://bridgebuddies.littlejoyarcade.site> (production target)

## What it is

Each level is a gap between two riverbanks. You buy beams, road deck and cables out
of a fixed budget, place them by tapping (or dragging) between grid points, then press
**TEST** and watch a little vehicle drive across the structure you just built.

The bridge is not animated from a canned script. It is a real frame model:

- every member carries axial force **and bending moment**;
- the deck sags under the moving vehicle, and the vehicle rides the sag;
- overloaded members snap, their load moves to their neighbours, and the pieces fall
  into the river;
- if the deck no longer connects the banks, the truck goes with it.

There is no timer, no lives and no penalty for experimenting. Undo and redo are
unlimited within a level.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # solver, design rules and generator
npm run check:levels # validate all 1000 campaign levels (writes reports/)
npm run build        # type-check + production build in dist/
npm run preview      # serve the production build
```

Node 20.19+ or 22.12+ is required by Vite 7.

## Controls

| Action | Touch / mouse |
| --- | --- |
| Place a member | Tap one grid point, then another |
| Place by dragging | Drag from one point to another and release |
| Remove a member | **Erase** tool, tap the member |
| Orbit / zoom | **Look** tool, drag / pinch |
| Undo, redo, reset | Buttons under the tools |

Deck members are the drivable road. Beams are structure. Cables only pull.

## Campaign and modes

- **Journey**: 1000 levels across 20 worlds of 50, each with a reference bridge that
  the offline validator re-solves (see `LEVEL_GENERATION.md`).
- **Daily challenge**: one shared level per UTC date, picked deterministically.
- **Sandbox**: unlimited budget, all materials, your design is saved.
- **Worlds / levels**: stars are 1 for crossing, 2 and 3 for staying under the
  reference-derived budgets.

## What is verified, and what is not

Verified by running it:

- `npm test` — 14 unit tests, including analytical cantilever and simply-supported
  beam deflections to 1e-6.
- `npm run check:levels` — all 1000 levels: reference bridge connects both banks and
  survives the moving-load sweep. Report in `reports/level-validation.json`.
- `node scripts/smoke.mjs` — a real Chromium at 390 × 844 builds a truss through the
  actual pointer pipeline and drives a vehicle across.

Not done yet, and not claimed:

- **The vehicle is not a Havok rigid body.** It is a kinematic controller riding the
  solved deck, which keeps crossings deterministic for validation. Havok simulates the
  debris, and the debris falls back to a small deterministic integrator if the wasm
  fails to load (offline, or a browser without the required features). The bridge
  itself is frame-solved, never Havok: a rigid-body pile is not a structural model.
- The structural solve is planar: the deck is modelled as a matched pair of trusses
  each carrying half the vehicle, which is exact for a symmetric bridge. Out-of-plane
  sway, torsion and wind on the truss face are not simulated.
- Level validation is a *structural* surrogate (quasi-static moving load), not a full
  dynamic vehicle simulation. Levels are labelled VERIFIED for that check only.
- Endless mode and creative modifiers are not implemented; Journey, Daily and Sandbox are.
- The Babylon bundle is 7.2 MB (1.6 MB gzipped) because the engine is imported from the
  package root. A granular-import pass is the obvious next optimisation.

## Documents

- `GAME_DESIGN.md` — loop, modes, scoring, worlds.
- `STRUCTURAL.md` — the solver, units, failure criteria and their tuning.
- `LEVEL_GENERATION.md` — generator, reference bridges, validation pipeline.
- `DEPLOYMENT.md` — GitHub Pages and Little Joy Arcade publishing.
