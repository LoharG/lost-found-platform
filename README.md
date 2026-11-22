# Lost & Found Platform

People report lost or found items, find matches, prove ownership privately and
mark items returned. Contact details stay private by default.

| Part | Stack |
|---|---|
| Web (`frontend/`) | Next.js 16 (App Router, server-rendered listing pages), React 19, Tailwind CSS 4, English + Hindi |
| API (`backend/`) | Node 22, Express 5, Passport (Google, Apple, email one-time codes), PostgreSQL 16, sharp |
| Storage | Local disk (dev) or private S3 bucket (prod), always served through the API |
| Delivery | Docker Compose (local), Helm chart for EKS (`deploy/helm/lost-found`), GitHub Actions CI |

## Run it locally

```bash
cp .env.example .env
# set SESSION_SECRET (openssl rand -hex 32) and DB_PASSWORD; Google keys optional
docker compose up -d --build
```

- App: http://localhost:3000 (the browser only ever talks to this origin; `/api` is proxied)
- Local email inbox (sign-in codes, notifications): http://localhost:8025
- API direct (debugging): http://localhost:5000/healthz

On macOS, AirPlay Receiver listens on port 5000. Either turn it off
(System Settings → General → AirDrop & Handoff) or set `API_HOST_PORT=5001`.

### Google sign-in

Register the callback URL in Google Cloud Console → Credentials → your OAuth
client → Authorized redirect URIs. By default it is
`${APP_URL}/api/auth/google/callback` (e.g. `http://localhost:3000/api/auth/google/callback`).
If your client only has `http://localhost:5000/api/auth/google/callback`,
set `GOOGLE_CALLBACK_URL` to that value. Without Google keys the login page
says so and email codes still work.

### Moderators

```bash
docker compose exec backend node scripts/set-role.js someone@example.com moderator
```

## Tests

```bash
# API integration tests against a throwaway PostgreSQL
docker run -d --name lf-testdb -e POSTGRES_PASSWORD=test -p 5544:5432 postgres:16-alpine
cd backend && npm ci && npm test

# Web: lint, types, production build
cd frontend && npm ci && npx eslint . && npm run typecheck && npm run build

# Browser tests: isolated stack (own volumes/ports) with the test-only login fixture
docker compose -p lftest -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
cd frontend && npx playwright install chromium && npx playwright test
docker compose -p lftest -f docker-compose.yml -f docker-compose.e2e.yml down -v
```

## Layout

```
backend/
  server.js            entry: `node server.js` (API) | `node server.js migrate`
  migrations/          ordered SQL, recorded in schema_migrations
  src/                 config, app wiring, auth, routes, services, storage adapters
  scripts/set-role.js  grant moderator/admin
  test/                node:test + supertest against real PostgreSQL
frontend/
  app/                 routes (server-rendered browse/detail, client account/inbox/etc.)
  components/, lib/    UI kit, API client, i18n (lib/i18n/messages.ts)
  e2e/                 Playwright journeys, accessibility, mobile
deploy/helm/lost-found Helm chart for EKS
docs/                  deployment, data retention, release report
```

## Docs

- [Deployment, migrations, rollout and rollback](docs/deployment.md)
- [Finder rewards and the ₹100 paid connection](docs/payments.md)
- [Data retention and deletion](docs/data-retention.md)
- [Release report](docs/release-report.md)
