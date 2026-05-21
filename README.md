# Backend (Node.js + Express + MySQL)

## Setup
- `cd backend`
- `cp .env.example .env`
- `npm install`
- Create MySQL database `DB_NAME` from `.env`
- Apply schema: run `backend/sql/schema.sql` in MySQL
- If upgrading an existing DB, apply: `backend/sql/2026-05-12_security_hardening.sql`
- Payments/orders DB upgrade: apply `backend/sql/2026-05-12_payments_orders.sql`
- LMS core DB upgrade: apply `backend/sql/2026-05-12_lms_core.sql`
- Certificates DB upgrade: apply `backend/sql/2026-05-13_certificates.sql`
- Search DB upgrade: apply `backend/sql/2026-05-13_search_fulltext.sql`
- Admin analytics DB upgrade: apply `backend/sql/2026-05-13_admin_analytics.sql`
- Audit logs DB upgrade: apply `backend/sql/2026-05-13_audit_logs.sql`
- Razorpay test/live keys in DB: apply `backend/sql/2026-05-15_razorpay_provider_config.sql`
- Ensure `JWT_ACCESS_SECRET` + `TOKEN_HASH_SECRET` are set in `.env`
  - In production, defaults are rejected (see `src/utils/env.js`)
- Optional: configure Redis for caching + distributed rate limits
  - `REDIS_ENABLED=true`, `REDIS_URL=redis://...`

## Migrations (recommended)
- Dry run: `npm run migrate:dry`
- Apply pending migrations: `npm run migrate`

## Sync frontend "offline" workshops into DB
If the frontend is showing workshops from its offline seed list, but `/api/public/courses/:slug` returns `Course not found`,
sync the frontend seed data into the backend DB:
- `npm run seed:frontend`

## Run
- Dev: `npm run dev`
- Prod: `npm start`

## Health
- `GET /health` (basic)
- `GET /health/deep` (deep checks)
  - In production, requires `HEALTH_DEEP_TOKEN` and header `x-health-token`

## Metrics
- `GET /metrics`
  - In production, requires `METRICS_TOKEN` and `Authorization: Bearer <token>`

## Email automation (Zoom + recordings + reminders)
Emails are queued into `email_outbox` and sent by an in-process worker started by `src/server.js`.

To enable real emails, configure SMTP in `.env`:
- `SMTP_PROVIDER` (optional): `custom|gmail|sendgrid|mailgun`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`
- Optional hardening: `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_TLS_REJECT_UNAUTHORIZED`

If SMTP is not configured, the backend logs the email payload in development.

Admin operational endpoints:
- `GET /api/admin/emails/stats`
- `GET /api/admin/emails/outbox`
- `POST /api/admin/emails/outbox/:id/resend`

Automated notifications:
- Live session scheduled/updated (includes Zoom join URL when present)
- Reminders:
  - `reminder_24h`: when session is 23–24 hours away
  - `reminder_1h`: when session is within the next 60 minutes
- Recording available (when a recording is uploaded for a session)

## Admin bootstrap
Signup creates users with role `user` by default. To create the first admin:
- `npm run create:admin -- --name="Admin" --email="admin@example.com" --password="password123"`

## Admin APIs (JWT + RBAC)
All routes below require `Authorization: Bearer <token>` and role `admin`, except bootstrap.
- `POST /api/admin/bootstrap` (one-time, requires `ADMIN_BOOTSTRAP_SECRET`, creates first admin + returns token)
  - In production, this endpoint is disabled unless `ADMIN_BOOTSTRAP_ENABLED=true`
- `POST /api/admin/bootstrap/promote` (development only: promote/create an admin using `ADMIN_BOOTSTRAP_SECRET`)
- `GET /api/admin/dashboard`
- `POST /api/admin/admins` (create another admin)
- `POST /api/admin/courses`, `GET /api/admin/courses`, `PATCH /api/admin/courses/:id`, `DELETE /api/admin/courses/:id`
- `POST /api/admin/categories`, `GET /api/admin/categories`, `DELETE /api/admin/categories/:id`
- `POST /api/admin/recipes`, `GET /api/admin/recipes?category_id=...`
- `POST /api/admin/live-sessions`, `GET /api/admin/live-sessions?course_id=...`, `PATCH /api/admin/live-sessions/:id`
- `POST /api/admin/recordings`, `GET /api/admin/recordings?course_id=...`
- `GET /api/admin/users`
- `GET /api/admin/enrollments`, `POST /api/admin/enrollments`, `DELETE /api/admin/enrollments/:id`

## User feed (JWT)
- `GET /api/feed/enrollments`
- `GET /api/feed/recordings`

## Auth (access + refresh)
- Access token: returned in JSON and sent by clients via `Authorization: Bearer <token>`
- Refresh token: stored in an HttpOnly cookie (rotated on each refresh)

Endpoints:
- `POST /api/auth/signup`, `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`, `POST /api/auth/logout-all`
- `POST /api/auth/email/verify`, `POST /api/auth/email/resend`
- `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`

## Orders + payments (Razorpay)
- `POST /api/orders` (JWT): creates an order + payment session (returns Razorpay `order_id` for checkout)
- `GET /api/orders/:id` (JWT): order details + items + payments
- `POST /api/webhooks/razorpay` (no auth): Razorpay webhooks (signature-verified, idempotent)

## LMS core (lessons + progress)
User APIs (JWT):
- `GET /api/user/courses` (enrolled courses with progress summary)
- `GET /api/user/courses/:id/lessons` (published lessons + per-lesson progress)
- `POST /api/user/lessons/:id/start`
- `POST /api/user/lessons/:id/complete`
- `GET /api/user/progress/:courseId`

Admin APIs (JWT + role=admin):
- `POST /api/admin/courses/:id/lessons`
- `GET /api/admin/lessons/:id`
- `PATCH /api/admin/lessons/:id`
- `DELETE /api/admin/lessons/:id`
- `PUT /api/admin/lessons/reorder`

## Certificates
Public:
- `GET /api/certificates/verify/:code`

Admin (JWT + role=admin):
- `POST /api/admin/certificates/:id/revoke`
- `POST /api/admin/certificates/:id/reactivate`

## Search
Public:
- `GET /api/search?q=...`
- `GET /api/search/courses?q=...&category_id=...&level=...&language=...`
- `GET /api/search/recipes?q=...&category_id=...`
- `GET /api/search/suggestions?q=...`

## Admin analytics (JWT + role=admin)
- `GET /api/admin/analytics/dashboard`
- `GET /api/admin/analytics/revenue?from=&to=`
- `GET /api/admin/analytics/courses/:id`
- `GET /api/admin/analytics/users?from=&to=`

## Audit logs
Admin (JWT + role=admin):
- `GET /api/admin/audit-logs?actor_id=&actor_type=&action_type=&entity_type=&from=&to=&page=&limit=`

User (JWT):
- `GET /api/user/activity`

## Health
- `GET /health`
