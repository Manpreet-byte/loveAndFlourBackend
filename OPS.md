# Ops & Deployment (Backend)

## Environments
- Development: local `docker-compose.yml` or run `npm run dev`
- Staging/Production: use managed MySQL/Redis if possible; keep secrets in platform secret manager

Key flags:
- `NODE_ENV=production`
- `WORKER_ENABLED=false` on API instances if you run a dedicated worker instance
- `REDIS_ENABLED=true` for caching + distributed rate limits
- `METRICS_ENABLED=true` + `METRICS_TOKEN=...` (production)
- `HEALTH_DEEP_TOKEN=...` (production)

## Docker Compose (local)
- Start: `docker compose up --build`
- Backend: `http://localhost:8080/health`

## Migrations
- Recommended workflow:
  - Run `npm run migrate:dry` in CI/staging before deploy
  - Run `npm run migrate` as a one-off release step (or as part of deploy job)
- Safety:
  - Migrations are ordered by filename in `backend/sql` (excluding `schema.sql`)
  - `schema_migrations` stores filename + checksum and prevents silent drift

## Backup & Recovery
MySQL:
- Backup: nightly `mysqldump` (or managed snapshots)
- Verify restores by loading into a scratch DB and running `SELECT COUNT(*)` on critical tables

Redis:
- If self-hosted: keep AOF (`appendonly yes`) and snapshotting enabled
- Treat Redis as cache/infra; MySQL is source of truth

## Scaling
- Run multiple backend instances behind a load balancer.
- Use Redis-backed rate limiting (`REDIS_ENABLED=true`) to avoid per-instance limits.
- Worker separation:
  - API instances: `WORKER_ENABLED=false`
  - One worker instance: `WORKER_ENABLED=true`

## Readiness/Liveness
- Liveness: `GET /health`
- Readiness/Deep checks: `GET /health/deep` (token required in production)

## Deployment checklist
- Confirm `.env` production safety checks pass (see `src/utils/env.js`)
- Run `npm run migrate:dry` and apply migrations if needed
- Validate:
  - `/health`, `/health/deep`
  - `/metrics` (token protected)
  - Redis connectivity if enabled

