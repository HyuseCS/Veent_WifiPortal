# Architecture docs

| File                                                | What it is                                                                            | Edit it?                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `atlas/data.mjs`                                    | **The only source.** Structures, flows, chapters, decisions, questions.               | Yes — this one.          |
| `atlas/build.mjs`                                   | Turns `data.mjs` into the two views below.                                            | No.                      |
| `atlas/template.html`                               | The atlas renderer.                                                                   | Only for visual changes. |
| `atlas.html`                                        | Interactive isometric map — 11 chapters, 5 flows, click to pin, go inside.            | No — generated.          |
| `SYSTEM.md`                                         | Text twin of the same data: decisions table, every structure, flows, questions by ID. | No — generated.          |
| `system-architecture.mmd` / `.svg` / `.png`         | The older single-picture Mermaid diagram. Still accurate, much smaller scope.         | Yes, by hand.            |
| `exactly-once-crediting.mmd`                        | Sequence diagram for the payment-crediting path.                                      | Yes, by hand.            |
| `veent-architecture.html`, `veent-router-seam.html` | Earlier hand-drawn pages.                                                             | Yes, by hand.            |

## Rebuild

```bash
node docs/architecture/atlas/build.mjs
```

Writes `SYSTEM.md` and `atlas.html`. Never hand-edit those two.

## Read it

```bash
python3 -m http.server 8899 --directory docs/architecture
# then open http://localhost:8899/atlas.html
```

`file://` works too, but some in-app browsers render it as a static snapshot.

## Questions

Every open question has an ID (`Q-<code><n>`, e.g. `Q-WG1`) in `SYSTEM.md` and in the atlas's
_Open questions_ tab. Answer one by editing its entry in `data.mjs` from a string to
`{ q: '…', r: '… (date)' }`, then rebuild.

Durable project knowledge still lives in `process/context/` — this folder is the picture, not
the replacement.
