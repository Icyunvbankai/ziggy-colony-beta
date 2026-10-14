/**
 * BETA topography — real terrain elevation for the colony.
 *
 * Clean-room implementation written for the beta (no code taken from any
 * other project): a seeded value-noise height field, a displaced terrain mesh
 * with vertex colours, a water plane, and the height queries the rest of the
 * colony uses to stand bots, props, scatter and buildings on the ground.
 *
 * Shape of the land
 * ----------------
 * - Rolling hills from 4-octave fractal noise, plus a ridged component so the
 *   map has valleys as well as bumps — not a flat plane with pimples.
 * - The field falls away to open sea past the colony's edge, so the colony
 *   reads as an island with a shoreline, not a diorama on a disc.
 * - Valley floors bottom out just under the water level, so low ground holds
 *   shallow ponds a bot can wade (never a lake deep enough to swim in).
 * - Plots flatten the ground under themselves: each plot reports a deck height
 *   from the RAW field at its centre, and the height function blends the raw
 *   field toward (deck − 0.55) near that plot, so a slab sits ON its hill like
 *   a terrace instead of being swallowed by it or floating above it. The
 *   blend radius reaches past the plot edge, so paths slope up to a plot
 *   instead of stepping off a cliff.
 *
 * The height function is deterministic (fixed seed): the same (x, z) always
 * gives the same height, so the mesh, the walkers and the props all agree.
 */

import * as THREE from 'three'

// ── deterministic noise ──────────────────────────────────────────────────────

const SEED = 20261014

/** mulberry32 — small, fast, deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer-lattice hash → [0, 1). The same lattice point always gives the same value. */
function hash2(ix, iz) {
  // NOTE: keep every term < 2^53 so the sum stays exact in a double — a
  // constant near 1e18 made the sum round to a multiple of 2^32 and every
  // hash came out 0 (flat world, found by test).
  let h = (ix * 374761393 + iz * 668265263 + SEED * 974711) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

const smooth = (t) => t * t * (3 - 2 * t)

/** Value noise: bilinear interpolation of hashed lattice corners. */
function valueNoise(x, z) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  const u = smooth(fx)
  const v = smooth(fz)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal sum of value noise, normalised to roughly [-1, 1]. */
function fbm(x, z, octaves) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * (valueNoise(x * freq, z * freq) * 2 - 1)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

// ── the height field ─────────────────────────────────────────────────────────

export const BETA_WATER_LEVEL = -0.85
export const BETA_TERRAIN_EXTENT = 220
const MIN_H = -1.35
const MAX_H = 4.6
const SEA_IN = 120
const SEA_OUT = 195

/** Raw field WITHOUT plot flattening — what deck heights are measured from. */
export function betaRawHeight(x, z) {
  const hills = fbm(x * 0.028, z * 0.028, 4) * 3.0
  const ridged = (1 - Math.abs(fbm(x * 0.05 + 11.7, z * 0.05 - 4.2, 3))) * 1.2 - 0.6
  const micro = fbm(x * 0.16 + 7.3, z * 0.16 - 2.1, 2) * 0.35
  let h = hills + ridged * 0.6 + micro + 0.35
  // Fall away to sea past the colony edge.
  const d = Math.hypot(x, z)
  h = mix(h, -1.35, smoothstep(SEA_IN, SEA_OUT, d))
  return clamp(h, MIN_H, MAX_H)
}

/**
 * Deck height for a plot centred at (x, z): the raw ground there, lifted onto
 * a terrace, clamped so it is always above the water and never absurdly high.
 */
export function betaDeckTopFor(x, z) {
  return clamp(betaRawHeight(x, z) + 0.55, 0.15, 4.6)
}

/**
 * Flatten anchors: { x, z, radius, deckTop }. Set by the colony whenever the
 * plot layout changes; the terrain mesh and every height query read them.
 */
let anchors = []

export function betaSetAnchors(list) {
  anchors = list
}

/** Full field: raw height blended toward (deckTop − 0.55) near each plot. */
export function betaHeightAt(x, z) {
  let h = betaRawHeight(x, z)
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const d = Math.hypot(x - a.x, z - a.z)
    if (d >= a.radius + 12) continue
    const influence = (1 - smoothstep(a.radius, a.radius + 12, d)) * 0.92
    if (influence <= 0) continue
    h = mix(h, a.deckTop - 0.55, influence)
  }
  return h
}

/** True when the point is under water (and not on a raised deck — callers check that first). */
export function betaIsWater(x, z) {
  return betaHeightAt(x, z) < BETA_WATER_LEVEL
}

// ── terrain mesh ─────────────────────────────────────────────────────────────

const C_SAND = new THREE.Color(0xc9b489)
const C_GRASS_LOW = new THREE.Color(0x5d8a44)
const C_GRASS_HIGH = new THREE.Color(0x86a860)
const C_ROCK = new THREE.Color(0x8a8378)
const C_SNOW = new THREE.Color(0xe8ecef)
const C_SEABED = new THREE.Color(0x7a7a5e)
const _c = new THREE.Color()

function colorFor(x, z, h, slope) {
  if (h < BETA_WATER_LEVEL) {
    // Seabed: darker with depth.
    const d = clamp((BETA_WATER_LEVEL - h) / 0.5, 0, 1)
    _c.copy(C_SAND).lerp(C_SEABED, d)
    return _c
  }
  if (h < BETA_WATER_LEVEL + 0.35) return _c.copy(C_SAND)
  // Grass that dries out toward the hilltops, rock on steep slopes, snow on peaks.
  _c.copy(C_GRASS_LOW).lerp(C_GRASS_HIGH, clamp((h - 0.2) / 2.4, 0, 1))
  if (slope > 0.55) _c.lerp(C_ROCK, clamp((slope - 0.55) / 0.5, 0, 1) * 0.9)
  if (h > 3.4) _c.lerp(C_SNOW, smoothstep(3.4, 4.4, h))
  return _c
}

/**
 * One displaced plane, vertex-coloured by height/slope. Segments cap the vertex
 * count so the mesh stays cheap; normals are computed once at build time.
 */
export function buildBetaTerrain({ extent = BETA_TERRAIN_EXTENT, segments = 288 } = {}) {
  const geo = new THREE.PlaneGeometry(extent * 2, extent * 2, segments, segments)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const e = 0.9 // finite-difference step for the slope estimate
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = betaHeightAt(x, z)
    pos.setY(i, h)
    const hx = betaHeightAt(x + e, z) - betaHeightAt(x - e, z)
    const hz = betaHeightAt(x, z + e) - betaHeightAt(x, z - e)
    const slope = Math.hypot(hx, hz) / (2 * e)
    const col = colorFor(x, z, h, slope)
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    flatShading: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'beta-terrain'
  mesh.receiveShadow = true
  mesh.castShadow = false
  // The island code pokes this when the footprint changes; the beta terrain is
  // rebuilt by the colony itself, so the hook is a deliberate no-op.
  mesh.userData.setFootprint = () => {}
  mesh.userData.heightAt = (x, z) => betaHeightAt(x, z)
  return mesh
}

// ── water ────────────────────────────────────────────────────────────────────

/**
 * One translucent plane at the water level, with the same call shape the
 * colony's own water object has (mesh / update / dispose / heightAt / ripple),
 * so the colony's update loop needs no special case.
 */
export function buildBetaWater({ extent = BETA_TERRAIN_EXTENT } = {}) {
  const geo = new THREE.PlaneGeometry(extent * 2, extent * 2, 1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2e86a8,
    transparent: true,
    opacity: 0.76,
    roughness: 0.12,
    metalness: 0.05,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'beta-water'
  mesh.position.y = BETA_WATER_LEVEL
  mesh.renderOrder = 1
  return {
    mesh,
    update(_dt, elapsed) {
      mesh.position.y = BETA_WATER_LEVEL + Math.sin(elapsed * 0.8) * 0.04
      mat.opacity = 0.74 + 0.05 * Math.sin(elapsed * 0.5)
    },
    heightAt(_x, _z, t = 0) {
      return BETA_WATER_LEVEL + Math.sin(t * 0.8) * 0.04
    },
    ripple() {
      /* ripples are a live-water feature; the beta plane stays glassy */
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}

// Re-export the PRNG for tests (deterministic terrain = testable terrain).
export { mulberry32 }
