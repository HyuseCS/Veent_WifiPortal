# Contract: locator map pass-through

`apps/locator/src/routes/map/[...path]/+server.ts`, logic in `apps/locator/src/lib/server/mapProxy.ts`.
Rules and rewrite: [data-model.md](../data-model.md).

## Request

`GET /map/<path>` or `HEAD /map/<path>` on the locator (any address: `http://10.210.54.133:3003`,
the public origin, `http://localhost:5172` in dev).

- `<path>` is the raw (percent-encoded) URL path after `/map/`.
- The query string is ignored and never sent upstream.
- Request headers are ignored except `Host` and `x-forwarded-proto` (origin for the rewrite).

## Upstream request

`GET https://tiles.openfreemap.org/<path>`

- Headers: exactly `{ accept: '*/*' }`, nothing else. No cookie, referer, `x-forwarded-*`,
  `forwarded`, `cf-connecting-ip`, user agent or client IP.
- `redirect: 'error'`.
- `signal: AbortSignal.timeout(8000)` for fetch and body.
- Global `fetch`, not SvelteKit `event.fetch`.

## Responses

| Case                                                                                                    | Status                                                       | Body                     | Headers set by the route                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------ |
| Path matches, upstream 200, no rewrite                                                                  | 200                                                          | Upstream bytes (decoded) | `content-type` from rule, `cache-control` from rule                      |
| Path matches, upstream 200, rewrite rule, all fetched URLs on the provider                              | 200                                                          | JSON with rewritten URLs | `content-type: application/json`, `cache-control: public, max-age=86400` |
| Rewrite rule, a fetched-URL field or an absolute URL under `sources.*` on another host, or not a string | 502                                                          | empty                    | `cache-control: no-store`                                                |
| Over the rate limit (D12)                                                                               | 429                                                          | empty                    | `cache-control: no-store`, `retry-after: 10`; no upstream request        |
| Path does not match                                                                                     | 404                                                          | empty                    | none; no upstream request is made                                        |
| Upstream 404                                                                                            | 404                                                          | empty                    | `cache-control: no-store`                                                |
| Upstream other non-2xx, network error, redirect, bad JSON                                               | 502                                                          | empty                    | `cache-control: no-store`                                                |
| Timeout (8 s)                                                                                           | 504                                                          | empty                    | `cache-control: no-store`                                                |
| Method other than GET or HEAD                                                                           | 405 (SvelteKit) or 403 (SvelteKit CSRF check for form posts) | SvelteKit default        | no upstream request is made                                              |

Never forwarded from upstream: `content-encoding`, `content-length`, `set-cookie`, `etag`, any other
header. `hooks.server.ts` adds its usual security headers (`X-Content-Type-Options: nosniff`,
`Referrer-Policy`, frame headers) to every response.

## Not logged

No `console.*` in the route. `/map/` requests skip `Sentry.sentryHandle()` (server) and create no
browser tracing span and no breadcrumb (client).
