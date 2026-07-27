# Secrets & proxy hardening (L-5 / L-7 / NC-1)

Shared reference for **both** deploy paths (see [`README.md`](README.md)). These are
**operator/deploy-time** steps that live outside the code — in each app's real `.env` and the
reverse-proxy config. The code enforces what it can (`validateEnv` fails fast on a missing or
too-short `BETTER_AUTH_SECRET` and warns on a risky `ADDRESS_HEADER`); the rest is per deployment.

## Secrets (L-5, L-7)

- [ ] **`BETTER_AUTH_SECRET` is 32+ chars, random, per-app.** Generate independently for admin,
      customer, and locator — do **not** reuse one value across apps. A shared secret lets a leak from
      the low-value locator/customer forge **admin** sessions and decrypt staff 2FA seeds. Use
      `openssl rand -base64 32` (or `scripts/setup-prod.ts`, which already generates a fresh one).
      `validateEnv` rejects a <32-char secret in production.
- [ ] **`OWNER_PASSWORD` is strong** (not `password123`). `bootstrap-owner` only enforces length ≥ 8;
      pick a long random passphrase for the initial owner and rotate it after first login.
- [ ] **Rotate any secret that has sat in a working-tree `.env`** (Sentry auth token, Resend key,
      MikroTik password) before/after go-live. `.env` files are gitignored (verified never committed),
      but a value that lived on disk should be treated as potentially exposed.
- [ ] **`.env` files stay out of images/backups** — confirm they aren't copied into a container layer
      or a backup path.

## Reverse proxy / client IP (NC-1)

Per-IP rate limits (admin login, 2FA, forgot-password, OTP send/verify, webhook flood cap) are only
sound if the client IP is trustworthy.

- [ ] **If behind a proxy that sets `X-Forwarded-For`:** set `ADDRESS_HEADER=x-forwarded-for` **and**
      `XFF_DEPTH` to the exact number of trusted proxy hops. A wrong/absent `XFF_DEPTH` makes the
      client IP attacker-spoofable (rotate the header to evade every per-IP limit) — or collapses all
      clients to one bucket (self-DoS). `validateEnv` warns when `ADDRESS_HEADER` is set without
      `XFF_DEPTH`.
- [ ] **If NOT behind a proxy:** leave `ADDRESS_HEADER` unset (the default) — adapter-node then uses
      the real TCP peer, which is safe.
- [ ] Treat `XFF_DEPTH` as **security-critical**: verify it against the actual proxy chain, not a guess.
