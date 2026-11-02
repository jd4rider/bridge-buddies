# The structural model

Bridge Buddies uses a small 2D frame finite-element solver. This document is the
contract between the gameplay, the validator and the tests.

## Coordinates and units

- World units are metres. `x` is along the span, `y` is up, `z` is depth.
- The bridge is built in the vertical plane `z = 0`.
- Masses are kilograms, forces newtons, stresses pascals.

## The solver (`src/structural/frame.ts`)

Each node has three degrees of freedom: `u`, `v` and rotation. Each member is an
Euler–Bernoulli frame element with the standard 6 × 6 local stiffness matrix:

```
[  EA/L    0        0      -EA/L    0        0     ]
[  0    12EI/L³   6EI/L²     0   -12EI/L³   6EI/L²  ]
[  0     6EI/L²   4EI/L      0    -6EI/L²   2EI/L   ]
[ -EA/L   0        0       EA/L    0        0     ]
[  0   -12EI/L³  -6EI/L²     0    12EI/L³  -6EI/L²  ]
[  0     6EI/L²   2EI/L      0    -6EI/L²   4EI/L   ]
```

transformed by `T` and assembled into the global matrix, which is solved by Gaussian
elimination with partial pivoting. Supports are handled by eliminating fixed degrees
of freedom, which allows pinned supports (fix translations, free rotation) as well as
anchors (all three fixed).

Bending is included deliberately. A chain of axial-only truss elements has *no*
stiffness against a downward load on a straight line — exactly the load a truck puts
on a deck — so a truss-only formulation would either be singular or need a hack.

Why a frame rather than a real truss: members resist moment, so a straight deck is a
stable structure instead of a mechanism, and the deflection of an undersized bridge is
believable. The price is that the model is linear-elastic up to failure.

## Failure criteria

A member is checked on four limits:

| Mode | Expression |
| --- | --- |
| Tension | `N / (σ_axial · A)` |
| Compression | `|N| / min(σ_axial, P_euler/A) · A`, with `P_euler = π²EI/L²` |
| Bending | `max(|M₁|, |M₂|) / (σ_bend · S)` |
| Cables | tension only; a cable found in compression is removed and the frame re-solved |

Utilisation is `axial + bending`, a linear interaction. `S = b·h²/6`, `A = b·h`,
`I = b·h³/12`.

A bridge also fails if:

- the stiffness matrix is singular (a mechanism) — reported as `unstable`, never
  silently treated as a pass;
- the deck sags more than **0.40 m** at any node under the vehicle;
- the local deck slope exceeds **0.50**.

Those two limits are what stop a single long plank from working: it rarely breaks in
pure bending at these loads, but it sags far too much to drive.

## Loads

- **Self weight**: each member contributes `density · A · L · g`, split equally to its
  end nodes.
- **Vehicle**: two axle loads, each half of `mass · g`, distributed to the deck nodes
  bracketing the axle. The deck is a matched pair of trusses, so the solver takes **half**
  the vehicle's weight. This is exact for a symmetric bridge and is stated openly rather
  than hidden.
- **Wind**: a lateral nodal force `0.5 · ρ · v² · 0.35` per non-anchor node for levels
  that ask for it. It is applied as an in-plane horizontal force, not out-of-plane.

## Capacity tuning, and why the numbers look odd

Geometry and force distribution are physical; the **failure thresholds are tuned for
gameplay**. With realistic timber strengths, a 16 cm truss over 10 m carrying a 1.6 t
truck sits at roughly 2% of its capacity — technically correct and completely
uninteresting, because nothing a player does can fail.

The strengths in `materials.ts` were therefore scaled down per material so that a
correctly trussed reference bridge lands near **50–55% utilisation**, while a lone
plank fails on deflection. The measured campaign distribution is:

```
median 0.54 · p95 0.75 · max 0.85   (1000 levels, reference bridges)
```

This is a game tuning decision, documented rather than disguised. Do not present these
numbers as engineering allowables.

## Determinism

The solver has no randomness, no time dependence and no iteration cap that can change
the answer: the same design and the same load produce the same numbers on every run.
The tension-only cable pass is a bounded fixed point (at most four solves), and it
only ever removes members that came out in compression.

## Division of labour with Havok

Havok is enabled on the scene and owns **detached debris**: when a member fails, that
mesh becomes a dynamic box body with an impulse and angular velocity, so it tumbles,
hits the water plane and is retired with a splash. If Havok cannot start (wasm blocked,
old browser), `BridgeView` falls back to a deterministic integrator that produces the
same splash and drift, and a console warning explains why.

Havok deliberately does **not** model the bridge: a pile of rigid boxes has no reliable
member forces, so it cannot tell the player which beam is overstressed or validate a
level. Likewise the vehicle is kinematic on the solved deck rather than a rigid body,
because a rigid-body vehicle would make the crossing result depend on solver timing and
break the determinism the campaign validation depends on.

## What is not modelled

- Out-of-plane sway, torsion and lateral bracing (the two truss planes are mirrored).
- Joint slip, bolt bearing, fatigue and connection failure.
- Geometric nonlinearity (large-displacement P-Δ effects).
- Hydrodynamics, scour and vehicle suspension dynamics.
- Concrete cracking and cable slackening.

The crossing check is a **quasi-static moving load**, sampled at 21 positions. It is a
structural surrogate: passing it is labelled VERIFIED for the structure, not as proof
that a dynamic vehicle simulation would behave identically. `LEVEL_GENERATION.md`
records that distinction in the validation report.
