# System Design Visualizer

Renders a system design, described as JSON, as an interactive 3D scene you can
play request flows through.

The app is **only a renderer**. Designs are authored by an agent using the skill
in `skill/system-design-visualizer/`, and the app knows nothing about systems
beyond what a design file tells it.

## Run it

Two ways, same frontend.

**Desktop app** — adds the skill installer and a native file picker:

```bash
npm install
npm run dev          # or: npm run build, for a .app and .dmg
```

**In a browser** — no build step, nothing to install:

```bash
npm run web          # serves web/ on http://localhost:8777
```

(`file://` will not work — ES modules and `fetch` both need an origin.)

## Install the authoring skill

In the desktop app, press **Skill** in the top bar. It writes the bundled
`SKILL.md` into the agent directories you actually have — `~/.claude/skills/`
and `~/.codex/skills/` — and reports the state of each.

A copy you have edited yourself is classified `custom` and never overwritten
unless you explicitly choose to. Remove only deletes what the app installed.

The browser build cannot do this: a page has no filesystem access. Copy the
skill by hand, or use the desktop app.

## Use it

- **Design** picker loads anything listed in `web/designs/index.json`.
- **Open JSON…**, or drag a design file anywhere onto the window, to render one
  that isn't bundled.
- Click a **flow** to play it. Particles travel the path, the current hop lights
  up, everything off-path dims, and the sidebar narrates each step.
- Hover or click any node or connection to inspect it. Click empty space or press
  <kbd>Esc</kbd> to release.
- `1`–`9` play a flow · <kbd>Space</kbd> pause · <kbd>R</kbd> reset view · drag to
  orbit · scroll to zoom.

## Author a design

Point an agent at `skill/system-design-visualizer/SKILL.md`. Then check it:

```bash
npm run validate                             # everything in the manifest
node tools/validate.mjs path/to/design.json  # one file
```

The validator enforces the schema and flags authoring problems the renderer will
survive but a reader won't enjoy — flows with no steps, nodes with no notes,
hops crossing connections that were never declared.

## Layout

```
web/                    the frontend — runs in a browser and in the shell alike
  index.html            markup and the import map (three.js from a CDN)
  src/schema.js         v1 schema: validation + normalization
  src/layout.js         layered layout, barycentre ordering
  src/kinds.js          the node-kind registry — the app's only domain opinions
  src/flows.js          flow playback
  src/scene/            nodes, edges, stage (planes + lighting)
  src/ui.js             sidebar; no three.js imports
  src/desktop.js        desktop-only features, inert in a browser
  src/main.js           renderer, camera, picking, load→build→render
  designs/              design files + the picker manifest
src-tauri/              desktop shell (Tauri 2)
  src/skill_install.rs  global skill install, with a four-state classifier
tools/validate.mjs      schema checker for CI or a terminal
skill/                  the agent-facing authoring contract
```
