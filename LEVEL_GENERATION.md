# Generation and validation

## Seeded levels

Every level is a pure function of its index:

```
world      = floor((index - 1) / 50) + 1     // 1..20
local      = (index - 1) % 50 + 1            // 1..50
seed       = "bb-v1-<index>-w<world>"
rng        = mulberry32(fnv1a(seed))
```

`generateLevel(index)` produces the gap, the bank height difference, the anchors, the
vehicle, the weather, and the reference bridge. The same index always yields the same
level; `tests/structural.test.ts` asserts this.

Geometry ranges come from the world table (`src/levels/worlds.ts`): each world has a
gap range, a material list, a vehicle pool, a wind speed and a palette. Worlds unlock
after 25 of the previous world's 50 levels are solved.

## Reference bridges

A level's budget is derived from a bridge that is known to work, so a level can never
ship with a budget too small to buy a solution.

`buildReference` lays a straight deck between the two anchors with a Warren truss
underneath (diagonals down to alternating bottom nodes plus a bottom chord). Its
material is chosen from the *load demand* (`mass × gap`), not from the gap alone, and
the truss depth grows with the load:

```
depth = clamp(0.85 + gap·0.07 + loadKg/12000, …, 2.8)
```

The mid-river rock available on spans of 9 m or more is deliberately **not** used by
the reference. A short strut into a rigid anchor behaves as a cantilever: it attracts
the truss's bending moment and becomes the weakest member, which made the pier — not
the bridge — decide those levels. Leaving it out keeps validation honest and makes a
mid-river pier a genuine player choice.

Budget and stars:

```
budget          = ceil(reference cost × 1.40 / 10) × 10
two-star budget = ceil(reference cost × 1.12 / 10) × 10
three-star      = ceil(reference cost × 1.02 / 10) × 10
```

## Validation pipeline

`npm run check:levels` (`scripts/validate-levels.ts`) generates all 1000 levels and, for
each one:

1. confirms the reference costs no more than the level's budget;
2. confirms the deck actually connects the left anchor to the right anchor;
3. drives the level's vehicle across in 21 steps, re-solving the frame at each step;
4. records the worst utilisation, the worst deflection and the worst slope;
5. marks the level `VERIFIED` only if every check passes.

The run is deterministic and takes about five seconds for the whole campaign. Output:

- `reports/level-validation.json` — full per-level record plus a summary;
- console table of verified levels per world.

The build fails (exit code 1) if any level is rejected, which is what stops an
unvalidated level from shipping. The CI workflow runs this before the production build.

### What VERIFIED means

VERIFIED means: *the structural surrogate passes for the stored reference bridge at 21
moving-load positions, within budget.* It does **not** mean a full dynamic vehicle
simulation has been run, and it does not claim the level is fun or unique. Those are
separate questions, and the report says so in its own `summary.note`.

## Latest measured run

```
Campaign validation — 1000 levels in ~5.2 s
  verified 1000    rejected 0
  utilisation  median 0.54  p95 0.75  max 0.85
  deflection   median 0.001 m  max 0.002 m
  every world 50/50
```

The deflection column is small because a correct truss is stiff; the failure path for
an undersized bridge is member utilisation, and for an untrussed plank it is deflection
or slope. Both were exercised while tuning (see `STRUCTURAL.md`).

## Daily challenge

`levelForDate(date)` hashes the UTC day number into a campaign index, so everyone gets
the same level on the same day without a server. Because the index points at an already
validated campaign level, the daily cannot be unsolvable.

## Reproducing a level

```ts
import { generateLevel } from './src/levels/generator'
const level = generateLevel(417) // stable forever
```
