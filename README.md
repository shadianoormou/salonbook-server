# SalonBook — Server

The REST API for SalonBook, a salon appointment booking platform for Assignment 9, Category 002. The server owns authentication, roles, appointment rules, image uploads, checkout creation, and payment verification.

## Project links

- Server: https://github.com/shadianoormou/salonbook-server
- Client: https://github.com/shadianoormou/salonbook-client
- Live API: pending production database and integration configuration.

## Features and technology

Node.js, Express 5, MongoDB, Better Auth, JWT/JWKS verification with JOSE, Stripe, ImgBB, Zod, Helmet, CORS, and request limits.

- Active-service catalog with search, categories, price sorting, and pagination.
- Credential and Google authentication; public signup always creates customers.
- Signed JWT, current-session, database role, and blocked-status checks on protected APIs.
- Atomic appointment transactions and a unique active-slot index prevent simultaneous duplicate bookings.
- Customers see only their appointments and cancel only pending requests.
- Admin service management, appointment confirmation/cancellation, and customer blocking.
- Profile fields are allowlisted; role and blocked status cannot be changed by profile updates.
- Price snapshots determine checkout totals; only a verified matching Stripe event marks appointments paid.
- Idempotent transaction reconciliation checks session reference, customer, amount, currency, and checkout mode.
- Authenticated ImgBB uploads check file signatures, allowed types, and a 5 MB limit.

## Local installation

Use Node.js 24, pnpm 11, and a MongoDB replica set. Atlas is supported; transactions require a replica set.

```sh
git clone https://github.com/shadianoormou/salonbook-server.git
cd salonbook-server
pnpm install --frozen-lockfile
cp .env.example .env
```

Fill in your own environment settings. For a development database, run this in a separate terminal and keep it running:

```sh
pnpm dev:database
```

This downloads an official MongoDB development binary and starts a local replica set. Its data directory is ignored by Git. With Atlas, use your own replica-set connection instead.

```sh
pnpm seed
pnpm dev
```

The seed adds seven sample services without overwriting existing data. It provisions an administrator only when both administrator environment fields are supplied. There are no hardcoded administrator credentials.

## Environment variable names

- `PORT`, `NODE_ENV`
- `MONGODB_URI`, `MONGODB_DB`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `AUTH_INTERNAL_URL`, `CLIENT_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`
- `IMGBB_API_KEY`, `SALON_TIMEZONE`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` for secure provisioning

Keep `.env` private. Generate a random Better Auth secret of at least 32 characters. The public frontend origin is also the Better Auth origin because Next.js proxies authentication. Google's redirect URI uses that origin plus `/api/auth/callback/google`.

Provision the admin against the intended database. Supply evaluator credentials privately after verifying them on the live website, and remove the provisioning password from the production runtime afterward.

## Database architecture

- `users`: Better Auth users with role, blocked status, and optional phone.
- `services`: service details, price, duration, hosted image, active status, and timestamps.
- `appointments`: customer/service references, date, slot, message, price/currency snapshot, statuses, and reservation/checkout metadata.
- `transactions`: appointment/customer references, verified checkout, amount, currency, status, event reference, and timestamp.

Better Auth also manages its required account, session, verification, and signing-key collections. User identity is not duplicated into another application collection.

The salon has one reservation capacity per date/time slot across services. Cancelled appointments release their slots. Services with appointment history are deactivated rather than deleted to preserve references and payment history.

## API groups

- Public: `/api/health`, `/api/config`, `/api/services`, `/api/services/categories`
- Better Auth: `/api/auth/*`
- Protected service details and slots: `/api/services/:id`, `/api/services/:id/slots`
- Customer appointments: `/api/appointments`
- Profile, statistics, history: `/api/profile`, `/api/overview`, `/api/transactions`
- Admin: `/api/admin/services`, `/api/admin/appointments`, `/api/admin/users`
- Uploads: `/api/uploads`
- Checkout: `/api/payments/:id/checkout`
- Signed Stripe webhook: `/api/payments/webhook`

## Tests

```sh
pnpm test
```

Tests create an isolated MongoDB replica set. They cover registration privilege protection, service visibility, JWT rejection, role checks, ownership, booking races, status transitions, profile restrictions, blocking, slot release, and signed webhook replay. Stripe-signed fixtures do not charge a card or replace a real test-mode Checkout test.

## Deployment

The root `index.js` exports Express for Vercel. `src/server.js` starts the same application on a conventional Node host.

1. Configure a production MongoDB replica set and environment values.
2. Import the server into Vercel as Express, or run `pnpm start` on a Node host.
3. Deploy the client and point its API proxy to this server.
4. Match the client and Better Auth origins, then redeploy as needed.
5. Provision an admin using the intended production database.
6. Send Stripe test-mode webhooks to the public server's `/api/payments/webhook` endpoint.
7. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
8. Complete test-mode Checkout; verify one transaction and a paid appointment, then replay the event to confirm idempotency.

The webhook is mounted before JSON parsing to preserve its raw body. A return URL is not payment evidence. See [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment) and [Better Auth Express integration](https://better-auth.com/docs/integrations/express).

## Current status

Local integration tests and browser booking/confirmation flows pass. Production deployment, Google OAuth, ImgBB delivery, and actual Stripe test-mode Checkout depend on production account configuration. No live secrets are committed.
