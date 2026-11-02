# Deployment

## Web build

```bash
npm ci
npm test
npm run check:levels
npm run build
```

`dist/` is a static site. `vite.config.ts` sets `base: './'`, so it works from a
sub-path such as `/play/` without rewriting asset URLs.

## GitHub Pages

`.github/workflows/pages.yml` does the whole thing on every push to `main`:

1. installs dependencies;
2. runs the unit tests;
3. validates all 1000 campaign levels (the build fails if any level is rejected);
4. type-checks and builds;
5. copies the build to `site/play/`, adds the arcade client, and writes a redirect at
   `site/index.html`;
6. publishes `site/` to Pages.

Repository settings must have **Pages → Source: GitHub Actions**.

Public URL: `https://jd4rider.github.io/bridge-buddies/play/`.

## Little Joy Arcade

The game is listed in `littlejoyarcade/src/data/games.ts` and in the Supabase `games`
table (which is what the live site actually renders). Publish with:

```bash
cd ~/Programming/littlejoyarcade
SUPABASE_DB_PASSWORD=... node scripts/publish-game.mjs ../bridge-buddies/arcade-manifest.json
```

`arcade-manifest.json` must match the catalogue entry: same `id`, `playUrl` and
`saveKey`.

## Custom domain

Target: `https://bridgebuddies.littlejoyarcade.site/play/`.

The portal probes `preferredPlayUrl` and falls back to the `github.io` URL when the
subdomain is not yet serving, so the entry can ship before DNS exists. Adding the DNS
record and the Pages custom domain is a separate, explicit step — do not change DNS as
part of a game release.

## Save format

`localStorage['bridge-buddies-save-v1']` holds a versioned object:

```json
{
  "version": 1,
  "results": { "level-12": { "stars": 3, "cost": 214 } },
  "lastLevel": 13,
  "settings": { "sound": true, "motion": true, "stress": true },
  "sandbox": { "nodes": [], "members": [] }
}
```

A missing or corrupted save falls back to a fresh one; progress is never silently
discarded because of a parse error. There is no cloud save yet: `public/arcade-client.js`
provides the platform bridge, but no cloud-save service was approved for this title.
