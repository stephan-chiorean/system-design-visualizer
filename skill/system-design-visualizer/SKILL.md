---
name: system-design-visualizer
description: Convert a system design discussion into the design JSON that the System Design Visualizer renders as an interactive 3D scene. Use when the user asks to visualize, diagram, or "see" a system design, or asks for a design JSON for the visualizer.
---

# System Design Visualizer — authoring

You are the author. The app is only a renderer: it draws what this JSON says and
knows nothing else about the system. Everything a reader will learn comes from
fields you write here.

Write the file as `<slug>.json` into the visualizer's `designs/` folder, then add
a row to `designs/index.json`. If the user is working somewhere else, write it
wherever they ask and tell them they can drop the file onto the visualizer window.

## The one thing that matters

**Flows are the payload.** A design with good nodes and no flows is a worse 2D
diagram. A design with three well-written flows is something a person can watch
and understand. If you are short on effort, spend it on `flows[].steps`.

## Shape

```json
{
  "version": "1.0",
  "title": "…",
  "summary": "One or two sentences naming the actual hard part.",
  "layers": [ { "id": "edge", "label": "Edge" } ],
  "nodes":  [ { "id": "cdn", "kind": "cdn", "label": "CDN", "layer": "edge", "notes": "…" } ],
  "edges":  [ { "from": "cdn", "to": "lb", "kind": "sync", "label": "cache miss", "volume": 0.3 } ],
  "flows":  [ { "id": "read", "label": "Resolve a link", "path": ["browser","cdn","lb"], "steps": ["…","…"] } ]
}
```

### layers (required, ordered)

Declared order is top-to-bottom in the scene. First layer is where traffic
enters; last is where state comes to rest. A request visibly descends the stack,
so **order them by depth, not by importance**.

Three to five layers. `Clients · Edge · Application · State · Asynchronous` fits
most designs. Fewer than three and the 3D is pointless; more than six and the
stack gets too tall to read.

### nodes

| Field | Notes |
| --- | --- |
| `id` | short, stable, referenced by edges and flows |
| `kind` | picks the silhouette — see below |
| `label` | what it's called on screen |
| `layer` | must match a declared layer id |
| `replicas` | 1–12; drawn as a fanned stack, so use it when count is part of the point |
| `tech` | concrete choice (`Redis`, `DynamoDB`) — shown under the label |
| `notes` | **why this component exists**; shown on hover |
| `metrics` | free-form key/value, e.g. `{ "rps": 50000, "p99_ms": 25 }` |

`kind` is one of: `client`, `cdn`, `lb`, `gateway`, `service`, `worker`, `cache`,
`db`, `blob`, `queue`, `search`, `analytics`, `external`. An unknown kind renders
as `service` with a warning.

**`notes` is the highest-value field in the file.** Write the sentence you would
say out loud defending the component in a design review — the tradeoff, not the
definition. "Slug → destination with a TTL; the hit rate here is what keeps the
database boring" beats "a Redis cache".

### edges

`from` and `to` are node ids. `kind` is `sync` (solid), or `async` / `stream` /
`batch` (dashed). `volume` is 0–1 relative traffic and sets the tube's thickness —
make the hot path visibly thicker than the cold one. `protocol` and `label` are
short strings; `label` floats on the connection, so keep it under ~20 characters.
`bidirectional: true` adds a second arrowhead.

### flows

`path` is a list of node ids, each consecutive pair ideally matching a declared
edge (a missing edge still renders, as a straight line, with a warning).

`steps[i]` describes the hop **arriving at** `path[i+1]`, so there is one fewer
step than there are nodes. Each step shows in the sidebar as the particles reach
that hop.

Write steps as narration, present tense, one idea each. They are read at about
one per second while the camera flies to the node, so a step is a sentence, not a
paragraph.

Three to five flows. Good sets contrast rather than repeat:

- the fast path (cache hit)
- the same request when it misses — make the extra cost visible
- the write path
- the asynchronous path that was deliberately kept off the critical path

## Process

1. Work out the design with the user first. Do not start from the JSON.
2. Lay out layers by depth, then place every component on one.
3. Draw edges, setting `volume` honestly — the thickness is information.
4. Write flows last, because they tell you which edges you forgot.
5. Write `notes` on everything load-bearing. Skip it on the obvious.
6. Save, add the `designs/index.json` row, and tell the user which flow to play first.

## Checks before you hand it over

- Every `flows[].path` id exists, and consecutive pairs have edges.
- `steps` has exactly `path.length - 1` entries.
- The hot path has the thickest `volume` values in the file.
- Every node either carries a `notes` string or is genuinely self-explanatory.
- At least two flows, and at least one that is *not* the happy path.
