import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Camera-distance-tiered agent rendering (Proposal 3, beta only).
 *
 * ONE shared status palette. Every tier colours a bot from the same table, so a
 * green bot at overview is the same green bot when you lean in — colour meaning
 * never changes across tiers. This module owns that table; `astronauts.js`
 * derives its trim/eye colours from it.
 *
 * Tiers, by distance from the camera to the bot (world units):
 *   near  — full-detail instanced bot, the only tier that casts dynamic shadows
 *           and the only tier with per-part picking, labels and animation.
 *   mid   — ONE InstancedMesh of a single low-poly bot + ONE InstancedMesh of
 *           blob-shadow quads. Matrices refresh only on move / status change /
 *           tier change / a 4 Hz tick — never per-frame bone work.
 *   far   — ONE InstancedMesh of flat ground dots, position + colour only.
 *
 * Band switches use hysteresis (separate in/out distances) plus a short
 * grow-in scale blend, so a camera drifting across a threshold does not pop.
 *
 * Nothing here is copied from any source. Geometry is built from three.js
 * primitives; the blob texture is generated procedurally into a DataTexture.
 */

/** Status → trim colour. The single source of truth for every tier. */
export const STATUS_TRIM = {
  working: 0x4f9a63,
  waiting: 0x4f7ec9,
  blocked: 0xc94f4f,
  celebrating: 0xc9a24f,
  idle: 0x8b8b85,
  sleeping: 0x5a5a70,
  spawning: 0xc96442,
  leaving: 0x6f7f75,
}

export function tierColorFor(status, out = new THREE.Color()) {
  return out.setHex(STATUS_TRIM[status] ?? STATUS_TRIM.idle)
}

/**
 * Tuning constants, set against the real colony layout: default orbit distance
 * is ~62, close inspection is ~10–25, full zoom-out is ~150. At the default
 * distance the colony sits in the mid band (the common case is the cheap case);
 * leaning in reaches near; pulling all the way out reaches far.
 */
export const TIER_BANDS = {
  /** Below this distance a mid/far bot promotes to near. */
  NEAR_IN: 26,
  /** Above this distance a near bot demotes to mid. NEAR_OUT − NEAR_IN = hysteresis. */
  NEAR_OUT: 34,
  /** Above this distance a mid/near bot demotes to far. */
  FAR_IN: 100,
  /** Below this distance a far bot promotes to mid. FAR_IN − FAR_OUT = hysteresis. */
  FAR_OUT: 88,
  /** Mid/far matrix refresh tick: 4 Hz when nothing else forces a rewrite. */
  TIER_TICK_S: 0.25,
  /** A mid/far bot that moved further than this since its last matrix write is rewritten. */
  TIER_MOVE_EPS: 0.2,
  /** Grow-in blend length after a tier change (seconds). */
  TIER_BLEND_S: 0.25,
}

/**
 * Which tier a bot belongs in. `current` is its tier last frame ('near' | 'mid'
 * | 'far' | null); `forced` (click-to-focus / selection) pins it to near.
 * Hysteresis: a bot keeps its current tier inside the dead zone between the
 * in/out distances instead of flickering on a drifting camera.
 */
export function assignTier(distance, current, forced = false) {
  if (forced) return 'near'
  const b = TIER_BANDS
  if (current === 'near') {
    if (distance > b.NEAR_OUT) return distance > b.FAR_IN ? 'far' : 'mid'
    return 'near'
  }
  if (current === 'far') {
    if (distance < b.FAR_OUT) return distance < b.NEAR_IN ? 'near' : 'mid'
    return 'far'
  }
  if (distance < b.NEAR_IN) return 'near'
  if (distance > b.FAR_IN) return 'far'
  return 'mid'
}

/** Grow-in scale for a bot that changed tier `blend` seconds ago (0 = just changed). */
export function tierBlendScale(blend) {
  const t = Math.min(1, blend / TIER_BANDS.TIER_BLEND_S)
  const e = 1 - (1 - t) * (1 - t) // ease-out: fast start, soft landing
  return 0.7 + 0.3 * e
}

/**
 * Should this agent's name plate show? Proximity-gated: plates stay hidden until
 * the camera is close, so the map reads clean at overview zoom.
 *
 * - Tiers on: the plate follows the bot's tier — near-tier bots get plates.
 * - Tiers off: tierOf() reports 'near' for everyone, so gate on camera distance
 *   directly with the same NEAR_IN / NEAR_OUT hysteresis band (prevNear carries
 *   the dead-zone state, so a camera drifting across the threshold does not flicker).
 */
export function agentLabelNear({ tiersOn, tier, distance, prevNear }) {
  if (tiersOn) return tier === 'near'
  return assignTier(distance, prevNear ? 'near' : 'mid') === 'near'
}

/**
 * Throttle for shadow-map updates while tiers are on. The shadow map is frozen
 * (autoUpdate off); it re-renders at most every SHADOW_MIN_INTERVAL seconds,
 * and only when something actually invalidated it (near-set change, near bot
 * moved, sun moved). Returns true when the caller may flag a shadow update.
 */
export class ShadowGate {
  constructor(minIntervalS = 0.15) {
    this.minIntervalS = minIntervalS
    this._last = -Infinity
  }

  shouldUpdate(nowS) {
    if (nowS - this._last < this.minIntervalS) return false
    this._last = nowS
    return true
  }

  /** Force the next update regardless of the throttle (e.g. flag toggled). */
  reset() {
    this._last = -Infinity
  }
}

/** Radial falloff blob texture, generated procedurally — no canvas, no DOM. */
export function buildBlobTexture(size = 64) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / (size - 1)) * 2 - 1
      const dy = (y / (size - 1)) * 2 - 1
      const r2 = dx * dx + dy * dy
      const a = r2 >= 1 ? 0 : Math.pow(1 - r2, 2)
      const i = (y * size + x) * 4
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = Math.round(a * 255)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}

/** One low-poly bot: body cylinder + helmet sphere, ~120 triangles, world-sized. */
export function buildMidBotGeometry() {
  const body = new THREE.CylinderGeometry(0.3, 0.37, 0.9, 8)
  body.translate(0, 0.5, 0)
  const helmet = new THREE.SphereGeometry(0.44, 8, 6)
  helmet.translate(0, 1.08, 0)
  const merged = BufferGeometryUtils.mergeGeometries([body, helmet], false)
  body.dispose()
  helmet.dispose()
  return merged
}

/** One flat ground dot: a 12-gon disc, 12 triangles, laid flat. */
export function buildFarDotGeometry() {
  const geo = new THREE.CircleGeometry(0.45, 12)
  geo.rotateX(-Math.PI / 2)
  return geo
}

/**
 * The mid + far + blob instanced meshes. ONE draw each; per-instance colour
 * carries status (the shared palette). `instanceId → agent` maps are kept
 * per tier so a raycast hit on an InstancedMesh resolves to its bot.
 */
export class TierMeshes {
  constructor(scene, capacity) {
    this.capacity = capacity
    this.group = new THREE.Group()
    this.group.name = 'agent-tiers'
    scene.add(this.group)

    const midGeo = buildMidBotGeometry()
    const midMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.04 })
    this.mid = this._mesh(midGeo, midMat, capacity)

    const farGeo = buildFarDotGeometry()
    const farMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.far = this._mesh(farGeo, farMat, capacity)

    const blobGeo = new THREE.PlaneGeometry(1.35, 1.35)
    blobGeo.rotateX(-Math.PI / 2)
    const blobMat = new THREE.MeshBasicMaterial({
      map: buildBlobTexture(),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    this.blob = this._mesh(blobGeo, blobMat, capacity)

    /** instanceId → agent, per tier. Rebuilt every frame in `begin`. */
    this.midMap = []
    this.farMap = []
    this._color = new THREE.Color()
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._v = new THREE.Vector3()
    this._one = new THREE.Vector3(1, 1, 1)
  }

  _mesh(geo, mat, count) {
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    const white = new THREE.Color(1, 1, 1)
    for (let i = 0; i < count; i++) mesh.setColorAt(i, white)
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.group.add(mesh)
    return mesh
  }

  /** Start a frame: counts reset, maps cleared. Slots are assigned in call order. */
  begin() {
    this._midN = 0
    this._farN = 0
    this._blobN = 0
    this.midMap.length = 0
    this.farMap.length = 0
    this._midColorDirty = false
    this._farColorDirty = false
  }

  /**
   * Compose one instance matrix from a bot position + yaw + uniform scale.
   * `lift` raises the instance above the ground (0 for the mid bot, which is
   * authored standing on it; small for dots/blobs so they clear the deck).
   */
  _compose(pos, yaw, scale, lift) {
    this._e.set(0, yaw, 0)
    this._q.setFromEuler(this._e)
    this._v.set(pos.x, pos.y + lift, pos.z)
    this._m.compose(this._v, this._q, this._one.setScalar(scale))
    this._one.setScalar(1)
    return this._m
  }

  writeMid(agent, scale) {
    const i = this._midN++
    this.mid.setMatrixAt(i, this._compose(agent.pos, agent.yaw, scale, 0))
    this.midMap[i] = agent
    return i
  }

  writeMidColor(agent, slot) {
    this.mid.setColorAt(slot, tierColorFor(agent.status, this._color))
    this._midColorDirty = true
  }

  /**
   * Count an unchanged mid instance without rewriting its matrix: the slot
   * stays aligned with the agents that *are* rewritten this frame, so a
   * skipped bot keeps the matrix it already has at exactly this slot.
   */
  skipMid(agent) {
    const i = this._midN++
    this.midMap[i] = agent
    return i
  }

  skipBlob() {
    this._blobN++
  }

  writeFar(agent, scale) {
    const i = this._farN++
    this.far.setMatrixAt(i, this._compose(agent.pos, agent.yaw, scale, 0.06))
    this.farMap[i] = agent
    return i
  }

  writeFarColor(agent, slot) {
    this.far.setColorAt(slot, tierColorFor(agent.status, this._color))
    this._farColorDirty = true
  }

  /** Far equivalent of skipMid: count the instance, keep its matrix. */
  skipFar(agent) {
    const i = this._farN++
    this.farMap[i] = agent
    return i
  }

  /** Blob shadow: same footprint as its mid bot, no colour (texture carries it). */
  writeBlob(agent, scale) {
    const i = this._blobN++
    this.blob.setMatrixAt(i, this._compose(agent.pos, agent.yaw, scale, 0.04))
    return i
  }

  /** Finish a frame: publish counts + buffer uploads. */
  end() {
    this.mid.count = this._midN
    this.far.count = this._farN
    this.blob.count = this._blobN
    // A count of 0 still issues a draw on some drivers; hide instead.
    this.mid.visible = this._midN > 0
    this.far.visible = this._farN > 0
    this.blob.visible = this._blobN > 0
    this.mid.instanceMatrix.needsUpdate = true
    this.far.instanceMatrix.needsUpdate = true
    this.blob.instanceMatrix.needsUpdate = true
    if (this._midColorDirty) this.mid.instanceColor.needsUpdate = true
    if (this._farColorDirty) this.far.instanceColor.needsUpdate = true
  }

  /** Hide all three tier meshes (tiers flag off: legacy renderer owns the bots). */
  setVisible(visible) {
    this.group.visible = visible
  }

  /** Resolve a raycast `instanceId` on a tier mesh to its bot, or null. */
  agentForInstance(tier, instanceId) {
    if (tier === 'mid') return this.midMap[instanceId] ?? null
    if (tier === 'far') return this.farMap[instanceId] ?? null
    return null
  }

  dispose() {
    for (const mesh of [this.mid, this.far, this.blob]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      if (mesh.material.map) mesh.material.map.dispose()
    }
    this.group.remove(this.mid, this.far, this.blob)
    this.group.parent?.remove(this.group)
  }
}
