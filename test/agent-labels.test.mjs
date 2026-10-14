/** Proximity-gated agent name plates (beta): hidden until close, HQ plates untouched. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentLabelNear, TIER_BANDS } from '../src/agents/agent-tiers.js'
import { agentLabelText, createLabel, createAgentLabel } from '../src/world/plots.js'

test('agentLabelText prefers title, then name, then id', () => {
  assert.equal(agentLabelText({ title: 'Marketing Lead', name: 'x', id: 'y' }), 'Marketing Lead')
  assert.equal(agentLabelText({ name: 'Fallback Name', id: 'y' }), 'Fallback Name')
  assert.equal(agentLabelText({ id: 'agent-1' }), 'agent-1')
  assert.equal(agentLabelText(undefined), 'Untitled thread')
})

test('agentLabelNear follows the tier gate when tiers are on', () => {
  assert.equal(agentLabelNear({ tiersOn: true, tier: 'near', distance: 5, prevNear: false }), true)
  assert.equal(agentLabelNear({ tiersOn: true, tier: 'mid', distance: 5, prevNear: true }), false)
  assert.equal(agentLabelNear({ tiersOn: true, tier: 'far', distance: 200, prevNear: false }), false)
})

test('agentLabelNear falls back to the distance band when tiers are off', () => {
  // Tiers off: tierOf() reports 'near' for everyone, so distance decides.
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: 10, prevNear: false }), true)
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: 200, prevNear: false }), false)
  // Hysteresis: inside the NEAR_IN..NEAR_OUT dead zone the previous state holds.
  const mid = (TIER_BANDS.NEAR_IN + TIER_BANDS.NEAR_OUT) / 2
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: mid, prevNear: true }), true)
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: mid, prevNear: false }), false)
  // Beyond NEAR_OUT a previously-near plate hides; below NEAR_IN it shows.
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: TIER_BANDS.NEAR_OUT + 1, prevNear: true }), false)
  assert.equal(agentLabelNear({ tiersOn: false, tier: 'near', distance: TIER_BANDS.NEAR_IN - 1, prevNear: false }), true)
})

/** Minimal canvas stand-in: createLabel only needs measure/fill calls at build time. */
function stubDocument() {
  const saved = globalThis.document
  const ctx = {
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0, fillStyle: '',
    measureText: () => ({ width: 200 }),
    scale() {}, clearRect() {}, fillText() {}, beginPath() {}, arc() {}, fill() {},
  }
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) }
  return () => {
    if (saved === undefined) delete globalThis.document
    else globalThis.document = saved
  }
}

test('agent plates are the compact variant; project plates keep full size', () => {
  const restore = stubDocument()
  try {
    const agent = createAgentLabel('Marketing Lead', 0x4f9a63)
    const project = createLabel('Marketing Team', 0x4f9a63)
    assert.equal(agent.geometry.parameters.height, 0.30)
    assert.equal(project.geometry.parameters.height, 0.56)
    assert.ok(agent.geometry.parameters.width > agent.geometry.parameters.height)
    assert.equal(agent.material.opacity, 0)
    assert.equal(agent.visible, false)
  } finally {
    restore()
  }
})
