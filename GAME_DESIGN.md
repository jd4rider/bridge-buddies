# Game design

## The loop

1. Look at the crossing: gap, bank heights, anchors, budget, vehicle.
2. Buy members and place them by tapping grid points.
3. Press **TEST**.
4. Watch the vehicle load the structure. Stress colours show where the work is.
5. If something snaps, watch the pieces fall, then rebuild. Nothing is lost.
6. Cross, earn stars, unlock the next level.

No timer, no lives, no move limit. Failure costs time, never progress.

## Why it should not feel samey

Four levers change the puzzle rather than just the number:

- **Geometry**: gap 4 m to 13 m, banks that rise or fall, an optional mid-river rock.
- **Vehicle**: 1.05 t hatchback to a 15 t loco, with wheelbase and speed differences —
  a bus loads two deck points at once, a train punishes a wavy deck.
- **Materials**: pine, laminated, steel, aluminium, cable, concrete. Steel is strong and
  heavy; concrete is a wonderful pier and a terrible beam; cable pulls but never pushes.
- **Constraints**: budget, wind, restricted material lists, convoys, repair starts.

## Materials

| Material | Role |
| --- | --- |
| Pine | cheap, light, the tutorial beam |
| Laminated | stiffer, stronger, still cheap enough to spam |
| Steel | very strong, very stiff, and its own weight is a real load |
| Aluminium | nearly steel stiffness at a third of the weight, for long spans |
| Cable | tension only: hang a deck from a tower, or brace a truss |
| Concrete | superb in compression, poor in bending: use it as a pier |

## Stars

- 1 star: get across.
- 2 stars: at or under the reference budget (1.12 × the proven cost).
- 3 stars: at or under 1.02 × the proven cost — a tighter, cleverer design.

Stars are only about cost, never speed, so slow careful builders are not punished.

## Worlds

Twenty worlds of fifty levels, from **Sunny Stream** (pine, 4 m gaps, a hatchback) to the
**Bridge Buddies Championship** (13 m spans, 15 t loads, six materials, tight budgets).
Worlds unlock after 25 solved levels in the previous one, so a player who is stuck on a
hard level can go around it.

## Modes

- **Journey** — the campaign.
- **Daily** — one shared level per UTC date.
- **Sandbox** — unlimited budget, all materials, design persists.
- **Free play** — completed levels can be replayed for a better star rating.

## Deliberately out of scope for this version

- Endless procedural mode and creative modifiers (wind-only, wood-only, span records).
- Photo mode and slow-motion collapse replay.
- Leaderboards (no approved platform service was available).
- Advertising and purchases: none are wired, and nothing is gated.

## Presentation notes

The diorama is built from primitives — banks, a scrolling water texture, instanced
trees, drifting clouds — so there are no downloaded assets and no licence questions.
The bridge is drawn as two side trusses with cross-ties, and the same node offsets from
the solver drive both the mesh deformation and the vehicle's ride height.
