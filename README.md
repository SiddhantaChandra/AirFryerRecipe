# Air Fryer Shorts Archive

A manually curated YouTube Shorts recipe archive featuring public discovery, responsive vertical video playback, and private user Cookbooks.

## Stack Overview

- **Backend:** Python 3.13, Django 6+, Django REST Framework, PostgreSQL
- **Frontend:** Node 22, React, Vite, Tailwind CSS, TanStack Query
- **Local Infrastructure:** Docker Compose, PostgreSQL

---

## Local Development (Two-Command Start)

### Prerequisites
- Docker & Docker Compose
- Node.js 22 & npm
- Copy `.env.example` to `.env` and configure `YOUTUBE_API_KEY` (if testing live ingestion)

### 1. Start Local Backend & Database
```bash
docker compose up -d
```
Starts `db` (PostgreSQL 17 on port 5433) and `web` (Django on port 8000) with healthchecks.
Check health at: `http://localhost:8000/healthz`

To run database migrations:
```bash
docker compose exec web python manage.py migrate
```

### 2. Start Frontend Dev Server
```bash
npm --prefix frontend run dev
```
Starts the Vite dev server at `http://localhost:5173/` with hot-module reloading and dev proxy for `/api` and `/healthz` to Django.

### Accounts (local)

Rebuild the backend after dependency changes with `docker compose up -d --build web`,
then run migrations. The identity migration checks trimmed, case-insensitive email
collisions before updating existing users. If it stops, resolve the reported collision
condition deliberately; do not reset the database or merge accounts automatically.

Use `/signup`, `/login`, and `/settings` on the Vite origin. Browser-only allauth
operations are explicitly routed under `/_allauth/browser/v1/`; conventional
`/accounts/` and unused headless routes return backend 404s. The private client
bootstraps a CSRF token separately from cookie-free public catalog requests.
Email is a login identifier, is read-only in settings, and is never verified or
used for delivery/recovery. Settings supports name, theme, current-password password
changes, and irreversible password-confirmed deletion. Password changes revoke other
sessions; deletion revokes every session and preserves public catalog content.

Local limits: signup 20/minute/IP, login 30/minute/IP, failed login
10/minute/IP and 5/5 minutes/identifier, password change/deletion 5/minute/user.
Django Admin login is separately limited to 30/minute/IP and 5/5 minutes/identifier.
These use the process-local Django cache; shared-worker, proxy and real HTTPS
abuse/session checks belong to deployment verification. Keep this preview loopback-only.

Run the opt-in real local Accounts browser test against the running preview with
`E2E_ACCOUNTS=1` and optionally `E2E_BASE_URL` in the environment, then
`bun run --cwd frontend test:e2e -- accounts.spec.js`. It creates disposable
`example.invalid` accounts and removes them afterward.
The CLI uses explicit external font/thumbnail fixtures; account APIs and sessions
are real. Use browser inspection for real-font rendering and source-player evidence.

---

## Running Tests & Linters

### Backend Tests & Lint
```bash
# Run backend tests inside Docker
docker compose exec web pytest -c /app/pytest.ini /app/tests/

# Run Ruff linter
ruff check backend
```

### Frontend Tests, Lint, and Build
```bash
# Run Vitest unit & smoke tests
npm --prefix frontend test

# Run ESLint
npm --prefix frontend run lint

# Production build
npm --prefix frontend run build
```
