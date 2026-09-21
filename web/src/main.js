/**
 * Entry point: renderer, camera, picking, and the load → build → render cycle.
 *
 * Loading a design tears the whole scene graph down and rebuilds it. That is not
 * a compromise — designs are small (tens of nodes) and a rebuild is measured in
 * milliseconds, so incremental diffing would buy nothing and cost a class of
 * stale-state bugs.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { parseDesign } from './schema.js';
import { computeLayout } from './layout.js';
import { buildNodes, setNodeGlow } from './scene/nodes.js';
import { buildEdges } from './scene/edges.js';
import { buildStage, addLighting } from './scene/stage.js';
import { FlowPlayer } from './flows.js';
import * as ui from './ui.js';
import {
  isDesktop,
  initSkillPanel,
  initNativeOpen,
  listUserDesigns,
  readDesignPath,
  designsDir,
} from './desktop.js';

const canvas = document.getElementById('canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x080a0f, 1);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x080a0f, 120, 340);
addLighting(scene);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.92;

/** Everything belonging to the current design hangs off this group. */
let world = new THREE.Group();
scene.add(world);

let current = null;   // { design, layout, nodes, edges, planes, player, home }
let hovered = null;
let pinned = null;    // a clicked subject survives the pointer leaving it

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerInScene = false;

// ---------------------------------------------------------------- loading

async function loadManifest() {
  try {
    const response = await fetch('designs/index.json');
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    return [];
  }
}

/**
 * Load a design by picker value. A bundled design is a name relative to
 * `designs/`; a library design is an absolute path, which only the desktop
 * shell can read. Both end up in `applyRaw`.
 */
async function loadDesignFile(file) {
  try {
    if (file.startsWith('/')) {
      applyRaw(JSON.parse(await readDesignPath(file)));
    } else {
      const response = await fetch(`designs/${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyRaw(await response.json());
    }
    ui.setPickerValue(file);
  } catch (error) {
    ui.showDiagnostics([`Could not load ${file}: ${error.message ?? error}`], []);
  }
}

function applyRaw(raw) {
  const { design, errors, warnings } = parseDesign(raw);
  ui.showDiagnostics(errors, warnings);
  if (!design) return;
  build(design);
}

// ---------------------------------------------------------------- building

function build(design) {
  teardown();

  const layout = computeLayout(design);
  world = new THREE.Group();
  scene.add(world);

  const planes = buildStage(design, layout, world);
  const edges = buildEdges(design, layout, world);
  const nodes = buildNodes(design, layout, world);

  const player = new FlowPlayer({
    design,
    layout,
    nodes,
    edges,
    root: world,
    onHop: (hop) => ui.renderHop(hop),
  });

  const home = frameCamera(layout);
  current = { design, layout, nodes, edges, planes, player, home };

  ui.renderDesignPanel(design);
  ui.renderFlowList(design, selectFlow);
  ui.markActiveFlow(null);
  ui.renderLayerList(design, toggleLayer);
  ui.renderInspector(null);
  pinned = null;
  hovered = null;
}

function teardown() {
  if (!current) return;
  current.player.dispose();
  scene.remove(world);
  world.traverse((object) => {
    if (object.isMesh || object.isLineSegments) {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    }
    // CSS2DObjects own real DOM; removing the group is not enough.
    if (object.isCSS2DObject) object.element.remove();
  });
  current = null;
}

/** Place the camera so the whole stack is in frame, from a three-quarter view. */
function frameCamera(layout) {
  // Fit against whichever of width or height is the binding constraint — on a
  // wide window the stack's height is what runs out of room first.
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = Math.max(
    (layout.height / 2 + 6) / Math.tan(vFov / 2),
    (Math.max(layout.planeWidth, layout.planeDepth) / 2 + 4) / Math.tan(hFov / 2)
  ) * 1.22;

  const position = new THREE.Vector3(distance * 0.55, layout.height * 0.5 + distance * 0.42, distance * 0.66);
  const target = new THREE.Vector3(layout.center.x, layout.center.y, layout.center.z);

  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();

  return { position: position.clone(), target: target.clone() };
}

// ---------------------------------------------------------------- interaction

function selectFlow(flow) {
  if (!current) return;
  const { player } = current;

  if (player.active && player.flow.id === flow.id) {
    player.stop();
    ui.markActiveFlow(null);
    ui.renderHop(null);
    return;
  }

  player.play(flow);
  ui.markActiveFlow(flow.id);
  ui.controls.play.textContent = 'Pause';
}

function toggleLayer(layerId, visible) {
  if (!current) return;
  const { design, nodes, edges, planes } = current;

  planes.get(layerId).group.visible = visible;

  const affected = new Set(design.nodes.filter((n) => n.layer === layerId).map((n) => n.id));
  for (const id of affected) {
    const entry = nodes.get(id);
    entry.group.visible = visible;
  }
  for (const entry of edges.values()) {
    const touches = affected.has(entry.edge.from) || affected.has(entry.edge.to);
    if (!touches) continue;
    const bothEndsVisible = nodes.get(entry.edge.from).group.visible && nodes.get(entry.edge.to).group.visible;
    entry.mesh.visible = bothEndsVisible;
    entry.head.visible = bothEndsVisible;
    if (entry.tailHead) entry.tailHead.visible = bothEndsVisible;
    if (entry.label) entry.label.visible = bothEndsVisible;
  }
}

function subjectFor(pick) {
  if (!current || !pick) return null;
  const { design } = current;
  if (pick.type === 'node') {
    return { type: 'node', id: pick.id, node: design.nodeById.get(pick.id) };
  }
  const edge = design.edges.find((e) => e.id === pick.id);
  if (!edge) return null;
  return {
    type: 'edge',
    id: pick.id,
    edge,
    fromLabel: design.nodeById.get(edge.from).label,
    toLabel: design.nodeById.get(edge.to).label,
  };
}

function updatePicking() {
  if (!current || !pointerInScene) return;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.children, true);
  const hit = hits.find((h) => h.object.userData.pick && h.object.visible);
  const pick = hit?.object.userData.pick ?? null;
  const id = pick ? `${pick.type}:${pick.id}` : null;

  if (id === hovered) return;

  // Hover glow is suppressed during playback; the flow owns the highlight channel.
  if (hovered && !current.player.active) restoreHighlight(hovered);
  hovered = id;
  if (hovered && !current.player.active) applyHighlight(hovered);

  canvas.style.cursor = pick ? 'pointer' : 'default';
  if (!pinned) ui.renderInspector(subjectFor(pick));
}

function applyHighlight(key) {
  const [type, id] = splitKey(key);
  if (type === 'node') setNodeGlow(current.nodes.get(id), 0.7);
  else {
    const entry = current.edges.get(id);
    if (entry) entry.material.opacity = 1;
  }
}

function restoreHighlight(key) {
  const [type, id] = splitKey(key);
  if (type === 'node') setNodeGlow(current.nodes.get(id), 0);
  else {
    const entry = current.edges.get(id);
    if (entry) entry.material.opacity = entry.baseOpacity;
  }
}

function splitKey(key) {
  const index = key.indexOf(':');
  return [key.slice(0, index), key.slice(index + 1)];
}

// ---------------------------------------------------------------- events

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  pointerInScene = true;
});

canvas.addEventListener('pointerleave', () => { pointerInScene = false; });

canvas.addEventListener('click', () => {
  if (!hovered) {
    pinned = null;
    ui.renderInspector(null);
    return;
  }
  const [type, id] = splitKey(hovered);
  pinned = subjectFor({ type, id });
  ui.renderInspector(pinned);
});

ui.controls.play.addEventListener('click', () => {
  if (!current?.player.active) return;
  const playing = !current.player.playing;
  current.player.setPlaying(playing);
  ui.controls.play.textContent = playing ? 'Pause' : 'Play';
});

ui.controls.restart.addEventListener('click', () => {
  current?.player.restart();
  ui.controls.play.textContent = 'Pause';
});

ui.controls.stop.addEventListener('click', () => {
  if (!current?.player.active) return;
  current.player.stop();
  ui.markActiveFlow(null);
  ui.renderHop(null);
});

ui.controls.speed.addEventListener('input', () => {
  const value = Number(ui.controls.speed.value);
  current?.player.setSpeed(value);
  ui.controls.speedOut.textContent = `${value}×`;
});

ui.controls.resetView.addEventListener('click', () => {
  if (!current) return;
  camera.position.copy(current.home.position);
  controls.target.copy(current.home.target);
  controls.update();
});

ui.wireFileInput(async (file) => {
  try {
    applyRaw(JSON.parse(await file.text()));
  } catch (error) {
    ui.showDiagnostics([`${file.name} is not valid JSON: ${error.message}`], []);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.target.matches('input, select, textarea')) return;
  if (event.code === 'Space' && current?.player.active) {
    event.preventDefault();
    ui.controls.play.click();
  }
  if (event.key === 'r' || event.key === 'R') ui.controls.resetView.click();
  if (event.key === 'Escape') {
    pinned = null;
    ui.renderInspector(null);
  }
  // 1-9 play the nth flow.
  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit > 0 && current) {
    const flow = current.design.flows[digit - 1];
    if (flow) selectFlow(flow);
  }
});

function resize() {
  // Size to the stage, not the window: the sidebar covers the right edge, and a
  // scene centred in the window would sit visibly off-centre to the viewer.
  const stage = document.getElementById('stage');
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
const followTarget = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1); // clamp so a backgrounded tab doesn't jump

  if (current) {
    current.player.update(dt);

    if (current.player.active && ui.controls.follow.checked) {
      followTarget.copy(current.player.lead);
      controls.target.lerp(followTarget, 1 - Math.exp(-2.6 * dt));
    }
  }

  updatePicking();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------------------------------------------------------------- boot

if (isDesktop()) {
  document.documentElement.dataset.desktop = '';
  initSkillPanel();
  initNativeOpen((text, path) => {
    try {
      applyRaw(JSON.parse(text));
    } catch (error) {
      ui.showDiagnostics([`${path} is not valid JSON: ${error.message}`], []);
    }
  });
}

resize();

const help = document.createElement('div');
help.className = 'help';
help.textContent = 'drag to orbit · scroll to zoom · 1–9 play a flow · space pause · R reset view';
document.body.append(help);

// The picker is the bundled examples plus the user's library. On the web the
// library is always empty, so this is the same single list it always was.
const bundled = await loadManifest();
const library = await listUserDesigns();
const manifest = [...library, ...bundled];

if (manifest.length) {
  ui.renderDesignPicker(manifest, loadDesignFile);
  await loadDesignFile(manifest[0].file);
} else {
  const where = (await designsDir()) ?? 'designs/';
  ui.showDiagnostics(
    [`No designs found. Save one to ${where}, or drop a design JSON onto this window.`],
    []
  );
}
