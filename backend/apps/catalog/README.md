# Local manual curation and source maintenance

Phase 2 runs only at `http://localhost:8000/django-admin/`. Compose binds the web and database ports to loopback. Create an administrator using the existing `docker compose exec web python manage.py createsuperuser`; no default administrator or password is installed.

Use Catalog → Videos → Preview YouTube URL to check duplicates and inspect original metadata. Enter independently written recipe details, choose canonical taxonomy entries, and save a draft. Each save fetches fresh server-side metadata; client fields and old previews cannot authorize a source snapshot. Private/not-returned sources can be recorded as drafts with unknown metadata. Taxonomy aliases point directly to canonical entries in the same vocabulary. The normalized name namespace prevents aliases from duplicating canonical names.

Confirm dietary review and air-fryer relevance, then use **Review and publish selected recipes**. Publication requires both `change_video` and `publish_video`; hiding and refresh similarly require their action permission plus `change_video`. Preview/add requires `add_video`. Django separately enforces taxonomy and ingredient-inline permissions. Editing a published recipe or its relations returns it to draft for deliberate review. Source availability never automatically changes publication. Hard deletion and slug/source replacement are disabled. Admin attribution becomes null when that administrator is deleted.

Diet policy is an editable singleton under Catalog → Editorial policy. Eggs/meat/fish are NON_VEG, dairy without eggs/meat is VEG, recipes without animal ingredients are VEGAN, and unclear ingredients/instructions remain UNKNOWN until reviewed. The public explanation is deferred to the public UI phase.

Source metadata must be read through `apps.catalog.services.read_source_metadata`, including later public handlers. It consults current database values and purges/suppresses expired source fields, even for old model instances or missed scheduling. Raw source columns are persistence details, excluded from admin forms, durable history, and exports. Recipe names/summaries must be independently curated, not copied provider data relabeled to evade expiry.

## Commands and schedule

From the repository root, after migrations:

```powershell
docker compose exec -T web python manage.py refresh_youtube_metadata
docker compose exec -T web python manage.py purge_expired_source_metadata
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File .\infra\run-maintenance.ps1
```

Refresh uses up to 50 IDs per API request; defaults allow at most 100 requests including retries, and at most 2 retries with 1/2-second backoff. It covers every publication state due at day 25 (or never synced). Quota/auth failures fail promptly. Successful fetches alone advance the source timestamp. Expiry has no provider dependency and clears source fields at day 30 without changing recipes/publication; reads provide the deadline guard between sweeps. Commands use a shared PostgreSQL advisory overlap lock and bounded SQL/API batches. If overlap or an outage causes a nonzero exit, rerun after the other command finishes or the provider recovers; do not extend retention.

Windows task `AirFryerRecipe-DailySourceMaintenance` invokes the script daily at **05:00 Asia/Calcutta**, using India Standard Time on this host. It runs under the signed-in account, starts missed runs when available, ignores overlapping task invocations, and has a one-hour limit. Docker Desktop and the existing Compose stack must be available. The script always attempts expiry after refresh, including refresh failure.

```powershell
Get-ScheduledTaskInfo -TaskName AirFryerRecipe-DailySourceMaintenance
Get-Content .\maintenance-status.json
Start-ScheduledTask -TaskName AirFryerRecipe-DailySourceMaintenance
```

Expected task result is 0 and both status exit codes are 0. Nonzero results, a missing/recently stale status file, or nonzero `sync_failure_count` are actionable failures. The ignored status file contains only timestamps and exit codes, no source payloads. No external notification vendor is installed. A sleeping/logged-out host or stopped Docker can miss physical purge; the read guard suppresses stale metadata on every supported application read. Run expiry before allowing access after a long outage.

## Retained copies and restore

No source cache/export/history or backup infrastructure is added in Phase 2. Admin history records generic action text and independently curated recipe names, never provider payloads. Do not use a long-lived full `dumpdata`/database export for provider columns. Future archival exports must omit those columns. Any short-lived full backup expires at the earliest included source deadline. After any restore, run the expiry command **before serving requests**, and verify source reads hide expired fields. A database backup or raw SQL export is not made retention-safe merely by the application read guard.

## Verification limits

Backend tests mock YouTube; PostgreSQL enforces constraints, identity guards and concurrency. Browser screenshots with mocked iframe documents prove application layout/workflow, not live player functionality. Privacy-enhanced embeds preserve `strict-origin-when-cross-origin`, pass the current origin, and show an error-153 configuration explanation. Validate real source playback and deployed headers at their phase gates. This admin retains stock Django Admin shell/theme behavior; it does not implement the SPA theme or redesign stock widgets.

## Public discovery reads

`GET /api/v1/videos/` accepts `q`, repeated `diet`, `ingredient`, `cuisine`, `meal_type`,
`difficulty`, and `language`, positive whole-minute `max_time`, and `sort=newest`.
Search requires every word in the curated title or summary. Facets combine with AND;
multiselects use OR except ingredients, which require every selected canonical ingredient.
Taxonomy aliases resolve to canonical slugs. Vegetarian includes Vegan; difficulty groups
are `easy` (1–2), `medium` (3), and `hard` (4–5). Active time/difficulty/language filters
exclude unknown values. Source duration and retained provider text never substitute for
recipe cooking time or curated search text.

Feed responses include `results`, total matching `count`, normalized `query`, `limit: 24`,
`next_cursor`, and `diet_policy`. Pass the opaque `next_cursor` as `cursor` with the same
query for another page. Ordering is descending creation timestamp then UUID; malformed
or mismatched cursors return 400. Unsupported parameters and optional sorts are rejected.

`GET /api/v1/filters/` accepts the discovery query plus `ingredient_q` and
`ingredient_cursor`. It returns `{value, label, count}` choices for each facet, 24 canonical
ingredient choices, `ingredient_next_cursor`, and `selected_ingredients` retained outside
the searched page. Ordinary facets exclude their own selected filter from counts;
ingredient candidate counts retain all selected ingredients and add the candidate.
Ingredient-option search matches manually curated aliases without changing recipe results.

`GET /api/v1/videos/{slug}/neighbors/` accepts discovery context without a cursor.
Published recipes outside that context return null directions and `in_context: false`.
Hidden/missing current recipes return 404. `/shorts/{slug}` validates and normalizes the
same context while keeping its canonical/OG/share URL clean. Discovery stores only
history restoration metadata (query, cursor-page depth, scroll and card identity) in
session storage; it rebuilds current pages before restoring scroll/focus.

These endpoints are anonymous and non-personalized, with cookie-free publication checks,
source-expiry enforcement, and representation-based ETags. Public 200/304 responses use
`public, max-age=0, must-revalidate`; errors use no-store. No schema/index changes,
fuzzy search, external search service, accounts, or classifier are required.
