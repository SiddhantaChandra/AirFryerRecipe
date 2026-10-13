# Local discovery and watch verification

This is a loopback development/preview procedure, not restricted HTTPS staging.
Public signup and future-phase controls are absent. Source videos are never hosted here.

## Development

Run the existing development Compose stack from the repository root:

```powershell
docker compose up -d
bun --cwd frontend run dev
```

Open `http://localhost:5173/`. Watch links pass through to Django. Direct watch links
also work on `http://localhost:8000/shorts/<slug>`. The Compose default explicitly
loads Vite from `http://localhost:5173`; native Django can set `VITE_DEV_SERVER`
to the same origin. API calls use the page's origin. In built mode leave that
setting empty and point `VITE_MANIFEST_PATH` at the build manifest.

## Built assets through Caddy

```powershell
bun --cwd frontend run build
docker compose --project-name airfryerrecipe --env-file .env -f infra/compose.dev.yml -f infra/compose.preview.yml up -d
```

Open `http://localhost:8090/`. Caddy serves the built frontend, proxies the public
API and Django watch document, and serves hashed assets without SPA fallback.
Watch HTML resolves scripts, imported chunks and CSS from the Vite manifest.
The preview overlay changes the web container to built mode; return to development
using `docker compose up -d web`. Port 8090 binds loopback only.

The public feed returns at most 24 newest recipes and the total published count.
There are no accepted query parameters until Phase 4. Responses revalidate with
representation ETags; hidden details return no-store 404, including when the client
sends an old validator. Provider fields use the shared read-time expiry boundary.

## Open gates

Phase 3 implementation was owner-authorized on 13 October 2026 while the Phase 2
browser/playback/remote-CI evidence remains pending. This authorization does not
mark Phase 2 complete.

The owner subsequently selected local implementation only; HTTPS staging and
monitor selection/exposure are deferred.

The candidate CSP runs report-only in this local preview. Browser playback,
Referer/origin requests, CSP reports and error 153 still need actual browser checks.
The approved staging hostname/host/access restrictions and error-monitor vendor,
retention, redaction and alert delivery need decisions and verification before
exposure. Do not deploy this development runserver/HTTP overlay as staging.
Internet staging also needs HTTPS, secure sessions, permitted host configuration,
and the stock Admin script/style CSP requirements verified separately from public
pages. No monitoring dependency or vendor has been assumed.
