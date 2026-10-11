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
