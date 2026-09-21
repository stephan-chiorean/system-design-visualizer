/**
 * Layered layout.
 *
 * The central bet of this app: layout is DECLARED, not simulated. Layers are
 * horizontal planes stacked in Y, in the order the design declares them, so a
 * request physically descends through the stack as it is served. A force
 * simulation would be less work to author and strictly worse to learn from —
 * the same design would land differently on every load.
 *
 * Within a layer we still have a choice to make, and we make it deterministically:
 * a two-direction barycenter sweep (the ordering half of Sugiyama) puts connected
 * nodes near each other so edges cross as little as possible, then nodes drop
 * into a centred grid. Same JSON in, same picture out, every time.
 */

export const LAYER_GAP = 17;   // vertical distance between layer planes
export const COL_GAP = 15;     // horizontal spacing within a layer
export const ROW_GAP = 13;     // depth spacing within a layer

export function computeLayout(design) {
  const { layers, nodes, edges } = design;

  const byLayer = new Map(layers.map((l) => [l.id, []]));
  for (const node of nodes) byLayer.get(node.layer)?.push(node);

  // Adjacency, used for barycentre ordering.
  const neighbors = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    neighbors.get(edge.from).push(edge.to);
    neighbors.get(edge.to).push(edge.from);
  }

  // Order within each layer, starting from declaration order.
  const orders = new Map(layers.map((l) => [l.id, byLayer.get(l.id).map((n) => n.id)]));
  const rankOf = () => {
    const rank = new Map();
    for (const ids of orders.values()) ids.forEach((id, i) => rank.set(id, i));
    return rank;
  };

  // Four alternating sweeps is plenty for designs of this size and keeps the
  // result stable; more passes just oscillate between equivalent orderings.
  for (let pass = 0; pass < 4; pass++) {
    const downward = pass % 2 === 0;
    const sequence = downward ? layers : [...layers].reverse();
    const rank = rankOf();

    for (const layer of sequence) {
      const ids = orders.get(layer.id);
      if (ids.length < 2) continue;

      const score = new Map();
      ids.forEach((id, i) => {
        const adj = neighbors.get(id).filter((other) => rank.has(other) && nodeLayer(design, other) !== layer.id);
        if (adj.length === 0) {
          score.set(id, i); // no pull from elsewhere: hold position
          return;
        }
        const mean = adj.reduce((sum, other) => sum + rank.get(other), 0) / adj.length;
        score.set(id, mean);
      });

      // Stable sort on the barycentre, tie-broken by current position.
      const current = new Map(ids.map((id, i) => [id, i]));
      ids.sort((a, b) => (score.get(a) - score.get(b)) || (current.get(a) - current.get(b)));
    }
  }

  // Place each layer's ordered nodes into a centred grid.
  const positions = new Map();
  const layerY = new Map();
  const layerExtent = new Map();

  layers.forEach((layer, i) => {
    const y = (layers.length - 1 - i) * LAYER_GAP;
    layerY.set(layer.id, y);

    const ids = orders.get(layer.id);
    const n = ids.length;
    const cols = n <= 4 ? Math.max(n, 1) : Math.ceil(Math.sqrt(n));
    const rows = Math.max(1, Math.ceil(n / cols));

    ids.forEach((id, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // Centre the final row too, so a ragged grid doesn't look left-heavy.
      const inRow = Math.min(cols, n - row * cols);
      const x = (col - (inRow - 1) / 2) * COL_GAP;
      const z = (row - (rows - 1) / 2) * ROW_GAP;
      positions.set(id, { x, y, z });
    });

    layerExtent.set(layer.id, {
      width: Math.max(cols, 1) * COL_GAP,
      depth: Math.max(rows, 1) * ROW_GAP,
      count: n,
    });
  });

  // Uniform plane size across layers reads as one structure rather than a
  // stack of unrelated slabs.
  const planeWidth = Math.max(...[...layerExtent.values()].map((e) => e.width), COL_GAP) + COL_GAP * 0.9;
  const planeDepth = Math.max(...[...layerExtent.values()].map((e) => e.depth), ROW_GAP) + ROW_GAP * 0.9;

  const height = Math.max(layers.length - 1, 0) * LAYER_GAP;
  const radius = Math.max(planeWidth, planeDepth, height) * 0.75 + 12;

  return {
    positions,
    layerY,
    layerExtent,
    planeWidth,
    planeDepth,
    height,
    radius,
    center: { x: 0, y: height / 2, z: 0 },
  };
}

function nodeLayer(design, id) {
  return design.nodeById.get(id)?.layer;
}
