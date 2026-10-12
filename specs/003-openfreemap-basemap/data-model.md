# Data Model: OpenFreeMap Basemap

No persisted data. No schema or migration change. No server store (D8).

## Pass-through rule (in code, `apps/locator/src/lib/server/mapProxy.ts`)

One entry per allowed path family. Fields:

| Field     | Type                                          | Rule                                                                                     |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pattern` | anchored RegExp on the raw path after `/map/` | Must match the whole path. Free parts allow no `/`, no `.` segment and no encoded slash. |
| `type`    | string                                        | The `content-type` sent to the device. Never copied from upstream.                       |
| `cache`   | `DAY` or `LONG`                               | `DAY` = `public, max-age=86400`. `LONG` = `public, max-age=31536000, immutable`.         |
| `rewrite` | boolean                                       | True only for the style and the TileJSON.                                                |

Patterns (copy these, not a markdown table cell, so no `|` gets escaped):

```text
style        ^styles/(?:positron|dark)$
tilejson     ^planet$
tile         ^planet/\d{8}_\d{6}_[a-z]+/\d{1,2}/\d{1,5}/\d{1,5}\.pbf$
relief       ^natural_earth/ne2sr/\d{1,2}/\d{1,5}/\d{1,5}\.png$
font         ^fonts/(?:[\w,-]|%20)+/\d{1,5}-\d{1,5}\.pbf$
sprite-json  ^sprites/ofm_[a-z0-9]+/ofm(?:@2x)?\.json$
sprite-png   ^sprites/ofm_[a-z0-9]+/ofm(?:@2x)?\.png$
```

| Family      | `type`                   | `cache` | `rewrite` |
| ----------- | ------------------------ | ------- | --------- |
| style       | `application/json`       | DAY     | yes       |
| tilejson    | `application/json`       | DAY     | yes       |
| tile        | `application/x-protobuf` | LONG    | no        |
| relief      | `image/png`              | LONG    | no        |
| font        | `application/x-protobuf` | LONG    | no        |
| sprite-json | `application/json`       | LONG    | no        |
| sprite-png  | `image/png`              | LONG    | no        |

## Rewritten fields

Style: `sprite` (string, or array of `{ id, url }`), `glyphs`, `sources.*.url`, `sources.*.tiles[]`.
TileJSON: `tiles[]`.

Each value must start with `https://tiles.openfreemap.org/`. It becomes `<origin>/map/<rest>`.
Placeholders such as `{z}`, `{fontstack}` and `{range}` stay as they are. Any other value in these
fields refuses the whole response with 502. All other fields (attribution, description, layers)
are passed through unchanged.

## Request origin

`<origin>` = `<scheme>://<host>`:

- `host`: the `Host` header when it matches `^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$`.
- `scheme`: `https` when `x-forwarded-proto` is exactly `https`, else `http`.
- Host missing or invalid: `event.url.origin`.

## Basemap style per theme (client)

| App     | `data-theme`  | Style URL                                       |
| ------- | ------------- | ----------------------------------------------- |
| Admin   | `dark`        | `https://tiles.openfreemap.org/styles/dark`     |
| Admin   | anything else | `https://tiles.openfreemap.org/styles/positron` |
| Locator | `dark`        | `<location.origin>/map/styles/dark`             |
| Locator | anything else | `<location.origin>/map/styles/positron`         |

Attribution, both apps (FR-006):
`<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>`
