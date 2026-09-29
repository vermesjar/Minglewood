# art/drafts — the Design Lab's working folder

Everything the Design Lab (`http://localhost:5173/studio.html`, see `docs/design-lab.md`) makes lives here until
it's published. Nothing in this folder ships and nothing but this README is committed (`art/.gitignore`).

One folder per draft, named `<key>-<6 hex>`:

| path | what |
|---|---|
| `draft.json` | the spec (furniture or character part), every view (file, anchor, nudge, take, accepted) and the take list |
| `history.jsonl` | one line per event: created, generate (views, cost), accept, publish |
| `refs/` | reference images you uploaded (PNG/JPEG/WebP, ≤ 8 MB, last six kept); `refs_png/` holds their PNG copies for the model |
| `takes/<n>/` | each generation: the pixelized views (`se.png`, `one.png`, `front.map.png`…), the raw model output and the prompt |
| `stage/` | the staged manifest entry and sprites the checks and the publish step read |

Discarding a draft moves it to `.trash/<id>-<time>` — delete that by hand if you really want it gone.
"Export draft" zips the folder.
