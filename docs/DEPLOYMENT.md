# Deployment — moved

The deployment guide now lives at **[`docs/deploy/README.md`](deploy/README.md)** — a single doc
covering both paths:

- **Production (Docker VM)** — `compose.prod.yaml`
- **Bare-metal host (no Docker)** — `setup:prod` + systemd

Shared setup lives in the `docs/deploy/` references (router/api-ssl, Sentry alerts, secrets hardening).
