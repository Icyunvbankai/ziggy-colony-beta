/**
 * BETA overlays — the amux / commit-city / thisoffice / citylife layer.
 *
 * Clean-room implementation written for the beta from the *ideas* only
 * (claimed tasks, worker awareness, distress beacons, home desks, activity
 * colour-coding). No code was taken from any other project.
 *
 * Four instanced draws, total, however many bots are on screen:
 *  1. status rings — a flat ring under every bot, coloured by what it is doing
 *     (working / blocked / waiting / idle / sleeping / celebrating). The
 *     colony's colour language, readable from across the map.
 *  2. claim markers — a spinning diamond floating above every WORKING bot: the
 *     task it has claimed, in its stack's accent colour. A bot with a marker
 *     is a bot with work in hand.
 *  3. distress beacons — a tall pulsing light pillar over every BLOCKED bot.
 *     Blocked is the one state that wants a human; it gets the loudest thing
 *     on the map.
 *  4. home desks — one small desk per bot at its home tile (its roster anchor):
 *     the desk a bot returns to. Dormant bots sit at their desks; the colony
 *     reads as a place with addresses, not a crowd milling on a plane.
 *
 * Everything is re-derived from the agent list every frame, so a bot that
 * leaves takes its desk, ring and markers with it and a bot that arrives
 * grows them — no stale meshes, no bookkeeping to leak.
 */

import * as THREE from 'three'

const STATUS_COLOR = {
  working: 0x35e08a,
  blocked: 0xff4444,
  waiting: 0xffbb33,
  idle: 0x8a93a6,
  sleeping: 0x6a7bd6,
  celebrating: 0xffd24d,
  leaving: 0xb8bec9,
  spawning: 0x7fd4ff,
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const _up = new THREE.Vector3(0, 1, 0)

function mergedDeskGeometry() {
  // One desk: a top slab + four legs, merged into a single geometry so the
  // whole colony's desks cost one draw call. Built from boxes by hand.
  const boxes = []
  const pushBox = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    boxes.push(g)
  }
  pushBox(1.0, 0.07, 0.6, 0, 0.72, 0) // top
  pushBox(0.07, 0.7, 0.07, -0.44, 0.35, -0.24)
  pushBox(0.07, 0.7, 0.07, 0.44, 0.35, -0.24)
  pushBox(0.07, 0.7, 0.07, -0.44, 0.35, 0.24)
  pushBox(0.07, 0.7, 0.07, 0.44, 0.35, 0.24)
  pushBox(0.5, 0.1, 0.4, 0, 0.45, 0) // drawer block, gives the silhouette weight
  let merged = boxes[0]
  for (let i = 1; i < boxes.length; i++) {
    const next = merged
    merged = mergeTwo(next, boxes[i])
    next.dispose()
    boxes[i].dispose()
  }
  return merged
}

// Minimal BufferGeometry merge for non-indexed box geometries with the same
// attributes (position / normal / uv). Boxes from BoxGeometry are indexed, so
// convert first.
function mergeTwo(a, b) {
  const na = a.index ? a.toNonIndexed() : a
  const nb = b.index ? b.toNonIndexed() : b
  const geo = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const arrA = na.attributes[name].array
    const arrB = nb.attributes[name].array
    const out = new Float32Array(arrA.length + arrB.length)
    out.set(arrA, 0)
    out.set(arrB, arrA.length)
    geo.setAttribute(name, new THREE.BufferAttribute(out, na.attributes[name].itemSize))
  }
  if (na !== a) na.dispose()
  if (nb !== b) nb.dispose()
  return geo
}

export class BetaOverlays {
  /**
   * @param {THREE.Scene} scene
   * @param {(x: number, z: number) => number} groundAt — height of the ground
   *   (deck or terrain) at a point, for seating desks on the ground.
   * @param {(thread: object) => number} accentFor — stack accent colour for a bot's thread.
   */
  constructor(scene, groundAt, accentFor) {
    this.scene = scene
    this.groundAt = groundAt
    this.accentFor = accentFor

    // 1. Status rings.
    const ringGeo = new THREE.RingGeometry(0.52, 0.68, 24)
    ringGeo.rotateX(-Math.PI / 2)
    this.rings = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
      512
    )
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.rings.frustumCulled = false
    this.rings.renderOrder = 2

    // 2. Claim markers (working bots).
    this.markers = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25 }),
      512
    )
    this.markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.markers.frustumCulled = false
    this.markers.castShadow = false

    // 3. Distress beacons (blocked bots).
    const beaconGeo = new THREE.CylinderGeometry(0.28, 0.55, 7, 12, 1, true)
    beaconGeo.translate(0, 3.5, 0)
    this.beacons = new THREE.InstancedMesh(
      beaconGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      128
    )
    this.beacons.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.beacons.frustumCulled = false
    this.beacons.renderOrder = 3

    // 4. Home desks.
    this.desks = new THREE.InstancedMesh(
      mergedDeskGeometry(),
      new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
      512
    )
    this.desks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.desks.frustumCulled = false
    this.desks.castShadow = true
    this.desks.receiveShadow = true

    for (const mesh of [this.rings, this.markers, this.beacons, this.desks]) {
      mesh.count = 0
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
    }
    // Per-instance colours: allocated once, filled every frame.
    for (const mesh of [this.rings, this.markers, this.desks]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3), 3)
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
  }

  _setColor(mesh, i, hex) {
    _c.set(hex)
    mesh.instanceColor.setXYZ(i, _c.r, _c.g, _c.b)
  }

  _setMatrix(mesh, i, x, y, z, scale = 1, yaw = 0) {
    _p.set(x, y, z)
    _q.setFromAxisAngle(_up, yaw)
    _s.set(scale, scale, scale)
    _m.compose(_p, _q, _s)
    mesh.setMatrixAt(i, _m)
  }

  /**
   * @param {Array} agents — colony astronaut records ({ pos, status, thread, anchor }).
   * @param {number} elapsed — seconds, for pulse/bob animation.
   */
  sync(agents, elapsed) {
    let ringN = 0
    let markerN = 0
    let beaconN = 0
    let deskN = 0
    for (const agent of agents) {
      if (!agent.alive || agent.scale < 0.5) continue
      const x = agent.pos.x
      const y = agent.pos.y
      const z = agent.pos.z
      const status = agent.status || 'idle'

      // Ring under every bot.
      this._setMatrix(this.rings, ringN, x, y + 0.03, z, 1, 0)
      this._setColor(this.rings, ringN, STATUS_COLOR[status] ?? STATUS_COLOR.idle)
      ringN++

      // Claim marker above working bots: spins, bobs, wears the stack accent.
      if (status === 'working') {
        const bob = Math.sin(elapsed * 2.2 + x * 0.7 + z * 0.7) * 0.16
        this._setMatrix(this.markers, markerN, x, y + 2.35 + bob, z, 1, elapsed * 1.6 + x)
        this._setColor(this.markers, markerN, this.accentFor(agent.thread))
        markerN++
      }

      // Distress beacon over blocked bots: tall, pulsing, impossible to miss.
      if (status === 'blocked') {
        const pulse = 1 + Math.sin(elapsed * 5.2) * 0.18
        this._setMatrix(this.beacons, beaconN, x, y, z, pulse, 0)
        beaconN++
      }

      // Home desk at the bot's anchor tile.
      const anchor = agent.anchor
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.z)) {
        const gy = this.groundAt(anchor.x, anchor.z)
        // Face the desk toward the plot centre-ish: yaw from a stable hash of
        // the agent id so desks don't all line up like a showroom.
        const yaw = (hashStr(agent.id) % 360) * (Math.PI / 180)
        this._setMatrix(this.desks, deskN, anchor.x, gy, anchor.z, 1, yaw)
        this._setColor(this.desks, deskN, this.accentFor(agent.thread))
        deskN++
      }
    }
    this.rings.count = ringN
    this.markers.count = markerN
    this.beacons.count = beaconN
    this.desks.count = deskN
    for (const mesh of [this.rings, this.markers, this.beacons, this.desks]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    // Beacons breathe as one.
    this.beacons.material.opacity = 0.26 + 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 5.2))
  }

  dispose() {
    for (const mesh of [this.rings, this.markers, this.beacons, this.desks]) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.instanceColor?.array.fill(0)
    }
  }
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}
