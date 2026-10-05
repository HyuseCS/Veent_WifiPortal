# Project Knowledge

Durable facts about Veent WiFi Portal. Read the file that matches your task.

| File              | Covers                                                                     | Read when                                                    |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `architecture.md` | Apps, packages, repo layout, tech stack, code patterns, env vars, workflow | You are new to the repo, or you need the big picture         |
| `integrations.md` | MikroTik/RouterOS, walled garden, Maya, Sentry, SMS/OTP, Resend            | You touch the router, payments, SMS, email, or Sentry        |
| `auth.md`         | The two better-auth instances, admin 2FA, customer phone OTP               | You touch login, sessions, 2FA, or role guards               |
| `database.md`     | Drizzle schema, migrations, DB client, shared tables                       | You change a table or run a migration                        |
| `testing.md`      | Test runners, commands, e2e harness, CI, known gaps                        | You run or write tests                                       |
| `ui.md`           | Admin design system, Tailwind 4 tokens, Svelte 5 rules                     | You build or change UI                                       |
| `gotchas.md`      | Traps that break things                                                    | Before any change to the router, payments, auth, or sessions |

Related docs outside this folder:

- `docs/deploy/README.md` - deployment guide (Docker and bare metal).
- `docs/mikrotik/walled-garden.md` - the canonical walled-garden reference.
- `docs/design/DESIGN_GUIDELINES.md` - design token rationale.
- `docs/architecture/` - system diagrams.
