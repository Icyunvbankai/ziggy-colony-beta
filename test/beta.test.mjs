/** BETA topography checks: deterministic heights, real relief, shallow water, plot flattening. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  betaHeightAt,
  betaRawHeight,
  betaDeckTopFor,
  betaSetAnchors,
  betaIsWater,
  buildBetaTerrain,
  buildBetaWater,
  BETA_WATER_LEVEL,
} from '../src/beta/terrain.js'

test('beta terrain is deterministic', () => {
  assert.equal(betaHeightAt(12.3, -45.6), betaHeightAt(12.3, -45.6))
  assert.equal(betaRawHeight(-80, 90), betaRawHeight(-80, 90))
})

test('beta terrain has real relief: hills above +2 and valleys below water', () => {
  let max = -Infinity
  let min = Infinity
  let wet = 0
  let n = 0
  for (let x = -100; x <= 100; x += 4) {
    for (let z = -100; z <= 100; z += 4) {
      const h = betaHeightAt(x, z)
      max = Math.max(max, h)
      min = Math.min(min, h)
      if (betaIsWater(x, z)) wet++
      n++
    }
  }
  assert.ok(max > 2, `expected hills above +2, got max ${max}`)
  assert.ok(min < BETA_WATER_LEVEL, `expected valleys below water, got min ${min}`)
  assert.ok(wet > 0 && wet < n / 2, `expected some but not mostly water, got ${wet}/${n}`)
})

test('beta ponds are shallow enough to wade (never deeper than 0.6)', () => {
  let deepest = 0
  for (let x = -200; x <= 200; x += 3) {
    for (let z = -200; z <= 200; z += 3) {
      const h = betaRawHeight(x, z)
      if (h < BETA_WATER_LEVEL) deepest = Math.max(deepest, BETA_WATER_LEVEL - h)
    }
  }
  assert.ok(deepest <= 0.6, `deepest pond ${deepest}`)
})

test('beta deck heights stay above water and bounded', () => {
  for (let x = -90; x <= 90; x += 9) {
    for (let z = -90; z <= 90; z += 9) {
      const d = betaDeckTopFor(x, z)
      assert.ok(d > BETA_WATER_LEVEL + 0.5, `deck ${d} too close to water at ${x},${z}`)
      assert.ok(d >= 0.15 && d <= 4.6, `deck ${d} out of bounds`)
    }
  }
})

test('beta plot anchors flatten the ground under a plot', () => {
  betaSetAnchors([])
  const before = betaHeightAt(10, 10)
  betaSetAnchors([{ x: 10, z: 10, radius: 16, deckTop: 3.0 }])
  const after = betaHeightAt(10, 10)
  // Blend factor at the anchor centre is 0.92, so the ground moves 92% of the
  // way from the raw height to (deckTop − 0.55) = 2.45.
  assert.ok(Math.abs(after - 2.45) < 0.35, `flattened height ${after}, expected ~2.45 (was ${before})`)
  betaSetAnchors([])
})

test('beta terrain mesh builds with vertex colours', () => {
  const mesh = buildBetaTerrain({ extent: 60, segments: 16 })
  assert.equal(mesh.geometry.attributes.position.count, 17 * 17)
  assert.ok(mesh.geometry.attributes.color, 'vertex colours present')
  assert.ok(mesh.geometry.attributes.normal, 'normals present')
  const ys = mesh.geometry.attributes.position.array
  let max = -Infinity
  let min = Infinity
  for (let i = 1; i < ys.length; i += 3) {
    max = Math.max(max, ys[i])
    min = Math.min(min, ys[i])
  }
  assert.ok(max > min + 1, `mesh should carry relief: ${min}..${max}`)
  mesh.geometry.dispose()
  mesh.material.dispose()
})

test('beta water sits at the water level', () => {
  const water = buildBetaWater({ extent: 60 })
  assert.ok(Math.abs(water.mesh.position.y - BETA_WATER_LEVEL) < 0.001)
  water.update(0, 1.5)
  assert.ok(Math.abs(water.mesh.position.y - BETA_WATER_LEVEL) < 0.1)
  water.dispose()
})
