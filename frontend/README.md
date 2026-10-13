# Discovery and watch frontend

React/JavaScript with Vite, TanStack Query and the existing semantic theme tokens.
Discovery is a finite newest-first feed. Django delivers watch HTML; React mounts
the official player, Share/More and publication-rechecked navigation separately.

From this directory:

```powershell
npm ci
bun run dev
bun run test
bun run lint
bun run build
bun run test:e2e
```

The npm lockfile remains the CI installation contract. Development uses the local
Django stack. Built preview instructions are in [infra/PHASE3-LOCAL.md](../infra/PHASE3-LOCAL.md).

Playwright defaults to installed Chrome and the loopback Caddy preview at
`http://localhost:8090`. `E2E_BROWSER_CHANNEL=msedge` selects installed Edge.
Discovery tests use labeled catalog mocks. For real Django watch documents, set
`E2E_RECIPE_SLUG` to a disposable published local QA recipe whose name starts with
`Local browser QA:`; these tests otherwise skip. Player failures and geometry use
labeled mocks and do not establish real playback. Browser evidence is ignored.

`E2E_BASE_URL=http://localhost:5173` and `E2E_MODE=development` select Vite with
Django configured for its development entry. Built mode omits `E2E_MODE`.
The optional live diagnostic requires `E2E_LIVE_PLAYER=1` and an API-confirmed
`E2E_YOUTUBE_ID`; it leaves source data unchanged. Admin evidence tests additionally
require `E2E_ADMIN_MOCKS=1` and sanitized local HTML under
`backend/.cache/admin-browser/`. Generate it only from rolled-back test actors and
sessions, and never commit it. Browser checks do not establish staging or remote CI.
