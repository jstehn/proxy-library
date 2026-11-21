# Platform: deploying, installing and using it on a phone

Rules that belong to no module: how the stack starts in Docker and how the browser app behaves as an
installable PWA. Code: `docker-compose.yml`, `public/sw.js`, `src/app/globals.css`. Checked against
`refactor/main` (2026-11-20).

1. **Migrations run in a separate one-shot service,** so a failed migration stops the app and worker from
   starting instead of running half-migrated. (doc 11 §7.3; `docker-compose.yml` `migrate`)
2. **Config is read only from environment variables** (CLAUDE.md, `docs/deploy.md`); dev stays on Nix and
   direnv.
3. **The service worker never serves stale pages when online:** it caches only immutable assets, and
   when a navigation fails offline it serves the precached `/offline.html` instead of the browser's error
   page. (doc 49 §3 rules 3-4; `public/sw.js`)
4. **Touch targets** on coarse pointers are at least 44 px (`--target-size`); animation and box-shadow
   highlights degrade under `prefers-reduced-motion` and `forced-colors`. (doc 49 §3 rules 2 and 5;
   `globals.css`)

## Not carried

- Doc 49 §3 rule 1 (WCAG AA contrast numbers in both themes) and the 320 px overflow check were not
  re-measured here; P33 (accessibility) and P31 (colour tokens) own them, and doc 49 stays the source
  until they finish.
