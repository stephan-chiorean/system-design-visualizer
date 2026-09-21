/**
 * The stage: lighting, and the layer planes that make the stack legible.
 *
 * The planes are doing real work. Without them a layered layout just looks like
 * floating boxes at arbitrary heights; with them, "edge tier", "application
 * tier", "storage tier" are places you can point at.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Cool at the top (traffic arriving) to warm at the bottom (state at rest).
const LAYER_HUES = [196, 205, 218, 262, 288, 320, 22];

export function layerColor(index) {
  return `hsl(${LAYER_HUES[index % LAYER_HUES.length]}, 62%, 62%)`;
}

export function buildStage(design, layout, root) {
  const planes = new Map();

  design.layers.forEach((layer, i) => {
    const y = layout.layerY.get(layer.id);
    const group = new THREE.Group();
    group.position.y = y;

    const color = new THREE.Color(layerColor(i));
    const geometry = new THREE.PlaneGeometry(layout.planeWidth, layout.planeDepth);

    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = -4.2;
    group.add(surface);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.y = -4.2;
    group.add(outline);

    if (layer.label) {
      const el = document.createElement('div');
      el.className = 'layer-label';
      el.textContent = layer.label;
      const label = new CSS2DObject(el);
      label.position.set(-layout.planeWidth / 2 - 1.5, -3.4, -layout.planeDepth / 2);
      group.add(label);
    }

    root.add(group);
    planes.set(layer.id, { layer, group, color, surface, outline });
  });

  return planes;
}

export function addLighting(scene) {
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x0a0d14, 1.15));

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(28, 44, 26);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4dd8ff, 0.5);
  rim.position.set(-32, 12, -28);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x404a5c, 0.6));
}
