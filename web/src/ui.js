/**
 * Sidebar and chrome. Pure DOM — this module never imports three.js, and main.js
 * never writes innerHTML. The split keeps the renderer readable.
 */

import { kindOf } from './kinds.js';
import { layerColor } from './scene/stage.js';

const $ = (id) => document.getElementById(id);

export function renderDesignPanel(design) {
  $('design-title').textContent = design.title;
  $('design-summary').textContent = design.summary;

  const meta = $('design-meta');
  meta.replaceChildren();
  const rows = [
    ['Layers', design.layers.length],
    ['Nodes', design.nodes.length],
    ['Connections', design.edges.length],
    ['Flows', design.flows.length],
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    meta.append(dt, dd);
  }
}

export function renderFlowList(design, onSelect) {
  const list = $('flow-list');
  list.replaceChildren();

  if (design.flows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.fontSize = '12px';
    empty.textContent = 'This design declares no flows.';
    list.append(empty);
    return;
  }

  for (const flow of design.flows) {
    const button = document.createElement('button');
    button.className = 'flow-btn';
    button.dataset.flowId = flow.id;

    const label = document.createElement('span');
    label.className = 'fl-label';

    // When a design colour-codes its flows, the swatch is how you tell which
    // trail you are watching once two of them have been played back to back.
    if (flow.color) {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      Object.assign(swatch.style, {
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '2px',
        marginRight: '6px',
        background: flow.color,
      });
      label.append(swatch);
    }

    label.append(flow.label);

    const sub = document.createElement('span');
    sub.className = 'fl-sub';
    sub.textContent = flow.notes || `${flow.flatPath.length} hops`;

    button.append(label, sub);
    button.addEventListener('click', () => onSelect(flow));
    list.append(button);
  }
}

/**
 * The step list over the scene.
 *
 * Every step is rendered, not just the current one: a reader watching a request
 * move wants to know how far through it is and what is coming, which a single
 * live line cannot say. Contrast does the work instead — the current step is
 * bright, the rest are dimmed but present, and hovering one brings it up to
 * full strength so it can be read without losing your place.
 */
export function renderSteps(flow, design) {
  const panel = $('steps');
  const list = $('steps-body');
  list.replaceChildren();

  if (!flow) {
    panel.hidden = true;
    $('steps-show').hidden = true;
    return;
  }

  $('steps-title').textContent = flow.label;

  flow.path.forEach((entry, i) => {
    const item = document.createElement('li');
    item.className = 'step';
    item.dataset.index = String(i);

    // One wrapper, so the row is exactly two grid items: the number and this.
    // Three items in a two-column grid wraps the text into the number column.
    const body = document.createElement('div');
    body.className = 'step-body';

    const name = document.createElement('span');
    name.className = 'step-node';
    // A parallel group is one step reaching several nodes, so it is named as
    // the list it is rather than as its first member.
    name.textContent = [entry]
      .flat()
      .map((id) => design.nodeById.get(id)?.label ?? id)
      .join(' · ');

    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = flow.steps[i] ?? '';

    body.append(name, text);
    item.append(body);
    list.append(item);
  });

  const collapsed = panel.dataset.collapsed === 'true';
  panel.hidden = collapsed;
  $('steps-show').hidden = !collapsed;
}

export function markCurrentStep(index) {
  for (const item of document.querySelectorAll('#steps-body .step')) {
    item.classList.toggle('current', Number(item.dataset.index) === index);
  }
}

/** Hide and restore the step list. The collapsed choice survives flow changes. */
export function wireStepsPanel() {
  const panel = $('steps');
  const toggle = $('steps-toggle');
  const show = $('steps-show');

  const setCollapsed = (collapsed) => {
    panel.dataset.collapsed = String(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    // Only ever visible while a flow is playing, which is what having steps
    // rendered stands for.
    const hasFlow = $('steps-body').childElementCount > 0;
    panel.hidden = collapsed || !hasFlow;
    show.hidden = !collapsed || !hasFlow;
  };

  toggle.addEventListener('click', () => setCollapsed(true));
  show.addEventListener('click', () => setCollapsed(false));
  setCollapsed(false);
}

/** The Explore / Focus switch. */
export function wireViewMode(onChange) {
  for (const button of document.querySelectorAll('#view-mode button')) {
    button.addEventListener('click', () => {
      setViewMode(button.dataset.mode);
      onChange(button.dataset.mode);
    });
  }
}

export function setViewMode(mode) {
  for (const button of document.querySelectorAll('#view-mode button')) {
    button.classList.toggle('on', button.dataset.mode === mode);
  }
}

const THEME_GLYPH = { system: '◐', light: '☀', dark: '☾' };
const THEME_TITLE = {
  system: 'Theme: following the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function setThemeGlyph(choice) {
  $('theme-glyph').textContent = THEME_GLYPH[choice] ?? THEME_GLYPH.system;
  $('btn-theme').title = THEME_TITLE[choice] ?? THEME_TITLE.system;
}

export function markActiveFlow(flowId) {
  for (const button of document.querySelectorAll('.flow-btn')) {
    button.classList.toggle('active', button.dataset.flowId === flowId);
  }
  $('flow-transport').hidden = flowId === null;
}

export function renderHop(hop) {
  const box = $('hop-readout');
  box.replaceChildren();
  if (!hop) return;

  const step = document.createElement('span');
  step.className = 'hop-step';
  step.textContent = `Step ${hop.index + 1} of ${hop.total}`;

  const name = document.createElement('b');
  name.className = 'hop-name';
  name.textContent = hop.node.label;

  const note = document.createElement('span');
  note.className = 'hop-note';
  note.textContent = hop.step || hop.node.notes || '';

  box.append(step, name, note);
}

export function renderInspector(subject) {
  const box = $('inspector');
  box.replaceChildren();

  if (!subject) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Hover or click a node or connection.';
    box.append(p);
    return;
  }

  if (subject.type === 'node') {
    const node = subject.node;
    const kind = document.createElement('span');
    kind.className = 'ins-kind';
    kind.textContent = kindOf(node.kind).label;

    const title = document.createElement('h3');
    title.textContent = node.label;

    box.append(kind, title);

    if (node.tech) {
      const tech = document.createElement('p');
      tech.className = 'muted';
      tech.textContent = node.tech;
      box.append(tech);
    }
    if (node.notes) {
      const notes = document.createElement('p');
      notes.className = 'ins-note';
      notes.textContent = node.notes;
      box.append(notes);
    }

    const stats = document.createElement('div');
    stats.className = 'stats';
    if (node.replicas > 1) stats.append(stat('replicas', node.replicas));
    for (const [key, value] of Object.entries(node.metrics)) {
      stats.append(stat(key.replace(/_/g, ' '), value));
    }
    if (stats.childElementCount) box.append(stats);
    return;
  }

  const edge = subject.edge;
  const kind = document.createElement('span');
  kind.className = 'ins-kind';
  kind.textContent = `${edge.kind}${edge.protocol ? ` · ${edge.protocol}` : ''}`;

  const title = document.createElement('h3');
  title.textContent = `${subject.fromLabel} → ${subject.toLabel}`;

  box.append(kind, title);

  if (edge.label) {
    const label = document.createElement('p');
    label.className = 'muted';
    label.textContent = edge.label;
    box.append(label);
  }
  if (edge.notes) {
    const notes = document.createElement('p');
    notes.className = 'ins-note';
    notes.textContent = edge.notes;
    box.append(notes);
  }
}

function stat(name, value) {
  const el = document.createElement('div');
  el.className = 'stat';
  const b = document.createElement('b');
  b.textContent = String(value);
  const span = document.createElement('span');
  span.textContent = ` ${name}`;
  el.append(b, span);
  return el;
}

/** `hidden` carries the user's unticked layers across a rebuild. */
export function renderLayerList(design, onToggle, hidden = new Set()) {
  const list = $('layer-list');
  list.replaceChildren();

  design.layers.forEach((layer, i) => {
    const count = design.nodes.filter((n) => n.layer === layer.id).length;

    const row = document.createElement('label');
    row.className = 'layer-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hidden.has(layer.id);
    checkbox.addEventListener('change', () => onToggle(layer.id, checkbox.checked));

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = layerColor(i);

    const name = document.createElement('span');
    name.textContent = layer.label || layer.id;

    const tally = document.createElement('span');
    tally.className = 'count';
    tally.textContent = String(count);

    row.append(checkbox, swatch, name, tally);
    list.append(row);
  });
}

/**
 * Wire the picker once, then fill it. The design library can change while the
 * app is open, so the option list is re-rendered on its own — re-attaching the
 * change listener each time would stack duplicate handlers.
 */
export function renderDesignPicker(manifest, onPick) {
  const picker = $('design-picker');
  if (!picker._wired) {
    picker._wired = true;
    picker.addEventListener('change', () => onPick(picker.value));
  }
  updatePickerOptions(manifest);
}

export function updatePickerOptions(manifest) {
  const picker = $('design-picker');
  const selected = picker.value;
  picker.replaceChildren();

  // Keep the user's own designs visually separate from the shipped examples;
  // an unlabelled mix of the two is hard to read once the library grows.
  const groups = [
    ['Your designs', manifest.filter((m) => m.external)],
    ['Examples', manifest.filter((m) => !m.external)],
  ];

  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    const parent =
      groups.filter(([, list]) => list.length).length > 1
        ? Object.assign(document.createElement('optgroup'), { label })
        : picker;
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.file;
      option.textContent = item.title;
      parent.append(option);
    }
    if (parent !== picker) picker.append(parent);
  }

  // Re-rendering must not look like the user picked something else.
  if ([...picker.options].some((o) => o.value === selected)) picker.value = selected;
}

export function setPickerValue(file) {
  const picker = $('design-picker');
  if ([...picker.options].some((o) => o.value === file)) picker.value = file;
}

export function showDiagnostics(errors, warnings) {
  const box = $('errors');
  box.replaceChildren();

  const items = errors.length ? errors : warnings;
  if (items.length === 0) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  box.classList.toggle('warn', errors.length === 0);

  const heading = document.createElement('h4');
  heading.textContent = errors.length
    ? `This design could not be rendered (${errors.length})`
    : `Rendered with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;

  const ul = document.createElement('ul');
  for (const item of items.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }

  box.append(heading, ul);

  if (errors.length === 0) {
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.hidden = true; }, 9000);
  }
}

/** Wire the file picker and whole-window drag-and-drop to one handler. */
export function wireFileInput(onFile) {
  const input = $('file-input');
  $('btn-open').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.[0]) onFile(input.files[0]);
    input.value = '';
  });

  const hint = $('drop-hint');
  let depth = 0;

  // Only a drag actually carrying files should raise the overlay — text and
  // element drags would otherwise blank the scene behind a prompt for nothing.
  const carriesFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth++;
    hint.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (carriesFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) hint.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    hint.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

export const controls = {
  theme: $('btn-theme'),
  play: $('btn-play'),
  restart: $('btn-restart'),
  stop: $('btn-stop'),
  speed: $('speed'),
  speedOut: $('speed-out'),
  follow: $('follow'),
  resetView: $('btn-reset-view'),
};
