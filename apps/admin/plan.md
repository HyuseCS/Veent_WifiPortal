# Plan: Real transactional email via Resend (staff activation invites)

## Context

The admin app invites staff by creating a *pending* account and issuing a
password-reset token; the invitee sets their password on `/activate`, which flips
them `pending → active`. The whole flow already works **except the email is never
actually sent** — `auth.ts` `sendResetPassword` just `console.log`s the activation
URL (`TODO(smtp)`). This was deliberately deferred in the previous plan ("SMTP
transport stays deferred"). This task lands the real send via **Resend**, so owners
can invite staff who receive a genuine activation email.

Design goals: (1) follow the existing provider-abstraction pattern so the mailer is
swappable and the call sites never know about Resend; (2) **prioritize security** —
scoped server-only key, no token/PII leakage, verified sender domain, HTML-escaped
content, and no orphaned half-created accounts when a send fails.

**Decisions (confirmed with the user):**
- Transport: **official `resend` SDK** (`resend.emails.send`), wrapped behind a
  provider-agnostic interface.
- Send failure → **roll back the invite** (delete the pending account, surface a clear
  error). No orphaned pending accounts.
- Scope: **reusable mailer + activation invite only.** No "resend invitation" action,
  no customer-app email (out of scope; customer uses SMS OTP).

## Architecture

Mirror the existing `integrations/<service>/` seam (see `integrations/network/` and
`integrations/payments/`): provider-agnostic `types.ts`, a concrete impl, a `stub.ts`
for local dev, and an `index.ts` factory. **Core never reads env** — the admin app
reads env and passes config in (exactly like `apps/admin/src/lib/server/network.ts`).
Email *content* (subject/HTML/text) is admin-specific and lives in the admin app, not
core; core only transports a generic message.

```
packages/core/src/integrations/email/
  types.ts     EmailMessage + EmailProvider interface
  resend.ts    createResendProvider(config) — wraps the resend SDK
  stub.ts      createStubEmailProvider(log) — logs, returns fake id (dev / no key)
  index.ts     EmailConfig union + createEmailProvider() factory
apps/admin/src/lib/server/
  email.ts            env → EmailConfig → mailer            (mirrors network.ts)
  emails/activation.ts  activationEmail({url, name}) → {subject, html, text}
```

## Phase 1 — Email integration in `@veent/core`

1. **`packages/core/package.json`** — add `"resend"` to `dependencies` (run `bun add`
   in the package). This is the one new dep; the repo otherwise uses raw `fetch`, but
   the user opted for the official SDK for typed safety. It's only ever imported by
   server code, so it never reaches a client bundle.

2. **`integrations/email/types.ts`** — provider-agnostic contract:
   ```ts
   export interface EmailMessage {
     to: string;
     subject: string;
     html: string;
     text?: string;        // plaintext fallback (deliverability + no-JS clients)
     replyTo?: string;
   }
   export interface EmailProvider {
     readonly name: string;
     /** Send one email. MUST throw on provider/transport failure — callers treat a
      *  thrown error as "the email did not go out". */
     send(msg: EmailMessage): Promise<{ id: string }>;
   }
   ```

3. **`integrations/email/resend.ts`** — `ResendConfig { apiKey: string; from: string }`,
   `createResendProvider(config)`:
   - `if (!config.apiKey) throw new Error('resend: apiKey not configured')` (fail fast,
     same guard style as `maya.ts`).
   - `const resend = new Resend(config.apiKey)`.
   - `send()` calls `resend.emails.send({ from: config.from, to, subject, html, text, replyTo })`.
   - **Critical:** the SDK returns `{ data, error }` and does **not** throw on API
     errors — check `error` and `throw` so failures propagate (required for rollback).
   - Wrap the call with a bounded timeout (`AbortSignal.timeout(~10s)` or a manual
     race) so a hung send can't stall the invite request.
   - **Never log the message body, recipient, or any token.**

4. **`integrations/email/stub.ts`** — `createStubEmailProvider(log = console.log)`
   mirrors `network/stub.ts`: logs `[email:stub] → <to>: <subject>` (subject only, not
   body) and returns `{ id: 'stub-...' }`. Lets local dev exercise the full invite flow
   with no key and no real send.

5. **`integrations/email/index.ts`** — `export * from './types'`, export both impls,
   plus:
   ```ts
   export type EmailConfig = { provider: 'resend' } & ResendConfig | { provider: 'stub' };
   export function createEmailProvider(config: EmailConfig): EmailProvider { /* switch */ }
   ```
   (default branch throws `Unknown email provider`, matching the other factories.)

6. **`integrations/index.ts`** — add `export * from './email';`.

## Phase 2 — Admin app wiring

7. **`apps/admin/src/lib/server/email.ts`** (new, mirrors `network.ts`):
   ```ts
   import { env } from '$env/dynamic/private';
   import { createEmailProvider, type EmailConfig } from '@veent/core';
   const config: EmailConfig = env.RESEND_API_KEY
     ? { provider: 'resend', apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? 'Veent <onboarding@resend.dev>' }
     : { provider: 'stub' };          // no key in dev → stub-logs, never blocks
   export const mailer = createEmailProvider(config);
   ```
   Choosing the stub when no key is set preserves today's dev behavior and guarantees
   a real send is never *required* locally.

8. **`apps/admin/src/lib/server/emails/activation.ts`** (new) —
   `activationEmail({ url, name })` returns `{ subject, html, text }`:
   - Brand-aligned, minimal inline-styled HTML (email clients ignore external CSS) with
     a single CTA button to `url`, plus the raw URL as text fallback, and a "link
     expires in 24 hours / ignore if unexpected" line.
   - **HTML-escape `name`** (and any interpolated value) before embedding — prevents
     HTML/email injection from the invite form.

## Phase 3 — Send on invite + rollback

9. **`apps/admin/src/lib/server/auth.ts`** — replace the `console.log` stub in
   `sendResetPassword`:
   ```ts
   sendResetPassword: async ({ user, token }) => {
     const url = `${env.ORIGIN}/activate?token=${token}`;
     const { subject, html, text } = activationEmail({ url, name: user.name });
     await mailer.send({ to: user.email, subject, html, text }); // throws on failure
   }
   ```
   No token logging in this path. (The stub provider still logs *subject only* in dev.)

10. **`apps/admin/src/routes/(app)/staff/+page.server.ts`** `invite` action — make the
    create+send atomic. After `signUpEmail` + the `adminProfile` insert, wrap the token
    request and let a send failure roll the account back:
    ```ts
    try {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: '/activate' } });
    } catch {
      await removeStaff(db, userId);              // cascades: deletes user+profile+account
      return fail(502, { error: "Couldn't send the invitation email. Please try again." });
    }
    return { ok: true, action: 'invite', email };
    ```
    `removeStaff` (already in `@veent/core`) deletes the freshly created pending admin and
    is owner-protected, so it's the correct rollback primitive. Error message to the owner
    is generic (no token, no internal detail).

    **Verify at implementation:** confirm better-auth `~1.4.21` *propagates* a throwing
    `sendResetPassword` out of `requestPasswordReset` (some versions swallow callback
    errors to avoid account-enumeration). Quick check: temporarily throw in the callback
    and confirm the action's `catch` fires. **Fallback if swallowed:** keep the token
    generation via `requestPasswordReset` but move the actual `mailer.send` into the
    invite action — generate the activation URL there from the issued token — so the
    action directly observes the send result and can roll back. (Prefer the in-callback
    approach if propagation works, since it also covers the future "resend" path.)

## Phase 4 — Config & docs

11. **`apps/admin/.env.example`** — add, with security guidance in comments:
    ```
    # Resend transactional email (staff activation invites). Server-only secret —
    # never expose to the client, never prefix PUBLIC_. Leave BLANK in dev to use the
    # console stub. Create a key scoped to "Sending access" only and rotate on leak.
    RESEND_API_KEY=""
    # Verified Resend sender. The domain MUST have SPF + DKIM + DMARC configured in
    # Resend (anti-spoofing / deliverability). Format: "Veent <noreply@yourdomain>".
    EMAIL_FROM="Veent <onboarding@resend.dev>"
    ```

## Security checklist (the point of this task)

- **Key handling:** `RESEND_API_KEY` read only via `$env/dynamic/private`; never
  `PUBLIC_`, never logged, never returned to the client. `resend` is imported only
  through `$lib/server/*` + core server code, so it can't be bundled client-side.
- **No token/PII leakage:** the real send path logs nothing; the stub logs subject +
  recipient only, never the token or activation URL body. Owner-facing errors are generic.
- **Content injection:** invite `name` is HTML-escaped before templating.
- **Sender authenticity:** `EMAIL_FROM` must be a Resend-verified domain with
  SPF/DKIM/DMARC — documented in `.env.example`. Prevents spoofed activation emails.
- **Link safety:** activation URL is built from trusted `ORIGIN` + fixed `/activate`
  path (no open redirect); HTTPS in prod. Token remains better-auth's single-use,
  hashed, 24h-TTL reset token — unchanged.
- **No orphaned state:** failed send rolls back the pending account, so a send outage
  can't leave dangling pending/half-activated rows.
- **Bounded send:** timeout/abort on the Resend call so the invite request can't hang.
- **Abuse surface:** invite is already owner-only (`requireOwner` re-checks the DB), so
  no new unauthenticated email-sending surface is introduced. (A future public
  "resend"/"forgot password" would need rate limiting — explicitly out of scope here.)

## Out of scope

Customer-app email (uses SMS OTP) · a "resend invitation" action/button · password-reset
emails for *existing* staff · email open/click tracking · queueing/retry beyond the
single inline send + rollback.

## Verification (end-to-end)

1. **No key (dev):** leave `RESEND_API_KEY` blank → `bun run --filter veent-admin dev`.
   As owner, invite a member → action returns `ok`, pending row created, `[email:stub]`
   logged (subject only). Visit the logged/`/activate` link, set password → `active`,
   can sign in. (Confirms the stub path + full flow still work.)
2. **Real send:** set `RESEND_API_KEY` + a verified `EMAIL_FROM` → invite to a real
   inbox → email arrives, CTA links to `/activate?token=…`, activation works.
3. **Failure → rollback:** set a deliberately bad `RESEND_API_KEY` → invite → action
   returns `fail(502)` with the generic message **and** the would-be account is gone
   (`select * from admin_user where email=…` returns no row; the freed email can be
   re-invited). This is the core security assertion.
4. **Authz unchanged:** as a non-owner admin, invite still 403s (no email, no account).
5. `cd apps/admin && bun run check` → 0 errors. Validate any touched `.svelte` (none
   expected) with the `svelte-autofixer` MCP tool. `grep -rn "TODO(smtp)" apps/admin/src`
   → empty.

## Files

New: `packages/core/src/integrations/email/{types,resend,stub,index}.ts` ·
`apps/admin/src/lib/server/email.ts` · `apps/admin/src/lib/server/emails/activation.ts`
Modified: `packages/core/src/integrations/index.ts` · `packages/core/package.json` ·
`apps/admin/src/lib/server/auth.ts` · `apps/admin/src/routes/(app)/staff/+page.server.ts` ·
`apps/admin/.env.example`

## Status: 📋 PLANNED — implementation on hold

Holding off on implementation: some features were lost in the last rebase and need to be
recovered/reconciled before this lands. Re-verify the current state of the invite flow
(`staff/+page.server.ts`, `auth.ts` `sendResetPassword`, `removeStaff`) against this plan
before starting, in case the baseline shifted.
