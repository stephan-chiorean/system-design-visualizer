/**
 * Edge geometry.
 *
 * Every edge is a curve in space, and that curve is reused for two jobs: drawing
 * the connection, and carrying flow particles. Keeping one curve per edge is why
 * a played flow follows exactly the line you can see rather than a parallel path
 * of its own.
 *
 * Async / stream / batch edges are drawn dashed. The dashes are real geometry
 * (merged sub-tubes) rather than a dashed line material, so they keep their
 * thickness at any zoom — line widths above 1px are not portable in WebGL.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { edgeKindOf } from '../kinds.js';
import { sceneTheme, tint } from '../theme.js';

const NODE_RADIUS = 3.6;  // where a curve should stop short of a node's centre
const DASHES = 16;

export function buildEdges(design, layout, root) {
  const entries = new Map();
  const theme = sceneTheme();

  for (const edge of design.edges) {
    const a = layout.positions.get(edge.from);
    const b = layout.positions.get(edge.to);
    const curve = routeCurve(a, b);
    const spec = edgeKindOf(edge.kind);

    const radius = 0.11 + edge.volume * 0.26;
    const geometry = spec.dashed
      ? dashedTube(curve, radius)
      : new THREE.TubeGeometry(curve, 48, radius, 8, false);

    const color = tint(new THREE.Color(spec.color), theme.edgeShift);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.1,
      transparent: true,
      opacity: theme.edgeOpacity,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.pick = { type: 'edge', id: edge.id };
    root.add(mesh);

    // Direction is part of the meaning of an edge, so it gets an arrowhead
    // rather than relying on the reader to remember from/to ordering.
    const head = arrowHead(curve, color);
    root.add(head);
    let tailHead = null;
    if (edge.bidirectional) {
      tailHead = arrowHead(reverse(curve), color);
      root.add(tailHead);
    }

    let label = null;
    if (edge.label) {
      const el = document.createElement('div');
      el.className = 'edge-label';
      el.textContent = edge.label;
      label = new CSS2DObject(el);
      label.position.copy(curve.getPoint(0.5));
      root.add(label);
    }

    entries.set(edge.id, { edge, curve, mesh, material, head, tailHead, label, baseOpacity: theme.edgeOpacity });
  }

  return entries;
}

/**
 * Route a curve between two node positions.
 *
 * Cross-layer edges bow outward slightly so parallel connections stay
 * distinguishable; same-layer edges arch up and out, because a straight
 * horizontal line would pass through whatever sits between the two nodes.
 */
export function routeCurve(a, b) {
  const start = new THREE.Vector3(a.x, a.y, a.z);
  const end = new THREE.Vector3(b.x, b.y, b.z);
  const sameLayer = Math.abs(a.y - b.y) < 0.001;

  const dir = end.clone().sub(start);
  const length = dir.length() || 1;
  const unit = dir.clone().divideScalar(length);

  // Stop short of each node so the tube meets the surface, not the centre.
  const from = start.clone().addScaledVector(unit, Math.min(NODE_RADIUS, length * 0.35));
  const to = end.clone().addScaledVector(unit, -Math.min(NODE_RADIUS, length * 0.35));

  const mid = from.clone().lerp(to, 0.5);
  if (sameLayer) {
    const lateral = new THREE.Vector3(-unit.z, 0, unit.x).multiplyScalar(length * 0.12);
    mid.add(lateral).add(new THREE.Vector3(0, length * 0.16, 0));
  } else {
    const outward = new THREE.Vector3(mid.x, 0, mid.z);
    if (outward.lengthSq() < 0.01) outward.set(1, 0, 0);
    mid.addScaledVector(outward.normalize(), length * 0.1);
  }

  return new THREE.CatmullRomCurve3([from, mid, to], false, 'catmullrom', 0.5);
}

function dashedTube(curve, radius) {
  const parts = [];
  for (let i = 0; i < DASHES; i++) {
    const t0 = i / DASHES;
    const t1 = t0 + (1 / DASHES) * 0.55;
    const points = [];
    for (let s = 0; s <= 4; s++) points.push(curve.getPoint(t0 + (t1 - t0) * (s / 4)));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 4, radius, 6, false));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function arrowHead(curve, color) {
  const tip = curve.getPoint(1);
  const tangent = curve.getTangent(1).normalize();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.62, 1.7, 14),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5, transparent: true, opacity: 0.85 })
  );
  cone.position.copy(tip);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  return cone;
}

function reverse(curve) {
  const points = [];
  for (let i = 8; i >= 0; i--) points.push(curve.getPoint(i / 8));
  return new THREE.CatmullRomCurve3(points);
}

export function setEdgeGlow(entry, amount) {
  entry.material.opacity = entry.baseOpacity + amount * 0.28;
  entry.material.emissive = entry.material.emissive ?? new THREE.Color();
  entry.material.emissive.copy(entry.material.color).multiplyScalar(amount * 0.9);
  const heads = [entry.head, entry.tailHead].filter(Boolean);
  for (const head of heads) head.material.opacity = 0.85 + amount * 0.15;
}
