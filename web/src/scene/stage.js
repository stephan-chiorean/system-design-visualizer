/**
 * The stage: lighting, and the layer planes that make the stack legible.
 *
 * The planes are doing real work. Without them a layered layout just looks like
 * floating boxes at arbitrary heights; with them, "edge tier", "application
 * tier", "storage tier" are places you can point at.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { sceneTheme } from '../theme.js';

// Cool at the top (traffic arriving) to warm at the bottom (state at rest).
const LAYER_HUES = [196, 205, 218, 262, 288, 320, 22];

export function layerColor(index) {
  return `hsl(${LAYER_HUES[index % LAYER_HUES.length]}, 62%, 62%)`;
}

export function buildStage(design, layout, root) {
  const planes = new Map();
  const theme = sceneTheme();

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
        opacity: theme.planeSurfaceOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = -4.2;
    group.add(surface);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: theme.planeOutlineOpacity })
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

/**
 * Lighting lives on the scene, not the world group, so it survives a design
 * rebuild. `lights` is returned so a theme change can re-colour it in place
 * rather than tearing the scene down.
 */
export function addLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(28, 44, 26);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xffffff, 1);
  rim.position.set(-32, 12, -28);
  scene.add(rim);

  const ambient = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambient);

  const lights = { hemi, key, rim, ambient };
  applyLighting(lights);
  return lights;
}

export function applyLighting(lights) {
  const { lights: spec } = sceneTheme();
  lights.hemi.color.set(spec.hemiSky);
  lights.hemi.groundColor.set(spec.hemiGround);
  lights.hemi.intensity = spec.hemiIntensity;
  lights.key.color.set(spec.key);
  lights.key.intensity = spec.keyIntensity;
  lights.rim.color.set(spec.rim);
  lights.rim.intensity = spec.rimIntensity;
  lights.ambient.color.set(spec.ambient);
  lights.ambient.intensity = spec.ambientIntensity;
}
