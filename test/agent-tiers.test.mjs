/** Camera-distance-tiered agent rendering (Proposal 3): bands, palette, maps, gate. */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  STATUS_TRIM,
  TIER_BANDS,
  assignTier,
  tierBlendScale,
  ShadowGate,
  TierMeshes,
  buildBlobTexture,
  buildMidBotGeometry,
  buildFarDotGeometry,
  tierColorFor,
} from '../src/agents/agent-tiers.js'

const STATUSES = ['working', 'waiting', 'blocked', 'celebrating', 'idle', 'sleeping', 'spawning', 'leaving']

test('assignTier honours hysteresis on both bands', () => {
  // Near band: in at 26, out at 34 — inside the dead zone the tier holds.
  assert.equal(assignTier(30, 'near'), 'near')
  assert.equal(assignTier(35, 'near'), 'mid')
  assert.equal(assignTier(25, 'mid'), 'near')
  assert.equal(assignTier(30, 'mid'), 'mid')
  // Far band: in at 100, out at 88.
  assert.equal(assignTier(101, 'mid'), 'far')
  assert.equal(assignTier(95, 'far'), 'far')
  assert.equal(assignTier(87, 'far'), 'mid')
  assert.equal(assignTier(95, 'mid'), 'mid')
  // No current tier: plain bands.
  assert.equal(assignTier(10, null), 'near')
  assert.equal(assignTier(60, null), 'mid')
  assert.equal(assignTier(150, null), 'far')
  // A fast zoom can jump near straight to far.
  assert.equal(assignTier(150, 'near'), 'far')
  // Forced (click-to-focus / selection) always wins.
  assert.equal(assignTier(150, 'far', true), 'near')
})

test('tierBlendScale grows in from 0.7 to 1 over the blend window', () => {
  assert.equal(tierBlendScale(0), 0.7)
  assert.equal(tierBlendScale(TIER_BANDS.TIER_BLEND_S), 1)
  assert.equal(tierBlendScale(99), 1)
  assert.ok(tierBlendScale(0.1) > 0.7 && tierBlendScale(0.1) < 1)
  assert.ok(tierBlendScale(0.2) > tierBlendScale(0.1))
})

test('one shared status palette: mid and far colours are identical per status', () => {
  for (const status of STATUSES) {
    assert.ok(Number.isInteger(STATUS_TRIM[status]), `${status} has a trim colour`)
    // Same source, same call: the colour a mid bot gets is the colour a far dot gets.
    const mid = tierColorFor(status)
    const far = tierColorFor(status)
    assert.equal(mid.getHex(), far.getHex(), `${status}: mid/far colour must match`)
  }
  assert.equal(tierColorFor('no-such-status').getHex(), STATUS_TRIM.idle)
})

test('mid bot is far cheaper than the near worn-part geometry', () => {
  const mid = buildMidBotGeometry()
  const midTris = (mid.index ? mid.index.count : mid.attributes.position.count) / 3
  assert.ok(midTris < 300, `mid bot ${midTris} tris, expected < 300`)
  const far = buildFarDotGeometry()
  const farTris = (far.index ? far.index.count : far.attributes.position.count) / 3
  assert.equal(farTris, 12, 'far dot is a 12-gon')
  // Near worn parts measured 5008 tris (helmet+visor+face) before tiers.
  assert.ok(midTris < 5008 / 10, 'mid bot is >10x cheaper than near worn parts')
  mid.dispose()
  far.dispose()
})

test('blob texture is an opaque centre fading to transparent corners', () => {
  const tex = buildBlobTexture(64)
  const data = tex.image.data
  const at = (x, y) => data[(y * 64 + x) * 4 + 3]
  assert.equal(at(32, 32), 255, 'centre opaque')
  assert.equal(at(0, 0), 0, 'corner transparent')
  assert.ok(at(48, 32) > 0 && at(48, 32) < 255, 'edge fades')
})

function stubScene() {
  return { added: [], add(o) { this.added.push(o) } }
}

test('TierMeshes: counts, instanceId maps, and shared status colours', () => {
  const tm = new TierMeshes(stubScene(), 4)
  const a = { id: 'a', status: 'blocked', pos: new THREE.Vector3(1, 0, 2), yaw: 0 }
  const b = { id: 'b', status: 'working', pos: new THREE.Vector3(9, 0, 9), yaw: 1 }
  tm.begin()
  const slotA = tm.writeMid(a, 1)
  tm.writeMidColor(a, slotA)
  tm.writeBlob(a, 1)
  const slotB = tm.writeFar(b, 1)
  tm.writeFarColor(b, slotB)
  tm.end()
  assert.equal(tm.mid.count, 1)
  assert.equal(tm.far.count, 1)
  assert.equal(tm.blob.count, 1)
  assert.equal(tm.agentForInstance('mid', 0), a)
  assert.equal(tm.agentForInstance('far', 0), b)
  assert.equal(tm.agentForInstance('mid', 1), null)
  assert.equal(tm.agentForInstance('near', 0), null)
  // Colour on the instance == the shared palette for that status.
  const c = new THREE.Color()
  tm.mid.getColorAt(0, c)
  assert.equal(c.getHex(), STATUS_TRIM.blocked)
  tm.far.getColorAt(0, c)
  assert.equal(c.getHex(), STATUS_TRIM.working)
  tm.dispose()
})

test('TierMeshes: skipped instances keep their slot and map', () => {
  const tm = new TierMeshes(stubScene(), 4)
  const a = { id: 'a', status: 'idle', pos: new THREE.Vector3(0, 0, 0), yaw: 0 }
  const b = { id: 'b', status: 'idle', pos: new THREE.Vector3(5, 0, 5), yaw: 0 }
  tm.begin()
  tm.writeMid(a, 1)
  const slotB = tm.skipMid(b)
  tm.skipBlob()
  tm.end()
  assert.equal(tm.mid.count, 2)
  assert.equal(slotB, 1)
  assert.equal(tm.agentForInstance('mid', 1), b)
  tm.dispose()
})

test('ShadowGate throttles shadow-map renders', () => {
  const gate = new ShadowGate(0.15)
  assert.equal(gate.shouldUpdate(0), true)
  assert.equal(gate.shouldUpdate(0.1), false, 'inside the throttle window')
  assert.equal(gate.shouldUpdate(0.16), true)
  gate.reset()
  assert.equal(gate.shouldUpdate(0.17), true, 'reset forces the next update')
})
