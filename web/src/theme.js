/**
 * Light and dark.
 *
 * The chrome themes itself from CSS custom properties, but the scene cannot:
 * three.js needs real colours and light intensities, and a palette tuned for a
 * near-black background is washed out on a near-white one. So this module owns
 * both halves — the `data-theme` attribute the stylesheet keys off, and the
 * scene constants the renderer reads — and is the single place either changes.
 *
 * The stored choice is deliberately tri-state: "system" is a real answer, not
 * the absence of one, and a user who never touches the switch should follow
 * their OS when it flips at dusk.
 */

import * as THREE from 'three';

const STORAGE_KEY = 'sdv.theme';
const ORDER = ['system', 'light', 'dark'];

export const SCENE = {
  dark: {
    background: 0x080a0f,
    fog: { color: 0x080a0f, near: 120, far: 340 },
    lights: {
      hemiSky: 0x9fc4ff,
      hemiGround: 0x0a0d14,
      hemiIntensity: 1.15,
      key: 0xffffff,
      keyIntensity: 1.5,
      rim: 0x4dd8ff,
      rimIntensity: 0.5,
      ambient: 0x404a5c,
      ambientIntensity: 0.6,
    },
    // What a dimmed node lerps toward: the background, so it recedes rather
    // than turning grey.
    dim: '#2a3140',
    planeSurfaceOpacity: 0.045,
    planeOutlineOpacity: 0.3,
    edgeOpacity: 0.72,
    // Node and edge colours are authored for this theme, so no adjustment.
    solidShift: { lightness: 1, saturation: 1 },
    edgeShift: { lightness: 1, saturation: 1 },
  },
  light: {
    background: 0xeef1f6,
    fog: { color: 0xeef1f6, near: 150, far: 420 },
    lights: {
      hemiSky: 0xffffff,
      hemiGround: 0xc3cad8,
      hemiIntensity: 1.9,
      key: 0xffffff,
      keyIntensity: 1.35,
      rim: 0x7fb4ff,
      rimIntensity: 0.28,
      ambient: 0xffffff,
      ambientIntensity: 0.85,
    },
    dim: '#c9cfdb',
    // The planes carry more of the structure on white, where a faint tint on a
    // dark ground would simply disappear.
    planeSurfaceOpacity: 0.1,
    planeOutlineOpacity: 0.45,
    edgeOpacity: 0.82,
    // The kind palette is pastel — pleasant on near-black, invisible on
    // near-white. Darken and saturate rather than keep a second palette, so
    // adding a kind never means picking two colours.
    solidShift: { lightness: 0.66, saturation: 1.18 },
    edgeShift: { lightness: 0.72, saturation: 1.1 },
  },
};

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const listeners = new Set();

let choice = read();

function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return ORDER.includes(stored) ? stored : 'system';
  } catch {
    // Private windows and blocked site data both throw here. Following the OS
    // is a perfectly good answer, so this is not worth reporting.
    return 'system';
  }
}

function write(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* the choice still applies for this session */
  }
}

/** The choice the user made: 'system', 'light' or 'dark'. */
export function themeChoice() {
  return choice;
}

/** What that resolves to right now: 'light' or 'dark'. */
export function activeTheme() {
  if (choice !== 'system') return choice;
  return media?.matches ? 'light' : 'dark';
}

export function sceneTheme() {
  return SCENE[activeTheme()];
}

export function setTheme(value) {
  choice = ORDER.includes(value) ? value : 'system';
  write(choice);
  apply();
}

/** Cycle system → light → dark → system, which is what the switch does. */
export function cycleTheme() {
  setTheme(ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]);
  return choice;
}

function apply() {
  const active = activeTheme();
  const root = document.documentElement;
  root.dataset.theme = active;
  root.dataset.themeChoice = choice;
  for (const listener of listeners) listener(active);
}

/** Called on every change, with the resolved theme. */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme() {
  // Only matters while the choice is "system", but subscribing once is simpler
  // than adding and removing the listener as the choice changes.
  media?.addEventListener?.('change', () => {
    if (choice === 'system') apply();
  });
  apply();
}

/**
 * Re-tint an authored colour for the active theme.
 *
 * Lightness is scaled rather than set, so the palette keeps its own internal
 * contrast — a pale client and a deep database stay that far apart.
 */
export function tint(color, shift) {
  const hsl = {};
  color.getHSL(hsl);
  return color.setHSL(
    hsl.h,
    Math.min(1, hsl.s * shift.saturation),
    THREE.MathUtils.clamp(hsl.l * shift.lightness, 0, 1)
  );
}
