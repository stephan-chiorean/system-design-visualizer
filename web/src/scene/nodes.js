/**
 * Node meshes.
 *
 * A node is a group holding one or more "replica" solids plus a CSS2D label.
 * Replicas are drawn as a shallow fanned stack rather than a number on a card:
 * "three of these" is a fact about the architecture and should be visible from
 * across the room.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { kindOf } from '../kinds.js';
import { sceneTheme, tint } from '../theme.js';

const S = 2.6; // base half-extent for node solids

const GEOMETRY = {
  box:      () => new THREE.BoxGeometry(S * 1.8, S * 1.25, S * 1.8),
  slab:     () => new THREE.BoxGeometry(S * 2.1, S * 0.7, S * 2.1),
  sphere:   () => new THREE.SphereGeometry(S * 0.95, 32, 20),
  cylinder: () => new THREE.CylinderGeometry(S * 0.95, S * 0.95, S * 1.5, 28),
  capsule:  () => new THREE.CapsuleGeometry(S * 0.6, S * 1.5, 8, 20),
  cone:     () => new THREE.ConeGeometry(S * 1.05, S * 1.7, 26),
  octa:     () => new THREE.OctahedronGeometry(S * 1.15),
  icosa:    () => new THREE.IcosahedronGeometry(S * 1.05, 0),
  prism:    () => new THREE.CylinderGeometry(S * 1.0, S * 1.0, S * 1.3, 6),
};

// Geometries are shared across every node of the same shape; only materials are
// per-node, because highlighting mutates emissive.
const geometryCache = new Map();
function geometryFor(shape) {
  if (!geometryCache.has(shape)) {
    geometryCache.set(shape, (GEOMETRY[shape] ?? GEOMETRY.box)());
  }
  return geometryCache.get(shape);
}

export function buildNodes(design, layout, root) {
  const entries = new Map();
  const theme = sceneTheme();

  for (const node of design.nodes) {
    const spec = kindOf(node.kind);
    const pos = layout.positions.get(node.id);
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    const base = tint(new THREE.Color(spec.color), theme.solidShift);
    const material = new THREE.MeshStandardMaterial({
      color: base,
      roughness: 0.42,
      metalness: 0.18,
      emissive: base.clone().multiplyScalar(0.12),
    });

    const geometry = geometryFor(spec.shape);
    const solids = [];
    const count = node.replicas;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      // Fan replicas back-to-front so the front-most solid stays the hit target.
      const offset = (i - (count - 1) / 2) * 1.15;
      mesh.position.set(offset * 0.8, 0, offset * 1.05);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: 'node', id: node.id };
      group.add(mesh);
      solids.push(mesh);
    }

    // A soft ring under each node grounds it on its layer plane.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(S * 1.5, S * 1.75, 40),
      new THREE.MeshBasicMaterial({
        color: base,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -S * 1.1;
    group.add(ring);

    const el = document.createElement('div');
    el.className = 'node-label';
    el.textContent = node.label;
    if (node.tech || count > 1) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = [node.tech, count > 1 ? `×${count}` : ''].filter(Boolean).join(' · ');
      el.append(sub);
    }
    const label = new CSS2DObject(el);
    label.position.set(0, S * 1.85, 0);
    group.add(label);

    root.add(group);
    entries.set(node.id, { node, group, solids, material, ring, labelEl: el, baseColor: base, position: group.position.clone() });
  }

  return entries;
}

/**
 * Dim a node toward the background instead of fading it out. Transparency would
 * fight the depth sort on fanned replica stacks; a colour lerp never does.
 *
 * The target is read per call rather than cached, because it is the background
 * it lerps toward and that changes with the theme.
 */
export function setNodeDim(entry, amount) {
  entry.material.color.copy(entry.baseColor).lerp(new THREE.Color(sceneTheme().dim), amount);
  entry.ring.material.opacity = 0.22 * (1 - amount);
  entry.labelEl.style.opacity = String(1 - amount * 0.72);
}

/** Highlight state is a scalar so flow playback and hover can share one channel. */
export function setNodeGlow(entry, amount) {
  entry.material.emissive.copy(entry.baseColor).multiplyScalar(0.12 + amount * 1.05);
  entry.ring.material.opacity = 0.22 + amount * 0.55;
  entry.labelEl.classList.toggle('lit', amount > 0.35);
  const scale = 1 + amount * 0.1;
  entry.group.scale.setScalar(scale);
}
