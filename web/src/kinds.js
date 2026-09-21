/**
 * The node-kind registry.
 *
 * This is the ONLY place the app carries opinions about what a system design
 * contains, and even here the opinion is cosmetic: a kind picks a silhouette and
 * a colour, nothing more. Semantics live in the design JSON.
 *
 * `shape` is resolved to real geometry in scene/nodes.js so this file stays
 * free of three.js imports and can be read as documentation.
 */

export const KINDS = {
  client:   { shape: 'sphere',   color: '#9aa4b8', label: 'Client' },
  cdn:      { shape: 'icosa',    color: '#6fd3b5', label: 'CDN' },
  lb:       { shape: 'cone',     color: '#7ea8ff', label: 'Load balancer' },
  gateway:  { shape: 'prism',    color: '#7ea8ff', label: 'Gateway' },
  service:  { shape: 'box',      color: '#4dd8ff', label: 'Service' },
  worker:   { shape: 'box',      color: '#4db1ff', label: 'Worker' },
  cache:    { shape: 'octa',     color: '#ffb457', label: 'Cache' },
  db:       { shape: 'cylinder', color: '#c79bff', label: 'Database' },
  blob:     { shape: 'slab',     color: '#a98bd8', label: 'Object storage' },
  queue:    { shape: 'capsule',  color: '#ff8fb3', label: 'Queue / stream' },
  search:   { shape: 'octa',     color: '#8fe08f', label: 'Search index' },
  analytics:{ shape: 'slab',     color: '#8fe08f', label: 'Analytics' },
  external: { shape: 'sphere',   color: '#6d7688', label: 'External system' },
};

export const DEFAULT_KIND = 'service';

export function kindOf(name) {
  return KINDS[name] ?? KINDS[DEFAULT_KIND];
}

export function isKnownKind(name) {
  return Object.hasOwn(KINDS, name);
}

/** Edge styling by transport semantics. */
export const EDGE_KINDS = {
  sync:   { color: '#5f7186', dashed: false, label: 'synchronous' },
  async:  { color: '#ff8fb3', dashed: true,  label: 'asynchronous' },
  stream: { color: '#6fd3b5', dashed: true,  label: 'stream' },
  batch:  { color: '#a98bd8', dashed: true,  label: 'batch' },
};

export const DEFAULT_EDGE_KIND = 'sync';

export function edgeKindOf(name) {
  return EDGE_KINDS[name] ?? EDGE_KINDS[DEFAULT_EDGE_KIND];
}
