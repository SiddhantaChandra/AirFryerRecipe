# Likes and private Cookbooks

These APIs use the existing browser session and CSRF bootstrap. Every response,
including errors, is private/no-store and non-indexable. Public recipe data
contains only aggregate `like_count`; it never contains personal membership.

## Request and response contract

- `GET /api/v1/me/video-state/?ids=<uuid>,<uuid>` accepts one batch of 1–100
  UUIDs, at most 3,699 characters. Duplicate IDs are collapsed. Returns
  `{results: {"<video_id>": {liked, cookbook_ids: [...]}}}`. Non-published and
  missing IDs are omitted. Source-unavailable published recipes remain visible.
- `POST /api/v1/videos/<uuid>/like/` with `{}` sets liked state and returns
  `{liked: true, like_count}` (200). Repeated requests are successful without
  duplicate rows. `DELETE` with `{}` sets unliked state (204), even if the
  reference is absent, hidden or missing. It never returns recipe fields.
- `GET /api/v1/cookbooks/` returns `{results: [...], limits: {cookbooks, items}}`.
  Each entry has `id`, `name`, `description`, timestamps, `count`, and `cover`
  (a current thumbnail URL object or null). Counts include all retained items.
- `POST` creates with `{name, description?}` (201). `name` is nonblank trimmed
  text of at most 150 characters; description is optional trimmed text of at
  most 2,000 characters. Names need not be unique. No default Cookbook is made.
- `GET /api/v1/cookbooks/<uuid>/` adds `items` and `limits`. `PATCH` accepts
  only name/description (200); `DELETE` with `{}` deletes the collection (204).
- `POST /api/v1/cookbooks/<uuid>/items/` with `{video_id}` sets membership (200,
  `{saved: true}`). A repeated save succeeds at capacity without consuming a
  second slot. New saves require publication, including retries of hidden items.
- `DELETE /api/v1/cookbooks/<uuid>/items/<video_uuid>/` with `{}` sets absent
  membership (204), including absent/hidden items of an existing owned book.
- `PATCH /api/v1/cookbooks/<uuid>/reorder/` with `{video_ids: [...]}` supplies
  exactly the current membership in desired order, including retained hidden
  references. Empty is valid for an empty book. Duplicates, missing/foreign IDs
  and conflicting membership return 409; malformed UUIDs/shapes return 400.
  Success returns the ordered IDs (200). Positions are contiguous, zero-based;
  reads order by `(position, id)`. Clients never assign positions or owners.

JSON objects are bounded to 16 KiB; reorder allows the larger of 16 KiB and
`40 * max(configured item limit, retained item count) + 1024` bytes so raised or
subsequently lowered caps still permit a complete UUID permutation.
Unknown fields are rejected. Mutations must
send JSON, including an empty object for body-free operations. Slashless aliases
behave identically, avoiding mutation redirects. Authentication errors are 401;
CSRF/origin failures 403; non-owned/missing collections and unpublished targets
404; unsupported methods 405; configured capacity conflicts 409. Errors expose
`detail`, with no foreign record data. Staff receive no owner-access exception.

`COOKBOOK_OWNER_LIMIT` and `COOKBOOK_ITEM_LIMIT` are Django settings/environment
variables defaulting to 10 and 200. The response reports effective limits. Reads
do not truncate retained references if a limit is subsequently lowered. The
reorder request bound scales with the effective limit or retained item count.

## Integrity and privacy

All writes lock the active User first, then the owned Cookbook when applicable,
then the target Video for new likes/saves. This intentionally serializes an
owner's writes, making capacity and account-deletion behavior straightforward
for this small archive. Video locks coordinate with editorial UPDATEs: a writer
waiting behind a hide rechecks publication. A completed save may subsequently
be hidden and becomes a generic retained reference.

Database uniqueness guards likes, membership, and positions. Position uniqueness
is deferred to transaction commit so swaps need no temporary gaps. Failed writes
roll back. Owner deletion cascades activity; catalog foreign keys use PROTECT.
No counters, cached cover snapshots or additional infrastructure are introduced.

Hidden/draft items serialize only `video_id`, `position`, `added_at`, and
`state: archive_unavailable`. Published entries additionally include public
recipe data and state `available` or `source_unavailable`. Source snapshots pass
through the existing batched expiry boundary. Covers skip unpublished,
source-unavailable, non-embeddable, expired and thumbnail-less entries. Source
expiry never removes curated details or saved references. Read query counts are
fixed across item counts; existing FK/unique indexes support owner/order lookups.

The save dialog applies checkbox drafts explicitly, one desired-state operation
per changed collection. Successful operations remain persisted if another fails;
failed choices remain available for retry and all queries reconcile. Close
discards unapplied drafts; creating a Cookbook is a separately labeled action
and never claims a recipe was saved. Likes use confirmed responses, with no
optimistic counter/membership updates to roll back.

Personal queries use account-scoped keys and private metadata, consume abort
signals, and use the auth provider's credentialed client. Account lifecycle
changes cancel requests, remove private queries and remount local dialogs.
Focus restoration first checks the session and then revalidates private data and
public counts. Anonymous intent uses only an action fragment in a safe return
URL; login fetches fresh state and requires explicit confirmation. It never
automatically writes or toggles off an already-satisfied like.

## Local verification

`tests/test_cookbooks.py` covers permissions, CSRF, payload bounds, expiry,
redaction, aggregates/validators, cascade/rollback, constant query counts and
independent PostgreSQL connections racing limits, duplicates, ordering,
publication and owner deletion. Existing catalog/account tests remain relevant.
Frontend component tests cover desired states, partial failures, protected
routes, limits, hidden rendering and account-scoped data/dialogs.

The opt-in `frontend/e2e/cookbooks.spec.js` requires three disposable published
fixtures with slugs `phase6-qa-recipe-1` through `-3`. It uses actual account and
activity APIs and deletes its own accounts in cleanup. Provider imagery and the
synthetic player are mocked; a single membership 503 is explicitly injected.
It establishes no provider playback, remote CI or deployed-security evidence.
