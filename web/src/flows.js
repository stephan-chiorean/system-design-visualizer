/**
 * Flow playback — the reason this app exists.
 *
 * A static 3D diagram is worse than a static 2D one: you have added a camera to
 * manage and gained nothing. What 3D buys you is *motion through structure*, so
 * a flow is a first-class object here rather than an animation garnish.
 *
 * Playing a flow does four things at once:
 *   1. particles travel the declared path, along the same curves the edges draw
 *   2. the current hop lights up, and everything off-path dims
 *   3. the camera can follow the request down through the stack
 *   4. the UI reads out which hop is active and why it exists
 */

import * as THREE from 'three';
import { routeCurve } from './scene/edges.js';
import { setNodeGlow, setNodeDim } from './scene/nodes.js';
import { setEdgeGlow } from './scene/edges.js';

const PARTICLES = 6;
const PARTICLE_SPACING = 0.055;  // in normalized path units
const BASE_DURATION = 1.45;      // seconds per hop at 1× speed
const HOP_HOLD = 0.35;           // fraction of a hop spent lit after arrival

export class FlowPlayer {
  constructor({ design, layout, nodes, edges, root, onHop }) {
    this.design = design;
    this.layout = layout;
    this.nodes = nodes;
    this.edges = edges;
    this.onHop = onHop ?? (() => {});

    this.group = new THREE.Group();
    root.add(this.group);

    this.flow = null;
    this.segments = [];
    this.totalLength = 0;
    this.progress = 0;
    this.speed = 1;
    this.playing = false;
    this.lastHop = -1;
    this.lead = new THREE.Vector3();

    const geometry = new THREE.SphereGeometry(0.62, 16, 12);
    this.particles = Array.from({ length: PARTICLES }, (_, i) => {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#9bf0ff'),
        transparent: true,
        opacity: 1 - i / PARTICLES,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    });
  }

  /** Build the composite path for a flow and start it. */
  play(flow) {
    this.flow = flow;
    this.segments = [];
    this.lastHop = -1;

    for (let i = 0; i < flow.path.length - 1; i++) {
      const fromId = flow.path[i];
      const toId = flow.path[i + 1];
      const edge = this.design.edgeBetween(fromId, toId);
      const declared = edge ? this.edges.get(edge.id) : null;

      // Reuse the drawn curve when one exists, reversing it if the flow runs
      // against the edge's declared direction. A hop with no edge still plays,
      // as a straight line — the validator has already warned about it.
      let curve;
      if (declared) {
        curve = edge.from === fromId ? declared.curve : reverseCurve(declared.curve);
      } else {
        curve = routeCurve(this.layout.positions.get(fromId), this.layout.positions.get(toId));
      }

      const length = curve.getLength();
      this.segments.push({ curve, length, fromId, toId, edgeId: edge?.id ?? null, hop: i });
      this.totalLength += length;
    }

    this.totalLength = this.segments.reduce((sum, s) => sum + s.length, 0) || 1;
    this.progress = 0;
    this.playing = true;
    this.applyFocus();
    this.announceOrigin();
    for (const p of this.particles) p.visible = true;
  }

  /**
   * `steps` runs parallel to `path` — one entry per node, describing what
   * happens there. That means the origin has a step of its own, and it is
   * announced before the first particle has moved.
   */
  announceOrigin() {
    const originId = this.flow.path[0];
    this.onHop({
      index: 0,
      total: this.flow.path.length,
      node: this.design.nodeById.get(originId),
      edge: null,
      step: this.flow.steps[0] ?? '',
    });
  }

  stop() {
    this.flow = null;
    this.segments = [];
    this.playing = false;
    this.lastHop = -1;
    for (const p of this.particles) p.visible = false;
    this.clearFocus();
    this.onHop(null);
  }

  restart() {
    this.progress = 0;
    this.lastHop = -1;
    this.playing = true;
  }

  setPlaying(on) {
    this.playing = on;
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  get active() {
    return this.flow !== null;
  }

  update(dt) {
    if (!this.flow || this.segments.length === 0) return;

    if (this.playing) {
      const duration = this.segments.length * BASE_DURATION / this.speed;
      this.progress += dt / duration;
      if (this.progress >= 1) {
        // Loop: a flow is a cycle to study, not a one-shot animation.
        this.progress -= 1;
        this.lastHop = -1;
        this.announceOrigin();
      }
    }

    for (let i = 0; i < this.particles.length; i++) {
      const t = this.progress - i * PARTICLE_SPACING;
      const particle = this.particles[i];
      if (t < 0 || t > 1) {
        particle.visible = false;
        continue;
      }
      particle.visible = true;
      const point = this.pointAt(t);
      particle.position.copy(point.position);
      if (i === 0) {
        this.lead.copy(point.position);
        this.setHop(point.segment);
      }
    }
  }

  /** Resolve a normalized progress value to a world point and its segment. */
  pointAt(t) {
    let travelled = t * this.totalLength;
    for (const segment of this.segments) {
      if (travelled <= segment.length || segment === this.segments.at(-1)) {
        const local = THREE.MathUtils.clamp(travelled / segment.length, 0, 1);
        return { position: segment.curve.getPoint(local), segment, local };
      }
      travelled -= segment.length;
    }
    const last = this.segments.at(-1);
    return { position: last.curve.getPoint(1), segment: last, local: 1 };
  }

  setHop(segment) {
    if (segment.hop === this.lastHop) return;
    this.lastHop = segment.hop;
    this.applyFocus();
    // Segment `h` arrives at path[h + 1], and steps are parallel to path.
    const arrivalIndex = segment.hop + 1;
    this.onHop({
      index: arrivalIndex,
      total: this.flow.path.length,
      node: this.design.nodeById.get(segment.toId),
      edge: segment.edgeId ? this.design.edges.find((e) => e.id === segment.edgeId) : null,
      step: this.flow.steps[arrivalIndex] ?? '',
    });
  }

  /** Dim everything that is not on the current flow; light the current hop. */
  applyFocus() {
    const onPath = new Set(this.flow?.path ?? []);
    const segment = this.segments[Math.max(this.lastHop, 0)];
    const litNodes = new Set(segment ? [segment.fromId, segment.toId] : []);

    for (const [id, entry] of this.nodes) {
      const participates = onPath.has(id);
      setNodeDim(entry, participates ? 0 : 0.78);
      setNodeGlow(entry, litNodes.has(id) ? 1 : participates ? 0.18 : 0);
    }

    for (const [id, entry] of this.edges) {
      const onFlow = this.segments.some((s) => s.edgeId === id);
      const isCurrent = segment?.edgeId === id;
      entry.material.opacity = isCurrent ? 0.98 : onFlow ? 0.6 : 0.12;
      setEdgeGlow(entry, isCurrent ? 1 : 0);
      if (entry.label) entry.label.element.style.opacity = onFlow ? '1' : '0.25';
    }
  }

  clearFocus() {
    for (const entry of this.nodes.values()) {
      setNodeDim(entry, 0);
      setNodeGlow(entry, 0);
    }
    for (const entry of this.edges.values()) {
      entry.material.opacity = entry.baseOpacity;
      setEdgeGlow(entry, 0);
      if (entry.label) entry.label.element.style.opacity = '1';
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

function reverseCurve(curve) {
  const points = [];
  for (let i = 12; i >= 0; i--) points.push(curve.getPoint(i / 12));
  return new THREE.CatmullRomCurve3(points);
}

export { HOP_HOLD };
