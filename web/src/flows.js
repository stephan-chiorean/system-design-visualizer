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
 *
 * A path's last step may be a parallel group — several nodes reached at once.
 * The main trail follows the first of them, and every other branch gets its own
 * short-lived particle trail that shares the fork's slice of the timeline, so a
 * fan-out reads as simultaneous rather than as a sequence.
 */

import * as THREE from 'three';
import { routeCurve } from './scene/edges.js';
import { setNodeGlow, setNodeDim } from './scene/nodes.js';
import { setEdgeGlow } from './scene/edges.js';

const PARTICLES = 6;
const PARTICLE_SPACING = 0.055;  // in normalized path units
const BASE_DURATION = 1.45;      // seconds per hop at 1× speed
const HOP_HOLD = 0.35;           // fraction of a hop spent lit after arrival
const DEFAULT_COLOR = '#9bf0ff';

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
    this.branches = [];   // extra fan-out trails, rebuilt per flow
    this.totalLength = 0;
    this.progress = 0;
    this.speed = 1;
    this.playing = false;
    this.lastHop = -1;
    this.lead = new THREE.Vector3();

    this.geometry = new THREE.SphereGeometry(0.62, 16, 12);
    this.particles = Array.from({ length: PARTICLES }, (_, i) => this.makeParticle(i));
  }

  /** One trail bead. Opacity falls off down the trail so it reads as motion. */
  makeParticle(i) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(DEFAULT_COLOR),
      transparent: true,
      opacity: 1 - i / PARTICLES,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Build the composite path for a flow and start it. */
  play(flow) {
    this.clearBranchParticles();
    this.flow = flow;
    this.segments = [];
    this.branches = [];
    this.lastHop = -1;

    // The main trail walks one representative path: the declared steps, with a
    // trailing parallel group collapsed to its first member.
    const group = Array.isArray(flow.path.at(-1)) ? flow.path.at(-1) : null;
    const spine = group ? [...flow.path.slice(0, -1), group[0]] : [...flow.path];

    for (let i = 0; i < spine.length - 1; i++) {
      this.segments.push(this.buildSegment(spine[i], spine[i + 1], i));
    }

    // A return leg is the same segments walked backwards. It only makes sense
    // for a single-threaded path; the validator has already ruled out the mix.
    if (flow.returns && !group) {
      const outbound = [...this.segments];
      for (let i = outbound.length - 1; i >= 0; i--) {
        const segment = outbound[i];
        this.segments.push({
          curve: reverseCurve(segment.curve),
          length: segment.length,
          fromId: segment.toId,
          toId: segment.fromId,
          edgeId: segment.edgeId,
          hop: segment.hop,
          returning: true,
        });
      }
    }

    this.totalLength = this.segments.reduce((sum, s) => sum + s.length, 0) || 1;

    // Fan-out: the remaining branch targets leave the fork at the same moment
    // the main trail does, so they share that segment's window of the timeline.
    if (group && group.length > 1) {
      const fork = this.segments.at(-1);
      const before = this.segments
        .slice(0, -1)
        .reduce((sum, s) => sum + s.length, 0);
      const startFrac = before / this.totalLength;

      fork.branchTargets = group.slice(1);
      fork.branchEdgeIds = [];

      for (const targetId of group.slice(1)) {
        const segment = this.buildSegment(fork.fromId, targetId, fork.hop);
        fork.branchEdgeIds.push(segment.edgeId);
        this.branches.push({
          curve: segment.curve,
          startFrac,
          endFrac: 1,
          particles: Array.from({ length: PARTICLES }, (_, i) => this.makeParticle(i)),
        });
      }
    }

    this.applyColor(flow.color);
    this.progress = 0;
    this.playing = true;
    this.applyFocus();
    this.announceOrigin();
    for (const p of this.particles) p.visible = true;
  }

  /**
   * One hop of a path, drawn along the edge's own curve where one exists.
   *
   * Reusing the drawn curve — reversed when the flow runs against the edge's
   * declared direction — is why a played flow follows exactly the line you can
   * see. A hop with no edge still plays, as a straight line; the validator has
   * already warned about it.
   */
  buildSegment(fromId, toId, hop) {
    const edge = this.design.edgeBetween(fromId, toId);
    const declared = edge ? this.edges.get(edge.id) : null;

    let curve;
    if (declared) {
      curve = edge.from === fromId ? declared.curve : reverseCurve(declared.curve);
    } else {
      curve = routeCurve(this.layout.positions.get(fromId), this.layout.positions.get(toId));
    }

    return { curve, length: curve.getLength(), fromId, toId, edgeId: edge?.id ?? null, hop };
  }

  /** A flow may declare its own particle colour; otherwise use the house one. */
  applyColor(color) {
    const value = color || DEFAULT_COLOR;
    for (const particle of this.allParticles()) {
      try {
        particle.material.color.set(value);
      } catch {
        particle.material.color.set(DEFAULT_COLOR);
      }
    }
  }

  *allParticles() {
    yield* this.particles;
    for (const branch of this.branches) yield* branch.particles;
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
    this.clearBranchParticles();
    this.clearFocus();
    this.onHop(null);
  }

  /** Branch trails are created per flow, so they have to be torn down per flow. */
  clearBranchParticles() {
    for (const branch of this.branches) {
      for (const particle of branch.particles) {
        particle.removeFromParent();
        particle.material.dispose();
      }
    }
    this.branches = [];
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
      // The flow's own speed multiplies the UI slider: the slider is "how fast
      // am I watching", the flow's speed is "how fast this path actually is".
      const rate = this.speed * (this.flow.speed ?? 1);
      const duration = this.segments.length * BASE_DURATION / rate;
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

    for (const branch of this.branches) {
      const span = Math.max(branch.endFrac - branch.startFrac, 1e-6);
      for (let i = 0; i < branch.particles.length; i++) {
        const t = this.progress - i * PARTICLE_SPACING;
        const particle = branch.particles[i];
        if (t < branch.startFrac || t > branch.endFrac) {
          particle.visible = false;
          continue;
        }
        particle.visible = true;
        particle.position.copy(branch.curve.getPoint((t - branch.startFrac) / span));
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
    const key = this.segments.indexOf(segment);
    if (key === this.lastHop) return;
    this.lastHop = key;
    this.applyFocus();
    // Segment `h` arrives at path[h + 1], and steps are parallel to path. On the
    // return leg the hop index walks back down the same list.
    const arrivalIndex = segment.returning ? segment.hop : segment.hop + 1;
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
    const onPath = new Set(this.flow?.flatPath ?? this.flow?.path?.flat() ?? []);
    const segment = this.segments[Math.max(this.lastHop, 0)];

    // At a fan-out every branch target is "the current hop" at once — lighting
    // only the first one would say the opposite of what the flow means.
    const litNodes = new Set(
      segment ? [segment.fromId, segment.toId, ...(segment.branchTargets ?? [])] : []
    );
    const litEdges = new Set(
      segment ? [segment.edgeId, ...(segment.branchEdgeIds ?? [])].filter(Boolean) : []
    );
    const flowEdges = new Set(
      this.segments
        .flatMap((s) => [s.edgeId, ...(s.branchEdgeIds ?? [])])
        .filter(Boolean)
    );

    for (const [id, entry] of this.nodes) {
      const participates = onPath.has(id);
      setNodeDim(entry, participates ? 0 : 0.78);
      setNodeGlow(entry, litNodes.has(id) ? 1 : participates ? 0.18 : 0);
    }

    for (const [id, entry] of this.edges) {
      const onFlow = flowEdges.has(id);
      const isCurrent = litEdges.has(id);
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
    this.clearBranchParticles();
    for (const particle of this.particles) particle.material.dispose();
    this.geometry.dispose();
    this.group.removeFromParent();
  }
}

function reverseCurve(curve) {
  const points = [];
  for (let i = 12; i >= 0; i--) points.push(curve.getPoint(i / 12));
  return new THREE.CatmullRomCurve3(points);
}

export { HOP_HOLD };
